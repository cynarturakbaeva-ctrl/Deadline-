'use strict';

/**
 * Vision-based Presentation Art Director / Critic.
 *
 * Looks at RENDERED slide PNGs (not JSON), returns art-director issues,
 * and applies bounded redesign actions to slide data for a re-render pass.
 *
 * Providers (first available):
 *   - Anthropic Claude (ANTHROPIC_API_KEY) — vision
 *   - Google Gemini (GOOGLE_API_KEY or GEMINI_API_KEY) — vision
 *
 * If no vision key: falls back to lightweight PNG heuristics only (no fake "I saw the slide").
 */

const fs = require('fs');
const path = require('path');
const { recordApiUsage } = require('./cost');
const { repairSlideComposition, ensureComposition } = require('./composition');

const VISION_ENABLED = process.env.VISION_CRITIC !== '0';
const MAX_SLIDES_TO_VISION = Math.max(1, Math.min(8, parseInt(process.env.VISION_MAX_SLIDES || '6', 10) || 6));
const MIN_SCORE_ACCEPT = Number(process.env.VISION_ACCEPT_SCORE) || 72;

function isVisionAvailable() {
  if (!VISION_ENABLED) return false;
  return !!(process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
}

function pngToBase64(pngPath) {
  const buf = fs.readFileSync(pngPath);
  // Cap ~1.2MB raw → vision APIs; if larger, still send (model may downscale)
  return buf.toString('base64');
}

function heuristicFromPng(pngPath, slide, index) {
  const issues = [];
  try {
    const buf = fs.readFileSync(pngPath);
    const size = buf.length;
    // Very small PNG ≈ blank / near-blank
    if (size < 12_000) {
      issues.push({
        code: 'blank_or_empty_visual',
        severity: 'critical',
        slideIndex: index + 1,
        explanation: 'Rendered PNG is extremely small — likely blank or near-empty',
        redesign: 'force_center_full_content',
      });
    } else if (size < 35_000) {
      issues.push({
        code: 'sparse_visual',
        severity: 'high',
        slideIndex: index + 1,
        explanation: 'Rendered PNG is very light — weak visual presence',
        redesign: 'enrich_or_recenter',
      });
    }
  } catch {
    /* ignore */
  }

  const bullets = Array.isArray(slide?.bullets) ? slide.bullets.filter(Boolean) : [];
  if (bullets.length >= 6) {
    issues.push({
      code: 'text_document_feel',
      severity: 'high',
      slideIndex: index + 1,
      explanation: 'Six or more bullets read as a document, not a presentation slide',
      redesign: 'reduce_bullets_to_4',
    });
  }
  if (bullets.length <= 1 && !slide?.body && !(slide?.stats && slide.stats.length) && !(slide?.visualSvg)) {
    issues.push({
      code: 'underfilled_slide',
      severity: 'medium',
      slideIndex: index + 1,
      explanation: 'Slide has almost no content structure',
      redesign: 'enrich_or_recenter',
    });
  }
  return issues;
}

/**
 * Call Anthropic Claude vision on up to N slide thumbnails.
 */
async function criticAnthropic(slides, pngPaths, title, topic) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.VISION_ANTHROPIC_MODEL || process.env.VISUAL_ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

  const n = Math.min(pngPaths.length, slides.length, MAX_SLIDES_TO_VISION);
  // Sample: cover, middle, conclusion + weakest by heuristic size
  const indices = pickSlideIndices(n, pngPaths.length);

  const content = [
    {
      type: 'text',
      text: `You are an art director reviewing a presentation titled "${title}" (topic: ${String(topic).slice(0, 200)}).
You SEE the rendered slides as images. Judge visual design quality for a real human audience (university / professional).

Return JSON only:
{
  "overallScore": 0-100,
  "issues": [
    {
      "slideIndex": 1,
      "code": "empty_half|text_wall|generic_stock|weak_hierarchy|repetitive_layout|sparse|clutter|bad_contrast|document_not_slide|weak_conclusion",
      "severity": "critical|high|medium|low",
      "explanation": "one sentence art-director note",
      "redesign": "force_center|reduce_bullets_to_4|drop_half_image|hero_simpler|strengthen_conclusion|switch_to_diagram_hint|none"
    }
  ]
}
Max 10 issues. Be strict about empty panels, text-document slides, and repetitive layouts.
Prefer redesign actions that change composition, not full content rewrite.`,
    },
  ];

  for (const i of indices) {
    const b64 = pngToBase64(pngPaths[i]);
    const st = slides[i] || {};
    content.push({
      type: 'text',
      text: `Slide ${i + 1}: title="${String(st.title || '').slice(0, 80)}" bullets=${Array.isArray(st.bullets) ? st.bullets.length : 0}`,
    });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: b64 },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        messages: [{ role: 'user', content }],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.warn(`[Vision] Anthropic HTTP ${res.status}: ${t.slice(0, 120)}`);
      return null;
    }
    const data = await res.json();
    recordApiUsage(data.usage ? {
      input_tokens: data.usage.input_tokens,
      output_tokens: data.usage.output_tokens,
    } : null, { label: 'vision:anthropic', model });
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    return parseCriticJson(text);
  } catch (err) {
    console.warn(`[Vision] Anthropic error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Google Gemini vision critic.
 */
async function criticGemini(slides, pngPaths, title, topic) {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.VISION_GEMINI_MODEL || 'gemini-2.0-flash';

  const indices = pickSlideIndices(Math.min(pngPaths.length, MAX_SLIDES_TO_VISION), pngPaths.length);
  const parts = [
    {
      text: `Art-director review of presentation "${title}". Topic: ${String(topic).slice(0, 200)}.
Return JSON only: {"overallScore":0-100,"issues":[{"slideIndex":1,"code":"...","severity":"high","explanation":"...","redesign":"force_center|reduce_bullets_to_4|drop_half_image|hero_simpler|strengthen_conclusion|none"}]}
Judge the IMAGES. Flag empty halves, text walls, sparse slides, repetitive layouts.`,
    },
  ];
  for (const i of indices) {
    parts.push({ text: `Slide ${i + 1}: ${String((slides[i] && slides[i].title) || '').slice(0, 80)}` });
    parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: pngToBase64(pngPaths[i]),
      },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2000, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) {
      console.warn(`[Vision] Gemini HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
    // Gemini usage metadata if present
    if (data.usageMetadata) {
      recordApiUsage({
        prompt_tokens: data.usageMetadata.promptTokenCount,
        completion_tokens: data.usageMetadata.candidatesTokenCount,
        total_tokens: data.usageMetadata.totalTokenCount,
      }, { label: 'vision:gemini', model });
    } else {
      recordApiUsage(null, { label: 'vision:gemini', model });
    }
    return parseCriticJson(text);
  } catch (err) {
    console.warn(`[Vision] Gemini error: ${err.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseCriticJson(text) {
  if (!text) return null;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const raw = JSON.parse(m[0]);
    const issues = (Array.isArray(raw.issues) ? raw.issues : []).slice(0, 12).map((it) => ({
      code: String(it.code || 'visual_issue'),
      severity: String(it.severity || 'medium'),
      slideIndex: Number(it.slideIndex) || 0,
      explanation: String(it.explanation || '').slice(0, 280),
      redesign: String(it.redesign || 'none'),
    }));
    const overallScore = Number(raw.overallScore);
    return {
      overallScore: Number.isFinite(overallScore) ? overallScore : 70,
      issues,
      source: 'vision',
    };
  } catch {
    return null;
  }
}


/**
 * Detect deck-level visual monotony from composition metadata + PNG sizes.
 */
function detectRepetitivePatterns(slides, pngPaths) {
  const issues = [];
  const layouts = (slides || []).map((s) => {
    const c = s.composition || {};
    return `${c.image || 'none'}|${c.layout || 'single'}|${c.textPosition || ''}`;
  });
  // 3+ consecutive identical composition signatures
  let run = 1;
  for (let i = 1; i < layouts.length; i++) {
    if (layouts[i] === layouts[i - 1] && layouts[i].includes('full_background')) {
      run++;
      if (run >= 3) {
        issues.push({
          code: 'repetitive_layout',
          severity: 'high',
          slideIndex: i + 1,
          explanation: `Same composition repeated ${run}+ times (card/full-bleed monotony)`,
          redesign: 'force_center',
        });
        run = 1;
      }
    } else {
      run = 1;
    }
  }
  // Many half layouts with tiny PNGs → empty-half pattern
  for (let i = 0; i < Math.min((slides || []).length, (pngPaths || []).length); i++) {
    const c = (slides[i] && slides[i].composition) || {};
    const half = c.image === 'right_half' || c.image === 'left_half';
    let size = 0;
    try { size = fs.statSync(pngPaths[i]).size; } catch {}
    if (half && size > 0 && size < 80000) {
      issues.push({
        code: 'empty_half',
        severity: 'high',
        slideIndex: i + 1,
        explanation: 'Half-image layout with weak rendered visual mass',
        redesign: 'drop_half_image',
      });
    }
  }
  return issues;
}

function pickSlideIndices(want, total) {
  if (total <= 0) return [];
  if (total <= want) return [...Array(total).keys()];
  const set = new Set([0, total - 1, Math.floor(total / 2)]);
  for (let i = 1; i < total - 1 && set.size < want; i++) set.add(i);
  return [...set].sort((a, b) => a - b).slice(0, want);
}

/**
 * Apply redesign actions to slide objects (deterministic, bounded).
 */
function applyVisionRedesign(slides, critique) {
  if (!critique || !Array.isArray(critique.issues)) {
    return { slides, applied: [] };
  }
  const out = slides.map((s) => ({
    ...s,
    composition: s.composition ? { ...s.composition } : {},
    bullets: Array.isArray(s.bullets) ? [...s.bullets] : s.bullets,
  }));
  const applied = [];

  for (const iss of critique.issues) {
    const idx = (iss.slideIndex || 0) - 1;
    if (idx < 0 || idx >= out.length) continue;
    const s = out[idx];
    const action = iss.redesign || 'none';
    const c = ensureComposition(s);

    if (action === 'force_center' || action === 'force_center_full_content' || action === 'drop_half_image' || action === 'hero_simpler') {
      c.image = 'full_background';
      c.textPosition = 'center';
      c.overlay = 'dark_gradient_bottom';
      c.layout = 'single_column';
      c.decorative = [];
      applied.push({ index: idx + 1, action });
    } else if (action === 'enrich_or_recenter') {
      c.textPosition = 'center';
      c.image = c.image === 'right_half' || c.image === 'left_half' ? 'full_background' : c.image;
      applied.push({ index: idx + 1, action });
    } else if (action === 'reduce_bullets_to_4') {
      if (Array.isArray(s.bullets) && s.bullets.length > 4) {
        s.bullets = s.bullets.slice(0, 4);
        applied.push({ index: idx + 1, action });
      }
    } else if (action === 'strengthen_conclusion') {
      c.image = 'full_background';
      c.textPosition = 'center';
      c.overlay = 'dark_full';
      if (Array.isArray(s.bullets) && s.bullets.length < 2) {
        const prevTitles = out.slice(1, -1).map((x) => x.title).filter(Boolean).slice(0, 3);
        s.bullets = prevTitles.map((t) => String(t).slice(0, 60));
      }
      applied.push({ index: idx + 1, action });
    } else if (iss.code === 'empty_half' || iss.code === 'sparse') {
      c.image = 'full_background';
      c.textPosition = 'center';
      applied.push({ index: idx + 1, action: 'fix_empty_half' });
    }

    // Always run composition repair after vision-driven changes
    const repaired = repairSlideComposition(s, {});
    out[idx] = repaired.slide;
  }

  out.forEach((s, i) => { s.index = i + 1; });
  return { slides: out, applied };
}

/**
 * Full vision pass: heuristics + optional multimodal critic.
 */
async function runVisionCritic(opts) {
  const {
    slides,
    pngPaths,
    title = '',
    topic = '',
  } = opts || {};

  if (!Array.isArray(pngPaths) || !pngPaths.length) {
    return {
      overallScore: 50,
      issues: [],
      source: 'none',
      applied: [],
      slides,
      skipped: true,
    };
  }

  // Always collect heuristics from actual PNG bytes + slide structure
  let issues = [];
  for (let i = 0; i < Math.min(pngPaths.length, slides.length); i++) {
    issues = issues.concat(heuristicFromPng(pngPaths[i], slides[i], i));
  }
  issues = issues.concat(detectRepetitivePatterns(slides, pngPaths));

  let vision = null;
  if (isVisionAvailable()) {
    vision = await criticAnthropic(slides, pngPaths, title, topic);
    if (!vision) vision = await criticGemini(slides, pngPaths, title, topic);
  } else {
    console.log('[Vision] No vision API key (ANTHROPIC_API_KEY or GOOGLE_API_KEY) — heuristic only');
  }

  if (vision && Array.isArray(vision.issues)) {
    issues = [...issues, ...vision.issues];
  }

  // Dedupe by slide+code
  const seen = new Set();
  issues = issues.filter((it) => {
    const k = `${it.slideIndex}|${it.code}|${it.redesign}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let overallScore = vision && Number.isFinite(vision.overallScore)
    ? vision.overallScore
    : Math.max(40, 92 - issues.length * 6);

  // Penalize criticals
  for (const it of issues) {
    if (it.severity === 'critical') overallScore = Math.min(overallScore, 55);
    if (it.severity === 'high') overallScore = Math.min(overallScore, overallScore);
  }

  const critique = {
    overallScore: Math.max(0, Math.min(100, Math.round(overallScore))),
    issues,
    source: vision ? vision.source : 'heuristic',
  };

  const needRedesign = critique.overallScore < MIN_SCORE_ACCEPT
    || issues.some((i) => i.severity === 'critical' || i.severity === 'high');

  let applied = [];
  let nextSlides = slides;
  if (needRedesign) {
    const r = applyVisionRedesign(slides, critique);
    nextSlides = r.slides;
    applied = r.applied;
  }

  return {
    ...critique,
    applied,
    slides: nextSlides,
    needRedesign,
    skipped: false,
  };
}

module.exports = {
  runVisionCritic,
  applyVisionRedesign,
  isVisionAvailable,
  heuristicFromPng,
  MIN_SCORE_ACCEPT,
};
