'use strict';
/**
 * Requirements модулі: промт (адам жазған мәтін) → RequirementSet → тексеру → есеп.
 * Бәрі қауіпсіз: LLM құласа да детерминді бөлік жұмыс істейді; ешқашан лақтырмайды (parse/judge).
 */
const { baselineItems } = require('./baseline');
const { normalizeItem, buildSet, ROLES } = require('./schema');
const { checkAll } = require('./checkers');
const { judgeSoft } = require('./judge');
const { buildReport, formatReport } = require('./report');
const { deepseekJson } = require('../core/llm');

const SYSTEM = `You extract requirements that a teacher or client wrote for a presentation. Respond with JSON only.
Output: {"items":[{"kind":"hard|soft|unverifiable","check":"...","op":"==|>=|<=","value":...,"rubric":"...","reason":"...","quote":"..."}]}
Allowed hard checks:
- slide_count (value: number, op: ==, >= or <=)
- max_words_per_slide (value: number)
- sources_min (value: number)
- has_slide (value: one of ${ROLES.join(', ')})
kind "soft": a subjective but judgeable criterion (check:"judge", rubric: short English criterion).
kind "unverifiable": cannot be measured from slide text (fonts, colors, delivery, behaviour) (reason: short, in the text's language).
RULES: "quote" MUST be an exact, verbatim copy of a fragment of the input text. Never invent a requirement that is not written. One item per requirement. If the text contains no requirements return {"items":[]}.`;

async function parseRequirements(text, opts = {}) {
  const maxChars = Math.max(500, Math.min(40000, opts.maxChars || 3000));
  const src = String(text || '').trim().slice(0, maxChars);
  if (!src) return { set: buildSet([]), llm: 'skipped' };
  const items = baselineItems(src);
  let llmState = 'off';
  if (opts.llm !== false) {
    const llm = opts.llm || ((s, u, l) => deepseekJson(s, u, l, 1800));
    try {
      const out = await llm(SYSTEM, src, 'req:parse');
      for (const raw of (out && out.items) || []) {
        const it = normalizeItem(raw, src);
        if (it) items.push(it);
      }
      llmState = 'ok';
    } catch (e) {
      console.warn('[Requirements] LLM parse failed, using baseline only:', e.message);
      llmState = 'failed';
    }
  }
  return { set: buildSet(items), llm: llmState };
}

/** Генераторға берілетін қысқа нұсқау (LLM brief-ке қосылады) */
function briefFromRequirements(set) {
  const lines = [];
  for (const it of set.items) {
    if (it.kind === 'hard') {
      if (it.check === 'slide_count') lines.push(`Slide count: ${it.op === '==' ? 'exactly' : it.op === '>=' ? 'at least' : 'at most'} ${it.value}.`);
      else if (it.check === 'max_words_per_slide') lines.push(`At most ${it.value} words on any slide.`);
      else if (it.check === 'sources_min') lines.push(`The references slide must list at least ${it.value} sources.`);
      else if (it.check === 'has_slide') lines.push(`The deck must include a "${it.value}" slide.`);
    } else if (it.kind === 'soft') lines.push(`Also: ${it.rubric}`);
  }
  return lines.length ? '\n\nTeacher requirements (must follow):\n- ' + lines.join('\n- ') : '';
}

/** slideCount-ты талапқа сәйкестендіреді. Қайтарады: { count, note|null } */
function effectiveSlideCount(set, requested) {
  const items = set.items.filter((i) => i.kind === 'hard' && i.check === 'slide_count');
  let count = requested || null; let note = null;
  for (const it of items) {
    if (it.op === '==') { if (count !== it.value) note = `Слайд саны талап бойынша ${it.value} (формада ${requested || 'көрсетілмеген'} еді)`; count = it.value; }
    else if (it.op === '>=' && (!count || count < it.value)) { count = it.value; note = `Слайд саны талап бойынша ${it.value}-ге көтерілді`; }
    else if (it.op === '<=' && count && count > it.value) { count = it.value; note = `Слайд саны талап бойынша ${it.value}-ге дейін қысқартылды`; }
  }
  return { count, note };
}

async function auditSlides(set, slides, opts = {}) {
  const results = checkAll(set, slides, opts.checkers);
  const softs = results.filter((r) => r.status === 'soft');
  if (softs.length && opts.judge !== false) {
    try {
      const map = await judgeSoft(softs.map((r) => r.item), slides, { llm: opts.judgeLlm });
      for (const r of softs) { const m = map[r.id]; if (m) { r.score = m.score; r.note = m.note; } }
    } catch (e) { console.warn('[Requirements] judge failed:', e.message); }
  }
  return buildReport(set, results, { overrides: opts.overrides });
}

// ─── Талаптар бойынша автоматты түзету (QA loop) ────────────────────────────
// Мақсат: «7/9 орындалды» болса — орындалмаған талаптарды көрсетіп, мүмкін болса
// түзетіп қайта тексеру. Бәрі қауіпсіз: ешқашан лақтырмайды, шектеулі (2 айналым).

