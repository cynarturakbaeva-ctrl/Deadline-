'use strict';
/** Soft талаптарды DeepSeek бағалайды (тек мәтін). Нәтиже балл (0–1), ешқашан «✓» емес. */
const { deepseekJson } = require('../core/llm');
const { textOf } = require('./checkers');

async function judgeSoft(softItems, slides, opts = {}) {
  const llm = opts.llm || ((s, u, l) => deepseekJson(s, u, l, 1200));
  if (!softItems.length) return {};
  const deck = slides.slice(0, 30).map((s, i) => `${i + 1}. ${textOf(s).slice(0, 260)}`).join('\n');
  const system = 'You grade a presentation against teacher criteria. Respond with JSON only: {"scores":[{"id":"r1","score":0.0-1.0,"note":"<=12 words, in the presentation language"}]}. Be strict. Judge only from the slide text given.';
  const user = `CRITERIA:\n${softItems.map((it) => `${it.id}: ${it.rubric}`).join('\n')}\n\nSLIDES:\n${deck}`;
  const out = await llm(system, user, 'req:judge');
  const map = {};
  for (const r of (out && out.scores) || []) {
    const sc = Number(r.score);
    if (r && r.id && Number.isFinite(sc)) map[r.id] = { score: Math.max(0, Math.min(1, sc)), note: String(r.note || '').slice(0, 120) };
  }
  return map;
}

module.exports = { judgeSoft };
