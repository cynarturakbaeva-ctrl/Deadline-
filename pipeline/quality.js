'use strict';


const META_LEAK_RE = /opening\s*visual|executive\s*overview|line\s*chart|slide\s*structure|full.?bleed|hero\s*slide|design\s*instruction|тақырыпты бірден|күшті opening|уақыт шкаласы немесе/i;


const { recordApiUsage } = require('./cost');

/**
 * Structured quality-control subsystem for DeadLine.
 *
 * Flow:
 *   GENERATE → deterministicQa → llmCritic → rank → targeted repair
 *            → (optional re-critic) → accept best version
 *
 * Cost-aware: LLM critic is skipped when deterministic score is already high,
 * or when DEEPSEEK_API_KEY is missing. Max repair iterations is hard-capped.
 * Never throws on critique failure — falls back to deterministic results.
 */

const SEVERITY = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });
const SEVERITY_NAME = Object.freeze({ 4: 'critical', 3: 'high', 2: 'medium', 1: 'low' });

const ISSUE_CODES = Object.freeze([
  'empty_slide',
  'weak_title',
  'filler',
  'repetition',
  'low_density',
  'high_density',
  'unsupported_claim',
  'narrative_gap',
  'weak_conclusion',
  'bad_image_query',
  'layout_risk',
  'inconsistent_mood',
  'missing_subtitle',
  'bullet_noise',
  'stat_without_context',
  'meta_instruction_leak',
]);

const MAX_REPAIR_ITERATIONS = Math.max(0, Math.min(3, parseInt(process.env.QUALITY_MAX_REPAIR || '2', 10) || 2));
const ACCEPT_SCORE = Math.max(50, Math.min(95, parseInt(process.env.QUALITY_ACCEPT_SCORE || '72', 10) || 72));
const SKIP_LLM_SCORE = Math.max(ACCEPT_SCORE, parseInt(process.env.QUALITY_SKIP_LLM_SCORE || '85', 10) || 85);
const CRITIC_TIMEOUT_MS = 60_000;
const REPAIR_TIMEOUT_MS = 90_000;
const DEEPSEEK_MODEL = process.env.QUALITY_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

// ─── Helpers ──────────────────────────────────────────────────────────────

function words(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean);
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function cloneSlides(slides) {
  return JSON.parse(JSON.stringify(slides || []));
}

function issue(slideIndex, code, severity, message, repairAction) {
  return {
    slideIndex: slideIndex == null ? null : slideIndex,
    code: String(code),
    severity: SEVERITY_NAME[severity] || 'medium',
    severityRank: severity,
    message: String(message || '').slice(0, 240),
    repairAction: repairAction || 'rewrite_content',
  };
}

function scoreFromIssues(issues, slideCount) {
  if (!slideCount) return 0;
  let penalty = 0;
  for (const iss of issues) {
    const w = iss.severityRank || SEVERITY[iss.severity] || 2;
    penalty += w === 4 ? 18 : w === 3 ? 10 : w === 2 ? 5 : 2;
  }
  // Cap so a few issues don't zero the score entirely
  penalty = Math.min(penalty, 70);
  return Math.max(0, Math.min(100, 100 - penalty));
}

// ─── Deterministic QA ─────────────────────────────────────────────────────

