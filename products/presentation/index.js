'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { generateSlides, reviewAndImproveSlides, parseUserInput, ensureIntroSlide, languageMismatch } = require('./gemini');
const { findImage, fallbackQueries, isLatinQuery } = require('./images');
const { limitTables, applyDeckTheme } = require('./deckPolish');
const { analyzeReference, referenceItems } = require('../../design-dna');
const REQ = require('../../requirements');
const { applyReferencePlan, layoutMatch } = require('./refPlan');
const { buildTemplateReport } = require('./templateQa');
const { fillTemplatePptx, planTemplateSlots, slotRuleLine } = require('./templateFill');
const { repairTemplateSlides } = require('./templateRepair');
const { planLayout } = require('./templateLayoutPlan');
const { planStoryline } = require('./templateStory');
const { build3DPresentationHTML } = require('./html3DBuilder');
const { attachVisuals }            = require('./visual');
const { renderHtmlToPngs }        = require('./renderer');
const { exportToPptx }            = require('./pptxExporter');
const { runQualityLoop, renderWarningsToIssues } = require('./quality');
const { repairDeckComposition, hintsFromOverflowWarnings } = require('./composition');
const { createCostTracker, setActiveCostTracker } = require('../../core/cost');
const { maybeAttachReferencesSlide, sanitizeMetaLeakSlides } = require('./sources');
const { runNarrativePass, buildDimensionScores } = require('./narrative');
const { runVisionCritic } = require('./visionCritic');
const { uniqueId } = require('../../core/tmpFiles');

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
async function fetchImageWithFallback(query, topic, used, deckQueries = []) {
  const attempts = [];
  for (const q of fallbackQueries(query, topic, deckQueries)) {
    attempts.push(q);
    const simple = simplifyQuery(q);
    if (simple && simple !== q) attempts.push(simple);
  }

  for (const q of attempts) {
    if (!q || !q.trim()) continue;
    try {
      // findImage: табады + жүктейді; жүктелмесе келесі кандидатқа/провайдерге өзі өтеді
      const hit = await findImage(q, { used });
      if (hit && hit.dataUri) return hit.dataUri;
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
  const parsed = parseUserInput(userInput);
  let { topic, slideCount, style, coverMeta } = parsed;
  const mode = options.mode || 'presentation';
  // Нақты тіл (веб-форма таңдауы) мәтіннен табылғаннан басым
  const LANG_BY_CODE = { kk: 'Kazakh', ru: 'Russian', en: 'English', kazakh: 'Kazakh', russian: 'Russian', english: 'English' };
  // Template режимі: аударудың керегі жоқ — тіл тек тақырып мәтінінде нақты жазылса ғана беріледі,
  // әйтпесе модель тақырыппен/материалмен бірдей тілде жазады.
  const language = mode === 'template'
    ? (parsed.language || null)
    : (LANG_BY_CODE[String(options.language || '').toLowerCase()] || parsed.language);

  // Берілген материалдар (файлдардан алынған толық мәтін) — мазмұн генерациясына контекст ретінде қосылады.
  const materialText = options.materialText && String(options.materialText).trim()
    ? String(options.materialText).trim()
    : '';
  if (materialText) console.log(`[Pipeline] id=${genId} Material text: ${materialText.length} chars`);

  console.log(`[Pipeline] id=${genId} Topic: ${topic.slice(0, 120)}`);
  if (slideCount) console.log(`[Pipeline] id=${genId} Slides: ${slideCount}`);
  if (language)   console.log(`[Pipeline] id=${genId} Language: ${language}`);
  if (style)      console.log(`[Pipeline] id=${genId} Style: ${style}`);
  if (coverMeta && (coverMeta.checkedBy || coverMeta.performedBy || coverMeta.group)) {
    console.log(`[Pipeline] id=${genId} Cover meta:`, coverMeta);
  }

  // 0a. Промттағы талаптар (мұғалім/клиент жазған мәтін) → RequirementSet. Қате болса талапсыз жалғасады.
  let reqSet = null; let reqNote = null; let reqBrief = '';
  if (options.requirements && String(options.requirements).trim()) {
    try {
      const pr = await REQ.parseRequirements(options.requirements, { llm: options.requirementsLlm, maxChars: options.requirementsMaxChars || 12000 });
      if (pr.set.items.length) {
        reqSet = pr.set;
        const eff = REQ.effectiveSlideCount(reqSet, slideCount);
        if (eff.count && eff.count !== slideCount) { slideCount = eff.count; reqNote = eff.note; }
        reqBrief = REQ.briefFromRequirements(reqSet);
        console.log(`[Pipeline] id=${genId} Requirements: ${reqSet.items.length} item(s) (llm=${pr.llm})${reqNote ? ' · ' + reqNote : ''}`);
      }
    } catch (e) { console.warn(`[Pipeline] id=${genId} Requirements ignored: ${e.message}`); }
  }

  // 0. Референс PPTX → Design DNA + құрылым (тек PPTX; ақысыз, XML талдау). Референс промттан басым.
  let refTheme = null; let refDna = null; let refAnalysis = null;
  const referencePptxBuf = options.referencePptx && options.referencePptx.length
    ? (Buffer.isBuffer(options.referencePptx) ? options.referencePptx : Buffer.from(options.referencePptx, 'base64'))
    : null;
  if (referencePptxBuf) {
    try {
      refAnalysis = analyzeReference(referencePptxBuf);
      refDna = refAnalysis.dna; refTheme = refAnalysis.theme;
      console.log(`[Pipeline] id=${genId} Reference: ${refAnalysis.summaryLines.join(' | ')}`);
      if (refAnalysis.warnings.includes('too_large')) { refAnalysis = null; refDna = null; refTheme = null; throw new Error('reference too large'); }
      if (!refAnalysis.warnings.includes('image_only')) {
        const n0 = refAnalysis.outline.slideCount;
        if (slideCount !== n0) reqNote = `Слайд саны референс бойынша ${n0}${slideCount ? ` (формада/промтта ${slideCount} еді)` : ''}`;
        slideCount = n0;
        // промттағы слайд саны талабы референспен қайшы болса, референс жеңеді
        if (reqSet) reqSet.items = reqSet.items.filter((i) => !(i.kind === 'hard' && i.check === 'slide_count'));
        let refIt = referenceItems(refAnalysis.outline).map((it, i) => ({ id: 'ref' + (i + 1), ...it }));
        if (mode === 'template') {
          // Шаблон тек ФОРМА береді: мазмұнға байланған талаптар (мақсат/міндет/кіріспе/өзектілік) қойылмайды,
          // шаблонның бөлім атаулары мен қаңқасы LLM-ге берілмейді (құрылымды templateStory тақырыптан құрады).
          refIt = refIt.filter((it) => it.check === 'slide_count' || ['agenda', 'conclusion', 'references', 'thanks'].includes(it.value));
        } else {
          reqBrief += refAnalysis.brief;
        }
        reqSet = { v: 1, items: (reqSet ? reqSet.items : []).concat(refIt) };
      } else {
        refAnalysis.outline = null; // сенімсіз құрылымды қолданбаймыз, тек түсті
      }
    } catch (e) { console.warn(`[Pipeline] id=${genId} Reference ignored: ${e.message}`); refAnalysis = null; refDna = refDna && refTheme ? refDna : null; }
  }
  // Template-fill: шаблонның әр қорабының сыйымдылығын LLM-ге береміз (мәтін бірден дұрыс ұзындықта жазылсын, «…» арқылы кесілмесін)
  let slotRules = null;
  let slotPlan = null;
  if (mode === 'template' && referencePptxBuf && refAnalysis && refAnalysis.outline) {
    try {
      const plan = planTemplateSlots(referencePptxBuf);
      slotPlan = plan;
      slotRules = plan.map((p, k) => slotRuleLine(p, k + 1));
      console.log(`[Pipeline] id=${genId} Template slots planned: ${plan.length} слайд`);
    } catch (e) { console.warn(`[Pipeline] id=${genId} Slot plan failed (continuing): ${e.message}`); slotRules = null; }
  }
  const briefBase = materialText
    ? `${userInput}\n\n[SOURCE MATERIALS PROVIDED BY THE USER — study fully, use its structure, facts, sections and requirements]\n${materialText}`
    : userInput;
  const briefForLlm = (refDna && mode !== 'template'
    ? `${briefBase}\n\nReference style (client's own PPTX): ${refDna.summary}. Keep each slide to at most ~${refTheme.maxWordsPerSlide} words.`
    : briefBase) + reqBrief;

  // Template → Content: кәсіби әңгіме желісі ТАҚЫРЫПТАН құрылады (шаблонның мәтіні/бөлім атаулары қолданылмайды)
  let storyOutline = null;
  if (slotPlan) {
    await onProgress('content', 'Презентация құрылымы жоспарлануда...');
    storyOutline = await planStoryline({
      topic, brief: briefBase.slice(0, 12000), language, plan: slotPlan, outline: refAnalysis && refAnalysis.outline,
    });
    if (storyOutline) console.log(`[Pipeline] id=${genId} Template storyline: «${storyOutline.title}» — ${storyOutline.slideTopics.length} слайд`);
  }

  // 1. Мазмұн генерациясы
  await onProgress('content', 'Мазмұн жазылуда...');
  console.log('[Pipeline] Generating content...');
  let presentation = await generateSlides(topic, {
    slideCount, language, style, clientBrief: briefForLlm, coverMeta, slotRules, outline: storyOutline,
  });
  // Модель кейде тақырып тілінде жазып кетеді (орысша таңдалса да қазақша шығады) → 1 рет қайта жазамыз
  const langIssue = mode === 'template' ? null : languageMismatch(presentation && presentation.slides, language);
  if (langIssue) {
    console.warn(`[Pipeline] Language mismatch (${langIssue}) — regenerating once`);
    try {
      const retry = await generateSlides(topic, {
        slideCount, language, style, coverMeta, slotRules,
        clientBrief: userInput + reqBrief + `\n\n[IMPORTANT: write the ENTIRE presentation in ${language}. The topic above may be in another language — translate it.]`,
      });
      if (retry && Array.isArray(retry.slides) && retry.slides.length >= 2 && !languageMismatch(retry.slides, language)) presentation = retry;
      else console.warn('[Pipeline] Regeneration did not fix the language — keeping first result');
    } catch (e) { console.warn('[Pipeline] Language regeneration failed:', e.message); }
  }
  if (!presentation || !Array.isArray(presentation.slides) || presentation.slides.length < 2) {
    throw new Error('Content generation returned too few slides');
  }
  console.log(`[Pipeline] ${presentation.slides.length} slides generated`);
  if (mode !== 'template' && ensureIntroSlide(presentation.slides, language)) console.log('[Pipeline] Intro slide enforced (slide 2)');

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

  // 2b'. Table cap: the model tends to turn most slides into tables → keep a few, rest become bullets
  {
    const converted = limitTables(slides);
    if (converted) console.log(`[Pipeline] Tables → bullets on ${converted} slide(s) (variety)`);
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

  // 2e. Colour theme + decoration are chosen by CODE (the LLM always copied the same dark/gold example)
  {
    const mood = applyDeckTheme(slides, { seed: `${topic}|${genId}`, style, brief: userInput, refTheme });
    console.log(`[Pipeline] Theme: ${mood}`);
  }

  // 2f. Референс құрылымын слайдтарға қолдану (макет түрі + мазмұнды сәйкестендіру)
  if (refAnalysis && refAnalysis.outline) {
    const rp = applyReferencePlan(slides, refAnalysis.outline);
    console.log(`[Pipeline] Reference plan applied to ${rp.assigned} slide(s)${rp.adapted.length ? '; adapted: ' + rp.adapted.map((x) => `${x.n}:${x.what}`).join(', ') : ''}`);
  }

  // 2g. Талаптар бойынша автоматты QA: тексер → түзет → қайта тексер (Mode 2).
  //     Template режимінде референс талаптары құрылым арқылы орындалады — бұл цикл
  //     мұғалім/клиент талаптары үшін ғана жұмыс істейді (соңында бөлек есеп беріледі).
  let reqQaResult = null;
  if (reqSet && reqSet.items.length && mode !== 'template') {
    await onProgress('qa', 'Талаптар бойынша тексеру...');
    try {
      reqQaResult = await REQ.runRequirementsQa(reqSet, slides, {
        language,
        title,
        topic,
        checkers: {},
        overrides: reqNote ? [reqNote] : [],
      });
      slides = reqQaResult.slides;
      slides.forEach((slide, i) => { slide.index = i + 1; });
      const hardTotal = reqQaResult.report.summary.hardTotal;
      const hardPassed = reqQaResult.report.summary.hardPassed;
      console.log(`[Pipeline] Requirements QA: ${hardPassed}/${hardTotal} ✓ (rounds=${reqQaResult.rounds}, repairs=${reqQaResult.repaired.length})`);
      if (reqQaResult.repaired.length) {
        // Слайдтар өзгерген соң тема мен композицияны қайта қолданамыз (жаңа слайдтар да безендірілсін)
        try {
          applyDeckTheme(slides, { seed: `${topic}|${genId}`, style, brief: userInput, refTheme });
          if (refAnalysis && refAnalysis.outline) applyReferencePlan(slides, refAnalysis.outline);
        } catch (e) { console.warn('[Pipeline] re-theme after QA failed:', e.message); }
      }
    } catch (err) {
      console.warn(`[Pipeline] Requirements QA loop error (continuing): ${err.message}`);
    }
  }

  // 2h. Шығыс айнымалылары + TEMPLATE-FILL (Mode 3): шаблон дизайнын мүлдем өзгертпей,
  //     тек ішіндегі мәтінді жаңа тақырып мәтінімен ауыстырамыз (HTML/рендер жасалмайды).
  let htmlPath = null;
  let pptxPath = null;
  let pngPaths = [];
  let tmpDir = null;
  let overflowWarnings = [];
  let visionMeta = { overallScore: null, source: 'skipped', applied: [] };
  let visualStats = { ok: 0, requested: 0 };

  cost.setSlides(slides.length);
  cost.setQuality(qualityMeta.iterations || 0, (qualityMeta.repairedSlides || []).length);

  const isTemplateFill = mode === 'template' && referencePptxBuf && refAnalysis && refAnalysis.outline;
  if (isTemplateFill) {
    // Толтырудан бұрын: мәтін шаблон қораптарының лимитіне сәйкес пе? Сәйкес емес слайдтарды LLM ақау бойынша қайта жазады (≤3 айналым)
    try {
      await onProgress('template', 'Шаблон макетін тексеру...');
      const rep = await repairTemplateSlides({ templateBuf: referencePptxBuf, slides, topic, language });
      slides = rep.slides;
      slides.forEach((slide, i) => { slide.index = i + 1; });
      console.log(`[Pipeline] Template layout check: issues ${rep.before} → ${rep.after}, rounds=${rep.rounds}, fixedSlides=[${rep.fixedSlides.join(',')}]${rep.remaining.length ? ' remaining=' + rep.remaining.map((a) => a.index + ':' + a.issues.map((i) => i.code).join('/')).join(' ') : ''}`);
    } catch (err) {
      console.warn(`[Pipeline] Template layout check failed (continuing): ${err.message}`);
    }
    // LLM орналасу жоспары: қай мәтін қай қорапқа, кегль, кедергіні жылжыту. Қате болса — детерминді толтыру (layout = null).
    let layout = null;
    try {
      await onProgress('template', 'Мәтін орналасуын жоспарлау...');
      layout = await planLayout({ templateBuf: referencePptxBuf, slides, topic, language });
      console.log(`[Pipeline] Template layout plan: ${layout.filter(Boolean).length}/${layout.length} slides planned by LLM`);
    } catch (err) {
      console.warn(`[Pipeline] Template layout plan failed (continuing): ${err.message}`);
    }
    await onProgress('template', 'Шаблонға мәтін салынуда...');
    try {
      pptxPath = path.join(os.tmpdir(), `template-${uniqueId()}.pptx`);
      fs.writeFileSync(pptxPath, fillTemplatePptx(referencePptxBuf, slides, { language, layout }));
      console.log('[Pipeline] Template-Fill: PPTX = пайдаланушы шаблоны, тек мәтін ауыстырылды');
    } catch (err) {
      // Рендерге (сурет-слайд) түспейміз: клиентке өңделетін PPTX керек. Қате болса — кредит қайтарылады.
      console.warn('[Pipeline] Template-Fill failed:', err.message);
      throw new Error(`template_fill_failed: ${err.message}`);
    }
  }

  if (!pptxPath) {
  // 3. Суреттер мен визуалдар (SVG диаграмма/инфографика) — бір мезгілде, бірін-бірі күтпейді.
  //    Екеуі де ЕШҚАШАН лақтырмайды: сәтсіз болса, слайд қалыпты күйінде қалады.
  await onProgress('media', 'Суреттер мен диаграммалар...');
  console.log('[Pipeline] Fetching images + drawing visuals...');
  const usedImages = new Set(); // бір сурет екі слайдқа түспесін
  const deckQueries = slides.map((sl) => (typeof sl.imageQuery === 'string' ? sl.imageQuery.trim() : '')).filter(isLatinQuery);
  const imagesTask = mapLimit(slides, 3, async (slide) => {
    // Сурет іздеу тек ағылшынша (латын) сұранысқа. Қазақша/орысша сұраныс ЕШҚАШАН жіберілмейді.
    const raw = typeof slide.imageQuery === 'string' ? slide.imageQuery.trim() : '';
    const query = isLatinQuery(raw) ? raw : '';
    if (raw && !query) console.warn(`[Image] non-English imageQuery ignored: "${raw.slice(0, 60)}"`);
    // image:"none" слайдтарға (кесте/диаграмма) сурет керек емес — бекер іздемейміз
    if (slide.composition && slide.composition.image === 'none') return null;
    console.log(`[Image] query="${query}"`);
    try {
      return await fetchImageWithFallback(query, topic, usedImages, deckQueries);
    } catch (err) {
      // Бір слайдтың суреті ешқашан бүкіл презентацияны құлатпауы керек
      console.warn(`[Image] slide failed, using fallback background: ${err.message}`);
      return null;
    }
  });
  const visualsTask = attachVisuals(slides, { language });
  const [images, visualStatsOut] = await Promise.all([imagesTask, visualsTask]);
  visualStats = visualStatsOut;
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
    fs.writeFileSync(pathHtml, build3DPresentationHTML(slides, title, { style, skin: refAnalysis ? refAnalysis.skin : null, refRoles: refAnalysis ? refAnalysis.outline.roles : null }), 'utf8');
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
  } // end if (!pptxPath) — Template-Fill режимінде бұл блок өткізіледі

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

  // Талаптар есебі (soft бағалау 1 LLM шақыру; сәтсіз болса есеп балсыз қалады)
  let requirementsReport = null;
  let templateReport = null;
  if (reqQaResult) {
    // Mode 2: цикл ішінде жасалған есепті қолданамыз (қосымша LLM шақыру керек емес)
    requirementsReport = reqQaResult.report;
  } else if (reqSet) {
    try {
      if (refAnalysis && refAnalysis.outline) {
        const lm = layoutMatch(slides);
        console.log(`[Pipeline] id=${genId} Reference layout match: ${lm.ok}/${lm.total} (${lm.pct}%)${lm.miss.length ? ' · ' + lm.miss.join('; ') : ''}`);
        if (lm.total) reqSet = { v: 1, items: reqSet.items.concat([{ id: 'refm', kind: 'hard', check: 'layout_match', op: '>=', value: 70, quote: 'Референс PPTX: макеттер сәйкестігі', source: 'reference' }]) };
      }
      requirementsReport = await REQ.auditSlides(reqSet, slides, {
        overrides: reqNote ? [reqNote] : [],
        checkers: { layout_match: (item, sl) => { const lm = layoutMatch(sl); return lm.pct >= item.value ? { status: 'pass', actual: lm.pct, message: `${lm.ok}/${lm.total}` } : { status: 'fail', actual: lm.pct, message: `${lm.ok}/${lm.total} макет сәйкес` + (lm.miss.length ? ': ' + lm.miss.slice(0, 3).join('; ') : '') }; } },
      });
    }
    catch (e) { console.warn(`[Pipeline] id=${genId} Requirement audit failed: ${e.message}`); }
  }

  // Template QA (Mode 3): шаблон дизайнының сақталуын өлшейтін бөлек есеп
  if (refAnalysis && refAnalysis.outline) {
    try {
      templateReport = buildTemplateReport(refAnalysis, slides, { refTheme, style });
      console.log(`[Pipeline] id=${genId} Template QA: ${templateReport.summary}${templateReport.checks.some((c) => c.status === 'fail') ? ' · fails: ' + templateReport.checks.filter((c) => c.status === 'fail').map((c) => c.name).join(', ') : ''}`);
    } catch (e) { console.warn(`[Pipeline] id=${genId} Template QA failed: ${e.message}`); }
  }

  setActiveCostTracker(null);
  return {
    requirementsReport,
    templateReport,
    mode,
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
