'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { generateSlides, reviewAndImproveSlides, parseUserInput } = require('./pipeline/gemini');
const { searchImageMulti, downloadAsDataUri } = require('./pipeline/images');
const { build3DPresentationHTML } = require('./pipeline/html3DBuilder');
const { attachVisuals }            = require('./pipeline/visual');
const { renderHtmlToPngs }        = require('./pipeline/renderer');
const { exportToPptx }            = require('./pipeline/pptxExporter');
const { runQualityLoop, renderWarningsToIssues } = require('./pipeline/quality');
const { repairDeckComposition, hintsFromOverflowWarnings } = require('./pipeline/composition');
const { createCostTracker, setActiveCostTracker } = require('./pipeline/cost');
const { maybeAttachReferencesSlide, sanitizeMetaLeakSlides } = require('./pipeline/sources');
const { runNarrativePass, buildDimensionScores } = require('./pipeline/narrative');
const { runVisionCritic } = require('./pipeline/visionCritic');
const { uniqueId } = require('./pipeline/tmpFiles');

// Query-ді жалпылама етіп қысқарту
function simplifyQuery(query) {
  const words = query.split(/[\s,]+/).filter(w => w.length > 3);
  return words.slice(0, 4).join(' ');
}

// Толық brief емес, тек қысқа кілт сөз (толық brief Unsplash-та 414 қатесін береді)
function shortTopicKeyword(topic) {
  if (!topic || typeof topic !== 'string') return '';
  const quoted = topic.match(/[«"“]([^»"”']{4,60})[»"”']/);
  if (quoted) return quoted[1].trim();
  const line = topic.split(/[\n\r]+/).map(s => s.trim()).find(s =>
    s.length >= 4 && s.length <= 80 &&
    !/^\d+-?слайд/i.test(s) && !/Тексерген|Орындаған|Топ:/i.test(s)
  );
  if (line) return line.replace(/^Тақырып\s*[:：]\s*/i, '').slice(0, 60);
  return topic.slice(0, 40);
}

// Бір слайдқа сурет: сұраныстарды кезекпен сынап, табылған суретті жүктеп, data: URI ретінде қайтарады.
// Ешбір сурет алынбаса — null (builder әдемі fallback фонға түседі). Осы функция ЕШҚАШАН лақтырмайды.
async function fetchImageWithFallback(query, topic) {
  const attempts = [];
  attempts.push(query);
  const simple = simplifyQuery(query);
  if (simple && simple !== query) attempts.push(simple);
  const kw = shortTopicKeyword(topic);
  if (kw && kw.length >= 3) attempts.push(kw + ' historical cinematic');

  for (const q of attempts) {
    if (!q || !q.trim()) continue;
    try {
      const found = await searchImageMulti(q);
      if (!found) continue;
      const dataUri = await downloadAsDataUri(found.url);
      if (dataUri) return dataUri;
    } catch (err) {
      console.warn(`[Image] "${q}" failed: ${err.message}`);
    }
  }
  return null;
}

// Бір уақытта ең көбі N тапсырма (Unsplash-ты және желіні шамадан тыс жүктемеу үшін)
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

/**
 * Pipeline:
 *   тақырып → мазмұн (LLM) → QC → суреттер → HTML (DeadLine Motion, шындық көзі)
 *                                                │
 *                                                ├─► HTML файл  (пайдаланушыға)
 *                                                └─► Puppeteer → PNG → PPTX
 *
 * PPTX — HTML-дің өзінен рендерленеді, сондықтан екеуі бірдей.
 */
/**
 * @param {string} userInput
 * @param {{ onProgress?: (phase: string, detail?: string) => void|Promise<void> }} [options]
 */
