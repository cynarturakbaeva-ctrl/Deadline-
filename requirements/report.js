'use strict';
const L = {
  kk: { title: 'Мұғалім талаптары', pass: 'орындалды', fail: 'орындалмады', unv: 'тексерілмейді', soft: 'бағасы', none: 'Талап берілмеген', of: 'ішінен' },
  ru: { title: 'Требования преподавателя', pass: 'выполнено', fail: 'не выполнено', unv: 'не проверяется', soft: 'оценка', none: 'Требования не указаны', of: 'из' },
  en: { title: 'Teacher requirements', pass: 'met', fail: 'not met', unv: 'not verifiable', soft: 'score', none: 'No requirements given', of: 'of' },
};
const lang = (l) => (/ru|рус|орыс/i.test(l) ? 'ru' : /en|анг|ағыл/i.test(l) ? 'en' : 'kk');

function summarize(results) {
  const hard = results.filter((r) => r.item.kind === 'hard');
  const passed = hard.filter((r) => r.status === 'pass').length;
  return {
    hardTotal: hard.length, hardPassed: passed,
    failed: results.filter((r) => r.status === 'fail').length,
    unverifiable: results.filter((r) => r.status === 'unverifiable').length,
    soft: results.filter((r) => r.status === 'soft').length,
  };
}

/** JSON есеп (файлға жазылады) */
function buildReport(set, results, extra = {}) {
  return {
    v: 1, generatedAt: Date.now(), summary: summarize(results), overrides: extra.overrides || [],
    results: results.map((r) => ({
      id: r.id, kind: r.item.kind, check: r.item.check, op: r.item.op, value: r.item.value, quote: r.item.quote,
      status: r.status, actual: r.actual, message: r.message || '', score: r.score == null ? null : r.score, note: r.note || '',
    })),
  };
}

/** Telegram/Mini App үшін қысқа мәтін */
function formatReport(report, language) {
  const t = L[lang(language)];
  if (!report || !report.results.length) return '';
  const s = report.summary;
  const lines = [`📋 ${t.title}: ${s.hardTotal ? `${s.hardPassed}/${s.hardTotal} ${t.pass}` : ''}`.trim()];
  for (const r of report.results) {
    const q = `«${r.quote.length > 60 ? r.quote.slice(0, 57) + '…' : r.quote}»`;
    if (r.status === 'pass') lines.push(`✅ ${q}`);
    else if (r.status === 'fail') lines.push(`❌ ${q}${r.message ? ' — ' + r.message : ''}`);
    else if (r.status === 'soft') lines.push(`🔸 ${q} — ${r.score == null ? t.unv : t.soft + ' ' + Math.round(r.score * 100) + '%'}${r.note ? ' (' + r.note + ')' : ''}`);
    else lines.push(`➖ ${q} — ${t.unv}${r.message ? ': ' + r.message : ''}`);
  }
  for (const o of report.overrides || []) lines.push(`ℹ️ ${o}`);
  return lines.join('\n');
}

module.exports = { buildReport, formatReport, summarize };