const FILLER_RE = /\b(в современном мире|в наше время|важно отметить|следует отметить|как известно|it is important|in today's world|it should be noted|өте маңызды|қазіргі заманда|атап өткен жөн)\b/i;
const VAGUE_TITLE_RE = /^(кіріспе|введение|introduction|conclusion|қорытынды|заключение|обзор|overview|about|туралы|негіздер|основы|basics)$/i;
const FAKE_STAT_RE = /\b(99\.9%|1000x|миллиардтан астам|over a billion|countless|безграничн)\b/i;

function deterministicQa(slides, title, topic) {
  const issues = [];
  const list = Array.isArray(slides) ? slides : [];
  const titles = [];
  const bulletBags = [];

  list.forEach((s, i) => {
    const idx = s.index != null ? s.index : i + 1;
    const t = String(s.title || '').trim();
    const sub = String(s.subtitle || '').trim();
    const body = String(s.body || '').trim();
    const bullets = Array.isArray(s.bullets) ? s.bullets.map((b) => String(b || '').trim()).filter(Boolean) : [];
    const stats = Array.isArray(s.stats) ? s.stats : [];
    const hasTable = !!(s.table && (s.table.headers || s.table.rows));
    const contentWords = words(t).length + words(sub).length + words(body).length
      + bullets.reduce((n, b) => n + words(b).length, 0);

    if (!t && !body && !bullets.length && !stats.length && !hasTable) {
      issues.push(issue(idx, 'empty_slide', SEVERITY.critical, 'Slide has no meaningful content', 'rewrite_content'));
    }

    if (t && (words(t).length > 14 || VAGUE_TITLE_RE.test(t) || t.length < 3)) {
      issues.push(issue(idx, 'weak_title', SEVERITY.high,
        words(t).length > 14 ? 'Title too long (>14 words)' : 'Title is vague or too short',
        'rewrite_title'));
    }

    if (!sub && i > 0 && i < list.length - 1) {
      issues.push(issue(idx, 'missing_subtitle', SEVERITY.low, 'Middle slide missing subtitle', 'add_subtitle'));
    }

    const textBlob = [t, sub, body, ...bullets].join(' ');
    if (FILLER_RE.test(textBlob)) {
      issues.push(issue(idx, 'filler', SEVERITY.medium, 'Generic filler phrasing detected', 'tighten_copy'));
    }
    if (META_LEAK_RE.test(textBlob) || bullets.some((b) => META_LEAK_RE.test(b))) {
      issues.push(issue(idx, 'meta_instruction_leak', SEVERITY.critical,
        'Slide contains design/outline instructions instead of real content (e.g. fake references)',
        'rewrite_content'));
    }
    if (FAKE_STAT_RE.test(textBlob) || (stats.length && stats.some((st) => FAKE_STAT_RE.test(String(st && st.value))))) {
      issues.push(issue(idx, 'unsupported_claim', SEVERITY.high, 'Suspicious or exaggerated claim/stat', 'remove_or_soften_claim'));
    }

    if (i > 0 && contentWords < 8 && !stats.length && !hasTable) {
      issues.push(issue(idx, 'low_density', SEVERITY.medium, 'Very little content on slide', 'expand_content'));
    }
    if (contentWords > 120 || bullets.length > 6) {
      issues.push(issue(idx, 'high_density', SEVERITY.medium, 'Slide is overcrowded', 'trim_content'));
    }

    if (bullets.some((b) => words(b).length > 18)) {
      issues.push(issue(idx, 'bullet_noise', SEVERITY.low, 'One or more bullets are essay-length', 'shorten_bullets'));
    }

    if (stats.length && !sub && !body && bullets.length === 0 && i > 0) {
      issues.push(issue(idx, 'stat_without_context', SEVERITY.low, 'Stats without explanatory context', 'add_context'));
    }

    const iq = String(s.imageQuery || '');
    if (iq && (iq.length < 4 || /periodic table|screenshot|chart on|text on screen/i.test(iq))) {
      issues.push(issue(idx, 'bad_image_query', SEVERITY.low, 'Image query likely text-heavy or too vague', 'rewrite_image_query'));
    }

    const layout = (s.composition && s.composition.layout) || '';
    const img = (s.composition && s.composition.image) || '';
    if (stats.length >= 2 && (img === 'right_half' || img === 'left_half')) {
      issues.push(issue(idx, 'layout_risk', SEVERITY.medium, 'Multiple stats with split image layout — overflow risk', 'fix_composition'));
    }
    if (layout === 'big_stat_hero' && (bullets.length || body || stats.length > 1)) {
      issues.push(issue(idx, 'layout_risk', SEVERITY.medium, 'big_stat_hero with extra content will be ignored by renderer', 'fix_composition'));
    }

    titles.push(norm(t));
    bulletBags.push(bullets.map(norm));
  });

  // Cross-slide repetition
  for (let i = 0; i < titles.length; i++) {
    if (!titles[i]) continue;
    for (let j = i + 1; j < titles.length; j++) {
      if (titles[i] && titles[i] === titles[j]) {
        issues.push(issue(j + 1, 'repetition', SEVERITY.high, `Duplicate title of slide ${i + 1}`, 'rewrite_title'));
      }
    }
  }
  // Near-duplicate bullet sets between adjacent slides
  for (let i = 1; i < bulletBags.length; i++) {
    const a = new Set(bulletBags[i - 1]);
    const b = bulletBags[i];
    if (b.length >= 2) {
      const overlap = b.filter((x) => a.has(x)).length;
      if (overlap / b.length >= 0.6) {
        issues.push(issue(i + 1, 'repetition', SEVERITY.medium, 'Bullets largely repeat previous slide', 'rewrite_content'));
      }
    }
  }

  // Weak conclusion on last slide
  if (list.length >= 3) {
    const last = list[list.length - 1];
    const lt = String(last.title || '');
    const lb = Array.isArray(last.bullets) ? last.bullets.length : 0;
    if (!lb && words(String(last.body || '')).length < 5 && !/қорытынды|conclusion|резюме|summary|әдебиет|reference/i.test(lt)) {
      issues.push(issue(last.index || list.length, 'weak_conclusion', SEVERITY.medium, 'Closing slide lacks takeaways', 'strengthen_conclusion'));
    }
  }

  // Mood consistency (soft)
  const moods = list.map((s) => (s.composition && s.composition.mood) || 'dark');
  const moodSet = new Set(moods);
  if (moodSet.size > 3) {
    issues.push(issue(null, 'inconsistent_mood', SEVERITY.low, 'Too many mood shifts across deck', 'unify_mood'));
  }

  const score = scoreFromIssues(issues, list.length);
  return {
    source: 'deterministic',
    score,
    issues,
    slideCount: list.length,
    title: title || '',
  };
}

// ─── LLM critic ───────────────────────────────────────────────────────────

async function deepseekJson(systemPrompt, userPrompt, label, timeoutMs, maxTokens) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) {
    const err = new Error('no DEEPSEEK_API_KEY');
    err.skip = true;
    throw err;
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        thinking: { type: 'disabled' },
        temperature: 0.3,
        top_p: 0.9,
        max_tokens: maxTokens || 4000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`[${res.status}] ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    if (data.usage) {
      console.log(`[Quality] ${label} tokens in=${data.usage.prompt_tokens} out=${data.usage.completion_tokens}`);
      recordApiUsage(data.usage, { label: 'quality:' + label, model: DEEPSEEK_MODEL });
    } else {
      recordApiUsage(null, { label: 'quality:' + label, model: DEEPSEEK_MODEL });
    }
    if (!text) throw new Error('empty critic response');
    try {
      return JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('invalid JSON from critic');
      return JSON.parse(m[0]);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

function compactSlidesForCritic(slides) {
  return (slides || []).map((s, i) => ({
    index: s.index != null ? s.index : i + 1,
    title: s.title || null,
    subtitle: s.subtitle || null,
    body: s.body || null,
    bullets: Array.isArray(s.bullets) ? s.bullets.slice(0, 5) : null,
    stats: Array.isArray(s.stats) ? s.stats.slice(0, 3) : null,
    hasTable: !!(s.table && (s.table.headers || s.table.rows)),
    imageQuery: s.imageQuery || null,
    visual: s.visual ? { type: s.visual.type, brief: s.visual.brief } : null,
    composition: s.composition
      ? {
          image: s.composition.image,
          layout: s.composition.layout,
          mood: s.composition.mood,
          textPosition: s.composition.textPosition,
        }
      : null,
  }));
}

async function llmCritic(slides, title, topic, language) {
  const system = `You are a strict presentation quality critic. Respond with valid JSON only. No markdown.
Evaluate the deck for real problems only — do not invent issues. Prefer fewer, precise findings.
Never invent facts. Flag unsupported statistics or vague claims.
Schema:
{
  "score": 0-100,
  "issues": [
    {
      "slideIndex": number|null,
      "code": one of ${ISSUE_CODES.join('|')},
      "severity": "critical"|"high"|"medium"|"low",
      "message": "short reason",
      "repairAction": "rewrite_content"|"rewrite_title"|"tighten_copy"|"trim_content"|"expand_content"|"fix_composition"|"rewrite_image_query"|"strengthen_conclusion"|"remove_or_soften_claim"|"add_subtitle"|"shorten_bullets"|"add_context"|"unify_mood"|"none"
    }
  ]
}
Max 12 issues. slideIndex is 1-based. Use null slideIndex only for deck-wide problems.`;

  const user = `Presentation title: ${title || '(none)'}
Topic / brief (truncated): ${String(topic || '').slice(0, 600)}
Language: ${language || 'same as content'}

Slides JSON:
${JSON.stringify(compactSlidesForCritic(slides))}

Return the critique JSON.`;

  const raw = await deepseekJson(system, user, 'critic', CRITIC_TIMEOUT_MS, 3000);
  const issues = [];
  const rawIssues = Array.isArray(raw.issues) ? raw.issues : [];
  for (const it of rawIssues.slice(0, 12)) {
    if (!it || typeof it !== 'object') continue;
    const sevName = String(it.severity || 'medium').toLowerCase();
    const rank = SEVERITY[sevName] || SEVERITY.medium;
    const code = ISSUE_CODES.includes(String(it.code)) ? String(it.code) : 'filler';
    issues.push(issue(
      it.slideIndex == null ? null : Number(it.slideIndex) || null,
      code,
      rank,
      it.message || code,
      it.repairAction || 'rewrite_content'
    ));
  }
  let score = Number(raw.score);
  if (!Number.isFinite(score)) score = scoreFromIssues(issues, (slides || []).length);
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { source: 'llm', score, issues, slideCount: (slides || []).length, title: title || '' };
}

// ─── Merge / rank ─────────────────────────────────────────────────────────

function mergeCritiques(det, llm) {
  const byKey = new Map();
  const add = (iss) => {
    const key = `${iss.slideIndex || 'd'}|${iss.code}|${iss.message.slice(0, 40)}`;
    const prev = byKey.get(key);
    if (!prev || (iss.severityRank > prev.severityRank)) byKey.set(key, iss);
  };
  (det.issues || []).forEach(add);
  (llm && llm.issues ? llm.issues : []).forEach(add);
  const issues = [...byKey.values()].sort((a, b) => b.severityRank - a.severityRank);
  // Blend scores: trust deterministic floor, LLM can lower more than raise
  const dScore = det.score;
  const lScore = llm && Number.isFinite(llm.score) ? llm.score : dScore;
  const score = Math.round(Math.min(dScore, lScore) * 0.55 + Math.max(dScore, lScore) * 0.45);
  return {
    score: Math.max(0, Math.min(100, score)),
    issues,
    deterministicScore: dScore,
    llmScore: llm ? lScore : null,
    sources: llm ? ['deterministic', 'llm'] : ['deterministic'],
  };
}

function slidesNeedingRepair(critique) {
  const targets = new Map(); // index -> worst issues
  for (const iss of critique.issues || []) {
    if (iss.severityRank < SEVERITY.medium) continue; // low only: skip auto-repair
    if (iss.repairAction === 'none') continue;
    if (iss.slideIndex == null) continue;
    const idx = Number(iss.slideIndex);
    if (!Number.isFinite(idx)) continue;
    if (!targets.has(idx)) targets.set(idx, []);
    targets.get(idx).push(iss);
  }
  return targets;
}

function shouldAttemptRepair(critique) {
  if (!critique || critique.score >= ACCEPT_SCORE) return false;
  const targets = slidesNeedingRepair(critique);
  if (targets.size === 0) return false;
  // Only repair if there is at least one high/critical or 2+ medium
  let weight = 0;
  for (const iss of critique.issues) {
    if (iss.severityRank >= SEVERITY.high) weight += 2;
    else if (iss.severityRank >= SEVERITY.medium) weight += 1;
  }
  return weight >= 2 || [...targets.values()].some((arr) => arr.some((i) => i.severityRank >= SEVERITY.high));
}

// ─── Targeted repair ──────────────────────────────────────────────────────

async function repairTargetedSlides(slides, title, topic, language, style, targets) {
  const indices = [...targets.keys()].sort((a, b) => a - b).slice(0, 4); // cost cap: max 4 slides
  if (!indices.length) return { slides: cloneSlides(slides), repaired: [] };

  const payload = indices.map((idx) => {
    const s = slides.find((x) => (x.index != null ? x.index : null) === idx)
      || slides[idx - 1];
    return {
      index: idx,
      current: s || null,
      issues: (targets.get(idx) || []).map((i) => ({
        code: i.code,
        severity: i.severity,
        message: i.message,
        repairAction: i.repairAction,
      })),
    };
  });

  const system = `You repair specific presentation slides. Return valid JSON only.
Rules:
- Fix ONLY the listed issues. Keep language of the original slide text.
- Do NOT invent statistics, sources, or facts. Soften or remove unsupported claims.
- Keep titles 4-10 words. Bullets 2-4 items, each under 14 words.
- Preserve slide index. Preserve visual field if present unless it is clearly wrong.
- composition: keep mood consistent with neighbors when possible; fix layout_risk by preferring full_background or center text when stats are present.
Schema:
{ "slides": [ { full slide object with index, title, subtitle, body, bullets, stats, table, visual, imageQuery, composition } ] }
Return exactly ${indices.length} slides.`;

  const user = `Presentation title: ${title}
Topic: ${String(topic || '').slice(0, 400)}
Language: ${language || 'original'}
Style: ${style || 'professional'}

Slides to repair:
${JSON.stringify(payload)}

Return repaired slides JSON.`;

  const raw = await deepseekJson(system, user, 'repair', REPAIR_TIMEOUT_MS, 6000);
  const repairedList = Array.isArray(raw.slides) ? raw.slides : [];
  const next = cloneSlides(slides);
  const repaired = [];

  for (const rs of repairedList) {
    if (!rs || typeof rs !== 'object') continue;
    const idx = Number(rs.index);
    if (!Number.isFinite(idx)) continue;
    const pos = next.findIndex((s) => (s.index != null ? s.index : null) === idx);
    const at = pos >= 0 ? pos : idx - 1;
    if (at < 0 || at >= next.length) continue;
    // Merge: keep original visual/image if repair dropped them; never leave empty
    const prev = next[at];
    const merged = {
      ...prev,
      ...rs,
      index: idx,
      title: rs.title || prev.title,
      composition: rs.composition || prev.composition,
      visual: rs.visual !== undefined ? rs.visual : prev.visual,
      imageQuery: rs.imageQuery || prev.imageQuery,
      webImageUrl: prev.webImageUrl,
      visualSvg: prev.visualSvg,
    };
    // Reject empty repair
    const hasContent = !!(merged.title || merged.body
      || (Array.isArray(merged.bullets) && merged.bullets.length)
      || (Array.isArray(merged.stats) && merged.stats.length)
      || merged.table);
    if (!hasContent) continue;
    next[at] = merged;
    repaired.push(idx);
  }

  return { slides: next, repaired };
}

// ─── Main loop ────────────────────────────────────────────────────────────

/**
 * Run quality loop on slide content (pre-render).
 * @returns {{ slides, title, critique, qualityScore, iterations, repairedSlides }}
 */
async function runQualityLoop(opts) {
  const {
    slides: inputSlides,
    title = '',
    topic = '',
    language = null,
    style = null,
    maxIterations = MAX_REPAIR_ITERATIONS,
    enableLlm = true,
  } = opts || {};

  let slides = cloneSlides(inputSlides);
  slides.forEach((s, i) => { if (s && s.index == null) s.index = i + 1; });

  let best = { slides: cloneSlides(slides), score: 0, critique: null };
  let iterations = 0;
  let allRepaired = [];
  let lastCritique = null;

  const maxIter = Math.max(0, Math.min(3, maxIterations));

  for (let round = 0; round <= maxIter; round++) {
    const det = deterministicQa(slides, title, topic);
    let llm = null;

    const tryLlm = enableLlm
      && process.env.DEEPSEEK_API_KEY
      && !(process.env.QUALITY_LLM === '0' || process.env.QUALITY_LLM === 'false')
      && det.score < SKIP_LLM_SCORE;

    if (tryLlm) {
      try {
        llm = await llmCritic(slides, title, topic, language);
      } catch (err) {
        if (!err.skip) console.warn(`[Quality] LLM critic skipped: ${err.message}`);
      }
    } else if (det.score >= SKIP_LLM_SCORE) {
      console.log(`[Quality] score=${det.score} ≥ ${SKIP_LLM_SCORE} — skipping LLM critic`);
    }

    const critique = mergeCritiques(det, llm);
    lastCritique = critique;
    console.log(`[Quality] round=${round} score=${critique.score} issues=${critique.issues.length} sources=${critique.sources.join('+')}`);

    if (critique.score > best.score) {
      best = { slides: cloneSlides(slides), score: critique.score, critique };
    }

    if (critique.score >= ACCEPT_SCORE) {
      console.log(`[Quality] accept score=${critique.score} ≥ ${ACCEPT_SCORE}`);
      break;
    }
    if (round >= maxIter) break;
    if (!shouldAttemptRepair(critique)) {
      console.log('[Quality] no repairable high-severity issues — stop');
      break;
    }

    const targets = slidesNeedingRepair(critique);
    if (!targets.size) break;

    try {
      console.log(`[Quality] repairing slides: ${[...targets.keys()].join(', ')}`);
      const result = await repairTargetedSlides(slides, title, topic, language, style, targets);
      if (!result.repaired.length) {
        console.log('[Quality] repair returned no usable slides — stop');
        break;
      }
      slides = result.slides;
      allRepaired.push(...result.repaired);
      iterations += 1;

      // Post-repair deterministic check: if score collapsed, revert that round
      const post = deterministicQa(slides, title, topic);
      if (post.score + 5 < best.score) {
        console.warn(`[Quality] repair hurt score (${post.score} < ${best.score}) — reverting to best`);
        slides = cloneSlides(best.slides);
        break;
      }
    } catch (err) {
      console.warn(`[Quality] repair failed: ${err.message}`);
      break;
    }
  }

  // Prefer best snapshot if current is worse
  const finalDet = deterministicQa(slides, title, topic);
  if (best.score > finalDet.score + 2) {
    slides = best.slides;
    lastCritique = best.critique || lastCritique;
  }

  const qualityScore = (lastCritique && lastCritique.score) || finalDet.score;
  return {
    slides,
    title,
    critique: lastCritique || finalDet,
    qualityScore,
    iterations,
    repairedSlides: [...new Set(allRepaired)],
  };
}

/**
 * Map render overflow warnings into structured issues (post-render QA).
 */
function renderWarningsToIssues(overflowWarnings) {
  const issues = [];
  for (const w of overflowWarnings || []) {
    const m = String(w).match(/слайд\s+(\d+)/i) || String(w).match(/slide\s+(\d+)/i);
    const idx = m ? parseInt(m[1], 10) : null;
    const critical = /бос|blank|SVG|фигура жүктелмеді/i.test(w);
    issues.push(issue(
      idx,
      critical ? 'empty_slide' : 'layout_risk',
      critical ? SEVERITY.critical : SEVERITY.high,
      String(w).slice(0, 200),
      critical ? 'rewrite_content' : 'fix_composition'
    ));
  }
  return issues;
}

module.exports = {
  runQualityLoop,
  deterministicQa,
  llmCritic,
  mergeCritiques,
  shouldAttemptRepair,
  slidesNeedingRepair,
  repairTargetedSlides,
  renderWarningsToIssues,
  scoreFromIssues,
  SEVERITY,
  ISSUE_CODES,
  ACCEPT_SCORE,
  MAX_REPAIR_ITERATIONS,
};