async function generatePresentation(userInput, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : async () => {};
  const genId = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const t0 = Date.now();
  const cost = createCostTracker(genId);
  setActiveCostTracker(cost);
  const { topic, slideCount, language, style, coverMeta } = parseUserInput(userInput);

  console.log(`[Pipeline] id=${genId} Topic: ${topic.slice(0, 120)}`);
  if (slideCount) console.log(`[Pipeline] id=${genId} Slides: ${slideCount}`);
  if (language)   console.log(`[Pipeline] id=${genId} Language: ${language}`);
  if (style)      console.log(`[Pipeline] id=${genId} Style: ${style}`);
  if (coverMeta && (coverMeta.checkedBy || coverMeta.performedBy || coverMeta.group)) {
    console.log(`[Pipeline] id=${genId} Cover meta:`, coverMeta);
  }

  // 1. Мазмұн генерациясы
  await onProgress('content', 'Мазмұн жазылуда...');
  console.log('[Pipeline] Generating content...');
  const presentation = await generateSlides(topic, {
    slideCount, language, style, clientBrief: userInput, coverMeta,
  });
  if (!presentation || !Array.isArray(presentation.slides) || presentation.slides.length < 2) {
    throw new Error('Content generation returned too few slides');
  }
  console.log(`[Pipeline] ${presentation.slides.length} slides generated`);

  // 2. Визуалды QC
  await onProgress('review', 'Визуалды тексеру...');
  console.log('[Pipeline] Running visual QC...');
  const reviewed = await reviewAndImproveSlides(presentation);
  const title = reviewed.title;
  let slides = Array.isArray(reviewed.slides) ? reviewed.slides : [];
  if (slides.length < 2) {
    throw new Error('Review stage returned too few slides');
  }
  // Drop slides that are effectively empty (no title and no body/bullets/stats/table)
  const beforeCount = slides.length;
  slides = slides.filter((s) => {
    if (!s || typeof s !== 'object') return false;
    const hasTitle = !!(s.title && String(s.title).trim());
    const hasBody = !!(s.body && String(s.body).trim());
    const hasBullets = Array.isArray(s.bullets) && s.bullets.some((b) => b && String(b).trim());
    const hasStats = Array.isArray(s.stats) && s.stats.length > 0;
    const hasTable = !!(s.table && (s.table.headers || s.table.rows));
    return hasTitle || hasBody || hasBullets || hasStats || hasTable;
  });
  if (slides.length < 2) {
    throw new Error('Almost all slides are empty after generation/QC');
  }
  if (slides.length < beforeCount) {
    console.warn(`[Pipeline] Dropped ${beforeCount - slides.length} empty slide(s)`);
  }
  slides.forEach((slide, i) => { slide.index = i + 1; });

  // 2a2. Deterministic meta-leak sanitization (no LLM) — fixes slides where the model's
  // own design/outline instructions bled into visible slide text (e.g. a poisoned
  // "references" slide). quality.js's LLM critic can also flag this pattern, but only
  // probabilistically when it happens to run; this makes the fix unconditional and free.
  try {
    const leak = sanitizeMetaLeakSlides(slides, userInput);
    if (leak.fixed > 0) {
      console.log(`[Pipeline] Sanitized meta-leak content on ${leak.fixed} slide(s)`);
      slides = leak.slides;
      slides.forEach((slide, i) => { slide.index = i + 1; });
    }
  } catch (err) {
    console.warn(`[Pipeline] Meta-leak sanitization error (continuing): ${err.message}`);
  }

  // 2b. Structured quality loop: deterministic QA → LLM critic → targeted repair
  //     (bounded; keeps best version; skips LLM when score already high)
  await onProgress('quality', 'Сапаны тексеру...');
  console.log('[Pipeline] Running quality loop...');
  let qualityMeta = { qualityScore: null, iterations: 0, repairedSlides: [] };
  try {
    const q = await runQualityLoop({
      slides,
      title,
      topic,
      language,
      style,
    });
    slides = q.slides;
    slides.forEach((slide, i) => { slide.index = i + 1; });
    qualityMeta = {
      qualityScore: q.qualityScore,
      iterations: q.iterations,
      repairedSlides: q.repairedSlides,
      critiqueIssues: (q.critique && q.critique.issues) ? q.critique.issues.length : 0,
    };
    console.log(`[Pipeline] Quality score=${qualityMeta.qualityScore} repairs=${qualityMeta.iterations} fixedSlides=[${(qualityMeta.repairedSlides || []).join(',')}]`);
  } catch (err) {
    // Quality must never kill a working generation — log and continue with current slides
    console.warn(`[Pipeline] Quality loop error (continuing): ${err.message}`);
  }

  // 2b2. Deck-level narrative critic (whole presentation, not only slides)
  let narrativeMeta = { narrativeScore: null, applied: [] };
  try {
    await onProgress('narrative', 'Құрылым мен логика...');
    const nar = await runNarrativePass({
      slides,
      title,
      topic,
      language,
    });
    slides = nar.slides;
    slides.forEach((slide, i) => { slide.index = i + 1; });
    narrativeMeta = { narrativeScore: nar.narrativeScore, applied: nar.applied, issues: (nar.narrative && nar.narrative.issues) ? nar.narrative.issues.length : 0 };
    console.log(`[Pipeline] Narrative score=${narrativeMeta.narrativeScore} fixes=${(narrativeMeta.applied || []).length} issues=${narrativeMeta.issues}`);
  } catch (err) {
    console.warn(`[Pipeline] Narrative pass error (continuing): ${err.message}`);
  }

  // 2c. Deterministic composition pass (geometry/layout — no LLM)
  {
    const comp = repairDeckComposition(slides);
    if (comp.repairs.length) {
      console.log(`[Pipeline] Composition pre-repair: ${comp.repairs.length} slide(s)`);
      slides = comp.slides;
      slides.forEach((slide, i) => { slide.index = i + 1; });
    }
  }

  // 2d. Optional references slide from real brief sources only
  {
    const ref = maybeAttachReferencesSlide(slides, userInput, { style, language });
    if (ref.attached) {
      console.log(`[Pipeline] Attached references slide (${ref.sources.length} sources from brief)`);
      slides = ref.slides;
      slides.forEach((slide, i) => { slide.index = i + 1; });
    }
  }

  // 3. Суреттер мен визуалдар (SVG диаграмма/инфографика) — бір мезгілде, бірін-бірі күтпейді.
  //    Екеуі де ЕШҚАШАН лақтырмайды: сәтсіз болса, слайд қалыпты күйінде қалады.
  await onProgress('media', 'Суреттер мен диаграммалар...');
  console.log('[Pipeline] Fetching images + drawing visuals...');
  const imagesTask = mapLimit(slides, 3, async (slide) => {
    const query = typeof slide.imageQuery === 'string' ? slide.imageQuery : '';
    console.log(`[Image] query="${query}"`);
    try {
      return await fetchImageWithFallback(query, topic);
    } catch (err) {
      // Бір слайдтың суреті ешқашан бүкіл презентацияны құлатпауы керек
      console.warn(`[Image] slide failed, using fallback background: ${err.message}`);
      return null;
    }
  });
  const visualsTask = attachVisuals(slides, { language });
  const [images, visualStats] = await Promise.all([imagesTask, visualsTask]);
  slides.forEach((slide, i) => { slide.webImageUrl = images[i] || ''; });
  // No photo → safe composition (avoid empty half panels / sparse look)
  slides.forEach((slide) => {
    if (slide.webImageUrl) return;
    const c = slide.composition || (slide.composition = {});
    if (c.image === 'right_half' || c.image === 'left_half' || c.image === 'corner_accent' || c.image === 'top_strip' || c.image === 'bottom_strip') {
      c.image = 'full_background';
      c.textPosition = 'center';
      c.overlay = 'dark_gradient_bottom';
    }
    if (!c.overlay || c.overlay === 'none') c.overlay = 'dark_gradient_bottom';
  });
  console.log(`[Pipeline] Images embedded: ${images.filter(Boolean).length}/${slides.length}; visuals: ${visualStats.ok}/${visualStats.requested}`);

  // 4–5. HTML + render with optional composition re-repair on overflow
  await onProgress('html', 'HTML жиналуда...');
  console.log('[Pipeline] Building HTML presentation...');
  cost.setSlides(slides.length);
  cost.setQuality(qualityMeta.iterations || 0, (qualityMeta.repairedSlides || []).length);

  let htmlPath = null;
  let pptxPath;
  let pngPaths = [];
  let tmpDir = null;
  let overflowWarnings = [];
  let visionMeta = { overallScore: null, source: 'skipped', applied: [] };

  const cleanupPngs = () => {
    try {
      for (const p of pngPaths) {
        try { fs.unlinkSync(p); } catch {}
      }
      if (tmpDir) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {
          try { fs.rmdirSync(tmpDir); } catch {}
        }
      }
    } catch {}
    pngPaths = [];
    tmpDir = null;
  };

  const buildAndRender = async (attempt) => {
    const pathHtml = path.join(os.tmpdir(), `presentation-${uniqueId()}.html`);
    fs.writeFileSync(pathHtml, build3DPresentationHTML(slides, title), 'utf8');
    await onProgress('render', attempt > 1 ? 'Қайта рендер...' : 'Рендер және PPTX...');
    console.log(`[Pipeline] Rendering HTML → PNG → PPTX (attempt ${attempt})...`);
    cost.addRenderAttempt();
    const result = await renderHtmlToPngs(pathHtml);
    return { pathHtml, ...result };
  };

  try {
    let attempt = 1;
    let rendered = await buildAndRender(attempt);
    htmlPath = rendered.pathHtml;
    pngPaths = rendered.pngPaths;
    tmpDir = rendered.tmpDir;
    overflowWarnings = rendered.overflowWarnings || [];

    if (overflowWarnings.length) {
      console.warn(`[Pipeline] ⚠️ ${overflowWarnings.length} слайдта мәселе: ${overflowWarnings.join(' | ')}`);
      const hints = hintsFromOverflowWarnings(overflowWarnings);
      const hasLayoutProblems = Object.keys(hints.overflowByIndex).length > 0 || hints.blankIndexes.length > 0;
      if (hasLayoutProblems && attempt < 2) {
        console.log('[Pipeline] Applying deterministic composition repair from render QA...');
        const comp = repairDeckComposition(slides, hints);
        if (comp.repairs.length) {
          slides = comp.slides;
          slides.forEach((slide, i) => { slide.index = i + 1; });
          // rebuild HTML + re-render once
          try { fs.unlinkSync(htmlPath); } catch {}
          cleanupPngs();
          attempt = 2;
          rendered = await buildAndRender(attempt);
          htmlPath = rendered.pathHtml;
          pngPaths = rendered.pngPaths;
          tmpDir = rendered.tmpDir;
          overflowWarnings = rendered.overflowWarnings || [];
          if (overflowWarnings.length) {
            console.warn(`[Pipeline] After composition repair still: ${overflowWarnings.join(' | ')}`);
          }
        }
      }
    }

    const badRatio = overflowWarnings.length / Math.max(slides.length, 1);
    if (badRatio >= 0.4 && overflowWarnings.length >= 2) {
      const err = new Error(
        `Render QA failed: ${overflowWarnings.length}/${slides.length} slides have layout issues (${overflowWarnings.join('; ')})`
      );
      err.isQualityGate = true;
      throw err;
    }
    if (!pngPaths.length) {
      throw new Error('Render produced zero PNGs');
    }

    // Vision Art Director: look at rendered PNGs → redesign → optional re-render
    try {
      await onProgress('vision', 'Визуал сын (Art Director)...');
      const vision = await runVisionCritic({ slides, pngPaths, title, topic });
      visionMeta = {
        overallScore: vision.overallScore,
        source: vision.source,
        applied: vision.applied || [],
        issues: (vision.issues || []).length,
      };
      console.log(
        `[Pipeline] Vision score=${vision.overallScore} source=${vision.source} ` +
        `issues=${visionMeta.issues} redesign=${!!vision.needRedesign} applied=${(vision.applied || []).length}`
      );
      if (vision.needRedesign && (vision.applied || []).length && attempt < 3) {
        // Snapshot BEFORE version for best-version policy
        const beforeSlides = slides.map((s) => JSON.parse(JSON.stringify(s)));
        const beforeHtml = htmlPath;
        const beforePngs = pngPaths.slice();
        const beforeTmp = tmpDir;
        const beforeOverflow = (overflowWarnings || []).slice();
        const beforeVisionScore = vision.overallScore;
        const beforeSizes = beforePngs.map((p) => {
          try { return fs.statSync(p).size; } catch { return 0; }
        });

        slides = vision.slides;
        slides.forEach((slide, i) => { slide.index = i + 1; });
        // Keep before PNG files; buildAndRender creates a new tmpDir
        pngPaths = [];
        tmpDir = null;
        attempt = Math.max(attempt, 2) + 1;
        rendered = await buildAndRender(attempt);
        const afterHtml = rendered.pathHtml;
        const afterPngs = rendered.pngPaths;
        const afterTmp = rendered.tmpDir;
        const afterOverflow = rendered.overflowWarnings || [];
        const afterSizes = afterPngs.map((p) => {
          try { return fs.statSync(p).size; } catch { return 0; }
        });

        // Objective comparison without second vision call:
        // fewer overflow warnings, fewer near-blank PNGs, not fewer total slides
        const blankish = (sizes) => sizes.filter((s) => s > 0 && s < 35000).length;
        const beforeBlank = blankish(beforeSizes);
        const afterBlank = blankish(afterSizes);
        const beforeOv = beforeOverflow.length;
        const afterOv = afterOverflow.length;
        const afterBetter =
          afterPngs.length >= beforePngs.length
          && (afterOv < beforeOv || afterBlank < beforeBlank || (afterOv <= beforeOv && afterBlank <= beforeBlank));

        visionMeta.beforeScore = beforeVisionScore;
        visionMeta.afterMetrics = { overflow: afterOv, blankish: afterBlank, pngs: afterPngs.length };
        visionMeta.beforeMetrics = { overflow: beforeOv, blankish: beforeBlank, pngs: beforePngs.length };

        if (afterBetter) {
          // Accept AFTER: drop BEFORE files
          try { fs.unlinkSync(beforeHtml); } catch {}
          for (const p of beforePngs) { try { fs.unlinkSync(p); } catch {} }
          if (beforeTmp) { try { fs.rmSync(beforeTmp, { recursive: true, force: true }); } catch {} }
          htmlPath = afterHtml;
          pngPaths = afterPngs;
          tmpDir = afterTmp;
          overflowWarnings = afterOverflow;
          visionMeta.acceptedVersion = 'after';
          visionMeta.redesignAccepted = true;
          console.log(`[Pipeline] Vision AFTER accepted (attempt ${attempt}) ov ${beforeOv}→${afterOv} blankish ${beforeBlank}→${afterBlank}`);
        } else {
          // Revert to BEFORE
          try { fs.unlinkSync(afterHtml); } catch {}
          for (const p of afterPngs) { try { fs.unlinkSync(p); } catch {} }
          if (afterTmp) { try { fs.rmSync(afterTmp, { recursive: true, force: true }); } catch {} }
          slides = beforeSlides;
          htmlPath = beforeHtml;
          pngPaths = beforePngs;
          tmpDir = beforeTmp;
          overflowWarnings = beforeOverflow;
          visionMeta.acceptedVersion = 'before';
          visionMeta.redesignAccepted = false;
          console.log(`[Pipeline] Vision AFTER rejected — kept BEFORE (ov ${beforeOv}→${afterOv} blankish ${beforeBlank}→${afterBlank})`);
        }
      }
    } catch (err) {
      console.warn(`[Pipeline] Vision critic error (continuing): ${err.message}`);
    }

    if (!pngPaths.length) {
      throw new Error('Render produced zero PNGs');
    }
    pptxPath = await exportToPptx(pngPaths, title, slides);
  } catch (err) {
    try { if (htmlPath) fs.unlinkSync(htmlPath); } catch {}
    throw err;
  } finally {
    cleanupPngs();
  }

  const costSnapshot = cost.logSummary();
  const ms = Date.now() - t0;
  console.log(`[Pipeline] id=${genId} Done in ${ms}ms: slides=${slides.length} score=${qualityMeta.qualityScore} pptx=${pptxPath} html=${htmlPath} visuals=${visualStats.ok}/${visualStats.requested}`);
  const expensiveVisuals = !!(visualStats && visualStats.ok > 0);
  const dimensionScores = buildDimensionScores({
    contentScore: qualityMeta.qualityScore,
    narrativeScore: narrativeMeta.narrativeScore,
    visualScore: visionMeta.overallScore != null
      ? visionMeta.overallScore
      : (visualStats.requested
        ? Math.round(40 + 60 * (visualStats.ok / Math.max(visualStats.requested, 1)))
        : 75),
    compositionScore: qualityMeta.qualityScore,
    readabilityScore: qualityMeta.qualityScore,
    sourceScore: 80,
    renderScore: overflowWarnings && overflowWarnings.length
      ? Math.max(40, 100 - overflowWarnings.length * 15)
      : 95,
  });
  console.log(`[Pipeline] Dimensions overall=${dimensionScores.overall} ${JSON.stringify(dimensionScores.dimensions)}`);

  // FINAL QUALITY GATE — critical defects block delivery (refund path in bot)
  {
    const dims = dimensionScores.dimensions || {};
    const critical =
      (dims.renderIntegrity != null && dims.renderIntegrity < 40)
      || (dims.content != null && dims.content < 35)
      || (dimensionScores.overall < 40);
    if (critical) {
      const err = new Error(
        `Final quality gate failed: overall=${dimensionScores.overall} ` +
        `content=${dims.content} render=${dims.renderIntegrity}`
      );
      err.isQualityGate = true;
      throw err;
    }
  }

  setActiveCostTracker(null);
  return {
    pptxPath,
    htmlPath,
    title,
    visualStats,
    genId,
    durationMs: ms,
    qualityScore: qualityMeta.qualityScore,
    qualityRepairs: qualityMeta.iterations,
    cost: costSnapshot,
    expensiveVisuals,
    dimensionScores,
    narrativeScore: narrativeMeta.narrativeScore,
    visionScore: visionMeta.overallScore,
    visionSource: visionMeta.source,
  };
}

module.exports = { generatePresentation };
