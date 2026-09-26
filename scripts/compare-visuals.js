#!/usr/bin/env node
'use strict';

/**
 * DeepSeek пен Claude-ты бірдей SVG тапсырмаларында САЛЫСТЫРУ.
 * Нәтиже: бір HTML файл (compare-visuals.html) — телефоннан ашып, көзбен қарайсың.
 *
 *   node scripts/compare-visuals.js                       # кілті бар барлық провайдер
 *   node scripts/compare-visuals.js deepseek              # тек DeepSeek
 *   node scripts/compare-visuals.js deepseek anthropic    # екеуін қатар
 *   node scripts/compare-visuals.js --mock                # кілтсіз, тек беттің көрінісін көру үшін
 *
 * Кілттер: DEEPSEEK_API_KEY, ANTHROPIC_API_KEY (.env немесе орта айнымалысы).
 * Бағасы шамамен ~1-5 тг / SVG (DeepSeek) және ~10-25 тг / SVG (Sonnet) — барлығы 6 тапсырма.
 */

const fs = require('fs');
const path = require('path');
try { require('dotenv').config(); } catch { /* dotenv міндетті емес */ }

const V = require('../pipeline/visual');

const TASKS = [
  { name: 'Диаграмма: су айналымы (5 қадам)', slide: { title: 'Табиғаттағы су айналымы', visual: { type: 'diagram', brief: 'Cycle of five steps with arrows, last step returns to the first', data: ['Булану', 'Конденсация', 'Бұлт түзілуі', 'Жауын-шашын', 'Ағын және жиналу'] } } },
  { name: 'Диаграмма: билік тармақтары (иерархия)', slide: { title: 'Мемлекеттік билік', visual: { type: 'diagram', brief: 'Hierarchy: one top box (Конституция) and three branches below', data: ['Конституция', 'Заң шығарушы билік — Парламент', 'Атқарушы билік — Үкімет', 'Сот билігі — Соттар'] } } },
  { name: 'Инфографика: бағаналы диаграмма (сандар берілген)', slide: { title: 'Оқылған кітаптар', visual: { type: 'infographic', brief: 'Bar chart with 4 bars proportional to the values; highlight the biggest', data: ['2019 жыл: 12 кітап', '2020 жыл: 18 кітап', '2021 жыл: 25 кітап', '2022 жыл: 31 кітап'] } } },
  { name: 'Инфографика: негізгі фактілер', slide: { title: 'Қазақстан бір көзқараспен', visual: { type: 'infographic', brief: 'One big number and three supporting facts', data: ['Ауданы: 2,7 млн км²', 'Тәуелсіздік: 1991 жыл', 'Астана — елорда', 'Мемлекеттік тіл: қазақ тілі'] } } },
  { name: 'Карта: Жібек жолы (схема)', slide: { title: 'Ұлы Жібек жолы', visual: { type: 'map', brief: 'Schematic route from east to west through five cities', data: ['Шыңжаң', 'Алматы', 'Тараз', 'Түркістан', 'Самарқанд'] } } },
  { name: 'Мәтін сыятынын тексеру (ұзын қазақша белгілер)', slide: { title: 'Жасанды интеллект', visual: { type: 'diagram', brief: 'Three boxes with long labels connected by arrows', data: ['Жасанды интеллектінің әлеуметтік-экономикалық салдары', 'Деректерді қорғау және құпиялылық мәселелері', 'Білім беру жүйесін цифрлық трансформациялау'] } } },
].map((t) => ({ ...t, slide: { ...t.slide, composition: { mood: 'dark', accentColor: '#d4a843' } } }));

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function mockFetchFactory() {
  const fx = (n) => fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', n), 'utf8');
  const files = ['sample_diagram.svg', 'sample_infographic.svg', 'sample_map.svg'];
  let i = 0;
  return async (url) => {
    const svg = fx(files[i++ % files.length]);
    const ok = { ok: true, status: 200, headers: { get: () => null } };
    if (url.includes('deepseek')) return { ...ok, json: async () => ({ choices: [{ message: { content: svg }, finish_reason: 'stop' }], usage: { prompt_tokens: 1400, completion_tokens: 1700 } }) };
    return { ...ok, json: async () => ({ content: [{ type: 'text', text: svg }], stop_reason: 'end_turn', usage: { input_tokens: 1500, output_tokens: 2100 } }) };
  };
}

