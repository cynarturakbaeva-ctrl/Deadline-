'use strict';
/** LLM-сіз детерминді талдау: анық сандық талаптар мен өлшенбейтін форматтау талаптары. LLM құласа да осы жұмыс істейді. */
const { normalizeItem } = require('./schema');

const MIN_MARK = /(кемінде|ең\s*аз|минимум|не\s*менее|минимальн\p{L}*|от|at\s*least|min(?:imum)?)\s*[:\-]?\s*$/iu;
const MAX_MARK = /(көп\s*емес|ең\s*көбі|максимум|не\s*более|не\s*боле[ея]|до|at\s*most|max(?:imum)?|≤)\s*[:\-]?\s*$/iu;

function opBefore(text, idx) {
  const head = text.slice(Math.max(0, idx - 24), idx);
  if (MIN_MARK.test(head)) return '>=';
  if (MAX_MARK.test(head)) return '<=';
  return '==';
}

function baselineItems(text) {
  const t = String(text || '');
  const items = [];

  // N слайд
  for (const m of t.matchAll(/(\d{1,2})\s*[-–]?\s*(слайд\p{L}*|slides?)/giu)) {
    const raw = { kind: 'hard', check: 'slide_count', op: opBefore(t, m.index), value: +m[1], quote: m[0] };
    const it = normalizeItem(raw, t); if (it) items.push(it);
  }
  // «слайд саны: N» / «N слайдтан»
  for (const m of t.matchAll(/(слайд\p{L}*\s*саны|количество\s*слайдов|number\s*of\s*slides)\s*[:\-–]?\s*(\d{1,2})/giu)) {
    const it = normalizeItem({ kind: 'hard', check: 'slide_count', op: '==', value: +m[2], quote: m[0] }, t); if (it) items.push(it);
  }
  // ең көбі N сөз / не более N слов
  for (const m of t.matchAll(/(\d{1,3})\s*(сөзден|сөз|слов\p{L}*|words?)/giu)) {
    if (opBefore(t, m.index) !== '<=' && !/(көп\s*емес|аспа\p{L}*|не\s*более|no\s*more)/iu.test(t.slice(m.index, m.index + m[0].length + 24))) continue;
    const it = normalizeItem({ kind: 'hard', check: 'max_words_per_slide', value: +m[1], quote: m[0] }, t); if (it) items.push(it);
  }
  // N дереккөз / источников
  for (const m of t.matchAll(/(\d{1,3})\s*(дереккөз\p{L}*|әдебиет\p{L}*|источник\p{L}*|литератур\p{L}*|sources?|references?)/giu)) {
    const it = normalizeItem({ kind: 'hard', check: 'sources_min', value: +m[1], quote: m[0] }, t); if (it) items.push(it);
  }
  // Форматтау: шрифт, кегль, интервал, өріс — PPTX сурет түрінде жасалатындықтан өлшенбейді
  for (const m of t.matchAll(/[^.\n;]*(шрифт|кегль|font|интервал|поля|жиек|times new roman|arial|calibri)[^.\n;]*/giu)) {
    const q = m[0].trim().slice(0, 160);
    const it = normalizeItem({ kind: 'unverifiable', quote: q, reason: 'шрифт пен форматтау өлшенбейді: слайд сурет түрінде жасалады' }, t); if (it) items.push(it);
  }
  return items;
}

module.exports = { baselineItems };