const ROLE_TITLES = {
  kk: { intro: 'Кіріспе', relevance: 'Өзектілік', goal: 'Мақсат және міндеттер', tasks: 'Міндеттер', agenda: 'Мазмұны', conclusion: 'Қорытынды', references: 'Пайдаланылған әдебиеттер', thanks: 'Назарларыңызға рахмет!' },
  ru: { intro: 'Введение', relevance: 'Актуальность', goal: 'Цель и задачи', tasks: 'Задачи', agenda: 'Содержание', conclusion: 'Заключение', references: 'Список литературы', thanks: 'Спасибо за внимание!' },
  en: { intro: 'Introduction', relevance: 'Relevance', goal: 'Goal and objectives', tasks: 'Tasks', agenda: 'Agenda', conclusion: 'Conclusion', references: 'References', thanks: 'Thank you!' },
};
const langKey = (l) => (/ru|рус|орыс/i.test(l) ? 'ru' : /en|анг|ағыл/i.test(l) ? 'en' : 'kk');
const roleTitles = (l) => ROLE_TITLES[langKey(l)];

/** Детерминді түзетулер: рөлдік слайд тақырыптары, сөз шегі, буллет саны. */
function deterministicRequirementFixes(set, slides, language) {
  const list = slides.map((s) => JSON.parse(JSON.stringify(s)));
  const fixed = [];
  const hasRole = (role) => require('./checkers').roleSlide(role, list) >= 0;
  const t = roleTitles(language);

  // has_slide: тақырыпты рөлге сәйкестендіру (бар слайдты қайта атау — жаңа слайд ойлап қоспаймыз)
  for (const it of set.items) {
    if (it.kind !== 'hard' || it.check !== 'has_slide') continue;
    const role = it.value;
    if (hasRole(role)) continue;
    if (role === 'title') continue;
    let idx = -1;
    if (role === 'references') idx = list.length - 1;
    else if (role === 'thanks') idx = list.length - 1;
    else if (role === 'intro') idx = 1;
    else if (role === 'agenda') idx = 1;
    else if (role === 'conclusion') idx = list.length - 1;
    else if (['goal', 'tasks', 'relevance'].includes(role)) idx = Math.min(2, list.length - 1);
    if (idx < 0 || idx >= list.length) continue;
    const s = list[idx];
    const old = String(s.title || '').trim();
    s.title = t[role] || old || s.title;
    if (old && old !== s.title && !String(s.subtitle || '').includes(old)) s.subtitle = s.subtitle ? old + ' — ' + s.subtitle : old;
    fixed.push({ id: it.id, what: `slide ${idx + 1} → ${t[role]}` });
  }

  // max_words_per_slide: ұзын мәтінді қысқарту (соңғы шара — детерминді, LLM-сіз)
  const wordCap = set.items.find((i) => i.kind === 'hard' && i.check === 'max_words_per_slide');
  if (wordCap) {
    const cap = wordCap.value;
    const { words, textOf } = require('./checkers');
    list.forEach((s, i) => {
      if (words(textOf(s)) <= cap) return;
      let changed = false;
      const setBody = () => {
        if (s.body) { s.body = String(s.body).split(/\s+/).slice(0, Math.max(4, Math.floor(cap / 2))).join(' '); changed = true; }
      };
      const trimBullets = () => {
        const titleW = words(s.title || '');
        const subW = words(s.subtitle || '');
        const bodyW = words(s.body || '');
        const budget = Math.max(1, cap - titleW - subW - bodyW);
        s.bullets = (Array.isArray(s.bullets) ? s.bullets : []).filter(Boolean).map((b) => {
          const w = words(b);
          if (w <= budget) return b;
          return String(b).split(/\s+/).slice(0, Math.max(2, budget)).join(' ');
        });
        while (words(textOf(s)) > cap && s.bullets.length > 1) s.bullets.pop();
      };
      trimBullets();
      if (words(textOf(s)) > cap) setBody();
      if (words(textOf(s)) > cap) trimBullets();
      if (words(textOf(s)) > cap && s.subtitle) { s.subtitle = ''; changed = true; }
      if (words(textOf(s)) > cap && s.title) {
        s.title = String(s.title).split(/\s+/).slice(0, Math.max(1, cap)).join(' ');
        changed = true;
      }
      if (changed || words(textOf(s)) <= cap) fixed.push({ id: wordCap.id, what: `slide ${i + 1} shortened to ≤${cap} words` });
    });
  }
  return { slides: list, fixed };
}