async function main() {
  const args = process.argv.slice(2);
  const mock = args.includes('--mock');
  let providers = args.filter((a) => !a.startsWith('--'));
  const env = mock ? { ...process.env, DEEPSEEK_API_KEY: 'mock', ANTHROPIC_API_KEY: 'mock' } : process.env;
  if (!providers.length) providers = ['deepseek', 'anthropic'].filter((p) => (p === 'deepseek' ? env.DEEPSEEK_API_KEY : env.ANTHROPIC_API_KEY));
  if (!providers.length) { console.error('API кілті жоқ: DEEPSEEK_API_KEY және/немесе ANTHROPIC_API_KEY қойыңыз (немесе --mock).'); process.exit(1); }
  const fetchImpl = mock ? mockFetchFactory() : undefined;

  console.log(`Провайдерлер: ${providers.join(', ')}${mock ? ' (MOCK)' : ''}; тапсырма: ${TASKS.length}`);
  const rows = [];
  const totals = Object.fromEntries(providers.map((p) => [p, { ok: 0, n: 0, cost: 0, ms: 0 }]));
  for (const t of TASKS) {
    // провайдерлер қатар жұмыс істейді (бір тапсырма ішінде)
    const results = await Promise.all(providers.map((p) => V.drawOnce(t.slide, p, { env, fetchImpl })));
    results.forEach((r, k) => {
      const T = totals[providers[k]];
      T.n++; T.ok += r.ok ? 1 : 0; T.cost += r.costTg; T.ms += r.ms;
      console.log(`  ${t.name.slice(0, 44).padEnd(44)} ${providers[k].padEnd(9)} ${r.ok ? '✅' : '❌ ' + r.reason}  ~${r.costTg.toFixed(1)} тг  ${(r.ms / 1000).toFixed(1)}с${r.warnings && r.warnings.length ? '  ⚠ ' + r.warnings.join('; ') : ''}`);
    });
    rows.push({ task: t, results });
  }

  const cards = rows.map(({ task, results }) => `
  <section><h2>${esc(task.name)}</h2>
   <p class="brief">${esc(task.slide.visual.brief)} · ${task.slide.visual.data.map(esc).join(' | ')}</p>
   <div class="grid">${results.map((r, k) => `
     <figure>
       <figcaption><b>${esc(providers[k])}</b> ${r.ok ? '<span class="ok">✅ жарамды</span>' : '<span class="bad">❌ ' + esc(r.reason) + '</span>'}
         <small>${r.inTok}→${r.outTok} tok · ~${r.costTg.toFixed(1)} тг · ${(r.ms / 1000).toFixed(1)}с</small>
         ${r.warnings && r.warnings.length ? '<small class="warn">⚠ ' + r.warnings.map(esc).join('; ') + '</small>' : ''}</figcaption>
       ${r.ok ? `<div class="panel"><img alt="" src="${r.dataUri}"></div>` : '<div class="panel empty">сурет жоқ</div>'}
     </figure>`).join('')}
   </div></section>`).join('\n');

  const summary = providers.map((p) => `<li><b>${esc(p)}</b>: ${totals[p].ok}/${totals[p].n} жарамды · орташа ~${(totals[p].cost / totals[p].n).toFixed(1)} тг/SVG · ${(totals[p].ms / totals[p].n / 1000).toFixed(1)}с</li>`).join('');
  const html = `<!DOCTYPE html><html lang="kk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SVG салыстыру</title><style>
body{margin:0;background:#0b0d12;color:#e8ecf4;font:16px/1.4 system-ui,Segoe UI,Noto Sans,sans-serif;padding:16px}
h1{font-size:22px;margin:0 0 6px}h2{font-size:18px;margin:28px 0 4px}.brief{margin:0 0 10px;color:#9aa1b1;font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
figure{margin:0}figcaption{margin-bottom:6px}figcaption small{display:block;color:#9aa1b1}
.ok{color:#6fd08c}.bad{color:#ff8a80}.warn{color:#e6c35c}
.panel{background:#131519;border:1px solid #2a2d33;border-radius:12px;overflow:hidden;aspect-ratio:1100/740}
.panel img{display:block;width:100%;height:100%;object-fit:contain}.empty{display:grid;place-items:center;color:#666}
ul{padding-left:20px}</style></head><body>
<h1>SVG салыстыру${mock ? ' (MOCK — нақты модель емес!)' : ''}</h1>
<ul>${summary}</ul>
<p class="brief">Бағалау: 1) мәтін қораптан асып/кесіліп кетпеген бе; 2) стрелкалар мен қораптар қабаттаспай тұр ма; 3) сандар берілгенмен дәл сәйкес пе (ойдан сан жоқ па); 4) карта «схема» ретінде адал көрінеді ме.</p>
${cards}
</body></html>`;
  const out = path.join(process.cwd(), 'compare-visuals.html');
  fs.writeFileSync(out, html, 'utf8');
  console.log(`\nЖасалды: ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
