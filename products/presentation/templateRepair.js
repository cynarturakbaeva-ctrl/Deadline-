'use strict';
/**
 * Template → Content: «аудит → LLM түзету → қайта аудит» циклі.
 *
 * Неге керек: қалыпты ревю (reviewAndImproveSlides / quality loop) мазмұнды ғана қарайды, шаблон
 * қораптарының лимитін білмейді. Сондықтан «Билеушілер» сияқты үш мәтін орнына екі қысқа белгі
 * немесе қорапқа сыймайтын сөз өтіп кететін. Мұнда толтырудан БҰРЫН әр слайд шаблон лимитімен
 * салыстырылады (templateFill.auditSlides), ақаулы слайдтар LLM-ге нақты ақау тізімімен қайтарылады,
 * ақау жойылғанша (ең көбі maxRounds) қайталанады. Ең жақсы нұсқа сақталады; LLM құлап қалса
 * түпнұсқа слайдтар қайтады (толтырушының детерминді қорғанысы бәрібір жұмыс істейді).
 */

const { planTemplateSlots, slotRuleLine, auditSlides, linesForSlide } = require('./templateFill');

const clone = (x) => JSON.parse(JSON.stringify(x));
const countIssues = (audit) => audit.reduce((n, a) => n + a.issues.length, 0);
const byIndex = (audit) => Object.fromEntries(audit.map((a) => [a.index, a.issues.length]));
const clean = (t) => String(t == null ? '' : t).replace(/\s*(…|\.{3})\s*$/, '').replace(/\s+/g, ' ').trim();

function buildPrompt({ topic, language, targets, plan }) {
  const blocks = targets.map((t) => {
    const slide = t.slide;
    const { title, body } = linesForSlide(slide);
    return [
      `Slide ${t.index}`,
      `CURRENT title: ${JSON.stringify(title)}`,
      `CURRENT items: ${JSON.stringify(body)}`,
      `TEMPLATE LIMITS: ${slotRuleLine(plan[t.index - 1], t.index)}`,
      `PROBLEMS TO FIX:\n${t.issues.map((i) => `  - ${i.message}`).join('\n')}`,
    ].join('\n');
  }).join('\n\n');
  return `Presentation topic: ${topic || ''}
Output language: ${language || 'same as the current text'} (keep it; do not switch languages).

The text below was poured into a client's PPTX template with FIXED text boxes and failed the layout check.
Rewrite ONLY the title and the items of each listed slide so that every problem is solved:
- obey the exact number of items and the character limits (count characters including spaces);
- every item must be a complete, informative phrase or sentence — never cut off, never ending with "…"; a "label" slot holds one precise key term or figure (not a vague word), longer slots never a bare one-word label;
- keep the content professional and specific to the topic: no empty filler, no invented people, names or numbers;
- keep the meaning and facts of the slide; do not invent a different topic;
- a title that must "start with N short words" needs N real, separate words, each within the stated letter limit.

${blocks}

Return JSON only: {"slides":[{"index":<number>,"title":"…","items":["…","…"]}]}`;
}

/** LLM жауабын слайдқа қолдану: items[0] → subtitle, қалғаны → bullets (templateFill.linesForSlide осы ретпен оқиды). */
function applyFix(slide, fix) {
  const next = clone(slide);
  const title = clean(fix.title);
  if (title) next.title = title;
  const items = (Array.isArray(fix.items) ? fix.items : []).map(clean).filter(Boolean);
  if (items.length) {
    next.subtitle = items[0];
    next.bullets = items.slice(1);
    next.body = '';
    next.stats = [];
  }
  return next;
}

/**
 * @param {object}   o
 * @param {Buffer}   o.templateBuf  пайдаланушы шаблоны (.pptx)
 * @param {Array}    o.slides       жаңа мазмұн
 * @param {string}   [o.topic], [o.language]
 * @param {number}   [o.maxRounds=3]
 * @param {Function} [o.llm]        (system, user, label, maxTokens, opts) → JSON  (әдепкі: core/llm.deepseekJson)
 * @param {Array}    [o.plan]       дайын planTemplateSlots нәтижесі (тест үшін)
 * @returns {Promise<{slides:Array, rounds:number, fixedSlides:number[], remaining:Array, before:number, after:number}>}
 */
async function repairTemplateSlides(o) {
  const { templateBuf, topic, language, maxRounds = 3 } = o;
  const llm = o.llm || require('../../core/llm').deepseekJson;
  const plan = o.plan || planTemplateSlots(templateBuf);
  let best = clone(o.slides);
  let bestAudit = auditSlides(plan, best);
  const before = countIssues(bestAudit);
  const fixed = new Set();
  let rounds = 0;

  while (bestAudit.length && rounds < maxRounds) {
    rounds++;
    const targets = bestAudit.map((a) => ({ index: a.index, issues: a.issues, slide: best[a.index - 1] }));
    let reply;
    try {
      reply = await llm(
        'You repair slide text so it fits the fixed text boxes of a PPTX template. Respond with valid JSON only.',
        buildPrompt({ topic, language, targets, plan }),
        'template-repair',
        2500,
        { temperature: 0.3, timeoutMs: 60_000 },
      );
    } catch (e) {
      console.warn(`[TemplateRepair] LLM failed (round ${rounds}): ${e.message}`);
      break;
    }
    const fixes = Array.isArray(reply && reply.slides) ? reply.slides : [];
    if (!fixes.length) break;

    const candidate = clone(best);
    for (const f of fixes) {
      const i = Number(f && f.index) - 1;
      if (Number.isInteger(i) && candidate[i] && bestAudit.some((a) => a.index === i + 1)) candidate[i] = applyFix(best[i], f);
    }
    const candAudit = auditSlides(plan, candidate);
    const was = byIndex(bestAudit), now = byIndex(candAudit);
    // слайд-слайдпен: тек ақауы азайған (немесе жойылған) слайдты қабылдаймыз — нашарлағаны қабылданбайды
    const merged = clone(best);
    for (const a of bestAudit) {
      const i = a.index - 1;
      if ((now[a.index] || 0) < was[a.index]) { merged[i] = candidate[i]; if (!(now[a.index])) fixed.add(a.index); }
    }
    best = merged;
    bestAudit = auditSlides(plan, best);
    console.log(`[TemplateRepair] round ${rounds}: issues ${before} → ${countIssues(bestAudit)}`);
  }
  return { slides: best, rounds, fixedSlides: [...fixed].sort((a, b) => a - b), remaining: bestAudit, before, after: countIssues(bestAudit) };
}

module.exports = { repairTemplateSlides, buildPrompt, applyFix };
