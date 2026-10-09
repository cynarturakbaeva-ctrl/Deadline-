'use strict';
/**
 * RequirementSet схемасы (v1).
 * kind: 'hard' — машина тексереді; 'soft' — AI бағалайды (✓ емес, балл); 'unverifiable' — өлшенбейді.
 * Әр элементте quote бар: мәтіндегі нақты үзінді. Мәтіннен табылмаған quote-ты лақтырып тастаймыз (ойдан талап қоспаймыз).
 */
const ROLES = ['title', 'agenda', 'intro', 'relevance', 'goal', 'tasks', 'conclusion', 'references', 'thanks'];
const NUMERIC_CHECKS = { slide_count: { min: 1, max: 60 }, max_words_per_slide: { min: 5, max: 300 }, sources_min: { min: 1, max: 100 } };
const OPS = ['==', '>=', '<='];

const norm = (s) => String(s || '').toLowerCase().replace(/[«»"“”„'’`]/g, '').replace(/\s+/g, ' ').trim();

function quoteInText(quote, text) {
  const q = norm(quote);
  return q.length >= 3 && norm(text).includes(q);
}

/** Шикі элементті тексереді. Жарамсыз болса null қайтарады. */
function normalizeItem(raw, sourceText) {
  if (!raw || typeof raw !== 'object') return null;
  const quote = String(raw.quote || '').trim().slice(0, 200);
  if (!quoteInText(quote, sourceText)) return null;
  const base = { quote };
  const check = String(raw.check || '').trim();
  const kind = String(raw.kind || '').trim();

  if (kind === 'unverifiable') {
    return { ...base, kind: 'unverifiable', check: 'unverifiable', reason: String(raw.reason || 'өлшенбейді').slice(0, 160) };
  }
  if (kind === 'soft' || check === 'judge') {
    const rubric = String(raw.rubric || quote).slice(0, 240);
    return { ...base, kind: 'soft', check: 'judge', rubric };
  }
  if (NUMERIC_CHECKS[check]) {
    const v = Number(raw.value);
    const lim = NUMERIC_CHECKS[check];
    if (!Number.isFinite(v) || v < lim.min || v > lim.max) return null;
    let op = OPS.includes(raw.op) ? raw.op : (check === 'slide_count' ? '==' : (check === 'sources_min' ? '>=' : '<='));
    if (check === 'sources_min') op = '>=';
    if (check === 'max_words_per_slide') op = '<=';
    return { ...base, kind: 'hard', check, op, value: Math.round(v) };
  }
  if (check === 'has_slide') {
    const role = String(raw.value || '').trim();
    if (!ROLES.includes(role)) return null;
    return { ...base, kind: 'hard', check, value: role };
  }
  return null;
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = [it.kind, it.check, it.op || '', it.value == null ? '' : it.value, it.check === 'judge' || it.check === 'unverifiable' ? norm(it.quote) : ''].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

function buildSet(items) {
  const list = dedupe(items).map((it, i) => ({ id: 'r' + (i + 1), ...it }));
  return { v: 1, items: list };
}

module.exports = { ROLES, OPS, NUMERIC_CHECKS, normalizeItem, buildSet, dedupe, quoteInText, norm };
