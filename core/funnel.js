'use strict';
/**
 * Күнделікті воронка (екі база үшін ортақ): events жазбаларын арна бойынша жинау және /stats мәтіні.
 * Қадамдар: new (жаңа тіркелді) · start (/start басты) · app (Mini App ашты) · gen (жасатты) · free (тегін) · paid (төледі).
 */
const KINDS = ['new', 'start', 'app', 'gen', 'free', 'paid'];

/** rows: [{source, kind, n}] → { day, total, sources } (көп /start әкелген арна бірінші) */
function foldFunnel(day, rows) {
  const total = Object.fromEntries(KINDS.map((k) => [k, 0]));
  const by = {};
  (rows || []).forEach((r) => {
    if (!KINDS.includes(r.kind)) return;
    const b = by[r.source] || (by[r.source] = Object.assign({ source: r.source }, Object.fromEntries(KINDS.map((k) => [k, 0]))));
    b[r.kind] += r.n; total[r.kind] += r.n;
  });
  const sources = Object.values(by).sort((a, b) => (b.start + b.app) - (a.start + a.app) || b.gen - a.gen);
  return { day, total, sources };
}

const pct = (a, b) => (b ? ' (' + Math.round((a / b) * 100) + '%)' : '');
function line(x) {
  return `/start ${x.start} → Mini App ${x.app}${pct(x.app, x.start)} → жасатты ${x.gen}${x.free ? ` (тегін ${x.free})` : ''} → төледі ${x.paid}`;
}

/** /stats бөлімі: бүгін (арналарымен) + кеше бір жолмен */
function funnelText(today, yesterday) {
  const t = today.total;
  let out = `📈 Воронка, бүгін (${today.day}):\nжаңа адам ${t.new} · ${line(t)}`;
  const rows = today.sources.slice(0, 10).map((x) => `• ${x.source}: ${x.new ? 'жаңа ' + x.new + ' · ' : ''}${line(x)}`);
  if (rows.length) out += '\n' + rows.join('\n');
  if (yesterday) out += `\nКеше: жаңа ${yesterday.total.new} · ${line(yesterday.total)}`;
  return out;
}

module.exports = { KINDS, foldFunnel, funnelText };