/** Орындалмаған hard талаптарды LLM арқылы түзету (бір шақыру). */
async function repairForRequirements(set, slides, failing, opts = {}) {
  const llm = opts.llm || ((s, u, l, m) => deepseekJson(s, u, l, m));
  const compact = slides.map((s, i) => ({
    index: s.index != null ? s.index : i + 1,
    title: s.title || null,
    subtitle: s.subtitle || null,
    body: s.body || null,
    bullets: Array.isArray(s.bullets) ? s.bullets : null,
    stats: Array.isArray(s.stats) ? s.stats : null,
    table: s.table || null,
    imageQuery: s.imageQuery || null,
    composition: s.composition || null,
  }));
  const system = `You repair a presentation so it satisfies teacher requirements. Respond with JSON only: {"slides":[full slide objects]}.
Rules:
- Fix ONLY the failing requirements listed. Keep everything else intact.
- Keep the original language and topic of the slides.
- Keep titles 4-8 words, bullets 2-4 items (each under 14 words). Do NOT invent fake statistics or fake sources unless the requirement explicitly asks for a references list, in which case list 2-4 well-known topic-relevant public sources.
- Slide count may change ONLY if a slide_count requirement demands it. New slides need a proper title, subtitle and 2-4 bullets; removed slides must be the weakest/duplicate ones.
- Preserve composition/imageQuery/visual of existing slides.`;
  const user = `Failing requirements:
${failing.map((f) => `- [${f.id}] ${f.check} ${f.op || ''} ${f.value != null ? f.value : ''} (quote: "${f.quote}"). Current: ${f.message || f.actual}`).join('\n')}

Slides JSON:
${JSON.stringify(compact)}

Return the full corrected slides array.`;
  try {
    const out = await llm(system, user, 'req:repair', 9000);
    const next = Array.isArray(out.slides) ? out.slides : null;
    if (!next || next.length < 2) return null;
    const clean = next.filter((s) => s && typeof s === 'object' && (s.title || (Array.isArray(s.bullets) && s.bullets.length))).map((s, i) => {
      const prev = slides.find((x) => (x.index != null ? x.index : null) === (s.index != null ? s.index : i + 1)) || slides[i];
      return {
        ...(prev || {}),
        ...s,
        index: i + 1,
        title: String(s.title || (prev && prev.title) || '').slice(0, 160),
        visual: s.visual !== undefined ? s.visual : (prev && prev.visual),
        visualSvg: (prev && prev.visualSvg) || undefined,
        webImageUrl: (prev && prev.webImageUrl) || '',
        imageQuery: s.imageQuery || (prev && prev.imageQuery) || '',
        composition: s.composition || (prev && prev.composition) || undefined,
      };
    });
    return clean.length >= 2 ? clean : null;
  } catch (e) {
    console.warn('[Requirements] LLM repair failed:', e.message);
    return null;
  }
}

/**
 * Талаптар бойынша QA циклі: тексер → түзет → қайта тексер (ең көбі 2 айналым).
 * @returns {{slides, report, rounds, repaired: string[], reportAfter: boolean}}
 */
async function runRequirementsQa(set, slides, opts = {}) {
  const { checkers, judgeLlm, language, judge } = opts || {};
  let list = slides.map((s) => JSON.parse(JSON.stringify(s)));
  const hardIds = new Set(set.items.filter((i) => i.kind === 'hard').map((i) => i.id));
  const hardOf = (res) => res.filter((r) => hardIds.has(r.item.id));

  let report = null;
  let rounds = 0;
  const repaired = [];
  const maxRounds = Math.max(1, Math.min(2, opts.maxRounds || 2));
  const audit = (sl) => auditSlides(set, sl, { checkers, judgeLlm, judge, overrides: opts.overrides });

  for (let round = 0; round <= maxRounds; round++) {
    const results = checkAll(set, list, checkers);
    const hard = hardOf(results);
    const fails = hard.filter((r) => r.status === 'fail');
    const unverifiable = hard.filter((r) => r.status === 'unverifiable');
    if (round === maxRounds || (!fails.length && !unverifiable.length)) {
      report = await audit(list);
      break;
    }
    rounds = round + 1;

    // 1) Детерминді түзету (тегін)
    const det = deterministicRequirementFixes(set, list, language);
    if (det.fixed.length) {
      list = det.slides;
      list.forEach((s, i) => { s.index = i + 1; });
      repaired.push(...det.fixed.map((f) => f.what));
      const after = checkAll(set, list, checkers);
      const afterFails = hardOf(after).filter((r) => r.status === 'fail');
      if (!afterFails.length) { report = await audit(list); break; }
    }

    // 2) LLM түзету (бір шақыру, сәтсіз болса үзіп қоямыз)
    if (opts.repairLlm !== false) {
      const llmFails = hardOf(checkAll(set, list, checkers)).filter((r) => r.status === 'fail');
      const fixedSlides = await repairForRequirements(set, list, llmFails, { llm: opts.llm });
      if (fixedSlides) {
        list = fixedSlides;
        list.forEach((s, i) => { s.index = i + 1; });
        repaired.push('LLM repair round ' + rounds);
      }
    }
  }

  if (!report) report = await audit(list);
  return { slides: list, report, rounds, repaired };
}

module.exports = {
  parseRequirements,
  briefFromRequirements,
  effectiveSlideCount,
  auditSlides,
  formatReport,
  runRequirementsQa,
  deterministicRequirementFixes,
};
