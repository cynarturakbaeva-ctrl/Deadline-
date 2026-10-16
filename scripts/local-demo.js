'use strict';
/**
 * Жергілікті демо — КІЛТСІЗ, БАЗАСЫЗ (тек Node).
 *   node scripts/local-demo.js [outDir]
 * Бір үлгі презентацияны 6 дизайн жүйесінің әрқайсысында HTML етіп шығарады және бір студенттің 5 рет қатарынан
 * жасатқанын (дизайн жады) көрсетеді. Нәтижені браузерде ашыңыз: <outDir>/index.html
 */
const fs = require('fs'); const path = require('path');
const { build3DPresentationHTML } = require('../products/presentation/html3DBuilder');
const { applyDeckTheme } = require('../products/presentation/deckPolish');
const SYS = require('../products/presentation/design/systems');
const M = require('../core/designMemory');

const out = path.resolve(process.argv[2] || 'local-demo');
fs.mkdirSync(out, { recursive: true });
const deck = () => [
  { title: 'Қазақ хандығының құрылуы және дамуы', subtitle: 'XV–XVII ғасырлардағы саяси тарих', bullets: ['Орындаған: Айгерім С.', 'Тексерген: Т. Әбдіқадыров', 'Топ: ТК-21'], composition: { visualPurpose: 'cover' } },
  { title: 'Кіріспе', subtitle: 'Қазақ хандығы — Орталық Азия даласындағы ең ықпалды мемлекеттердің бірі.', bullets: ['Жүздер жүйесі аумақтық басқаруды тұрақтандырды.', 'Билер кеңесі дауларды әділ шешетін жоғары орган болды.', 'Көшпелі мал шаруашылығы экономиканың негізін құрады.', 'Жібек жолы бойындағы қалалар сауда орталығы болды.'] },
  { title: 'Негізгі кезеңдер', bullets: ['1456 — Керей мен Жәнібек Моғолстан шекарасына көшті', '1465 — Қазақ хандығының іргесі қаланды', '1511 — Қасым хан билік құрды', '1538 — Хақназар хан тұсында нығаю'], composition: { visualPurpose: 'timeline' } },
  { title: 'Мемлекеттік басқару кезеңдері', bullets: ['Жинақтау — руларды бір ханның төңірегіне біріктіру', 'Нығаю — заң жинағын қабылдау', 'Кеңею — жаңа жерлерді қосып алу', 'Тұрақтандыру — ішкі тәртіпті орнату'], composition: { visualPurpose: 'process' } },
  { title: 'Хандық сандармен', subtitle: 'Тарихи деректер бойынша бағалау', stats: [{ value: '1,5 млн', label: 'халық саны XVI ғасырда' }, { value: '87%', label: 'көшпелі шаруашылықпен айналысқан' }, { value: '3', label: 'жүзге бөлінген аумақ' }] },
  { title: 'Басқару иерархиясы', bullets: ['Хан — жоғарғы билеуші және әскербасы', 'Сұлтандар — аймақтарды басқарушылар', 'Билер — заң және әдет-ғұрып сарапшылары', 'Батырлар — әскери басшылар'], composition: { visualPurpose: 'hierarchy' } },
  { title: 'Қорытынды', bullets: ['Хандық — қазақ мемлекеттілігінің негізі.', 'Жүздер жүйесі басқаруды тұрақтандырды.', 'Сауда мен мал шаруашылығы экономиканы қамтамасыз етті.'], composition: { visualPurpose: 'conclusion' } },
];
const links = [];
for (const id of Object.keys(SYS.SYSTEMS)) {
  const d = deck();
  const mood = SYS.SYSTEMS[id].moods[0];
  applyDeckTheme(d, { seed: 'demo', keep: { system: id, mood } });
  fs.writeFileSync(path.join(out, id + '.html'), build3DPresentationHTML(d, d[0].title, { style: 'academic' }));
  links.push(`<li><a href="${id}.html">${SYS.SYSTEMS[id].name}</a> — ${mood}</li>`);
}
// бір студент, 5 презентация: дизайн жады бойынша
let mem = null; const runs = [];
for (let i = 0; i < 5; i++) {
  const d = deck();
  const des = applyDeckTheme(d, { seed: 'student|' + i + '|' + Date.now(), avoid: M.avoidOptions(mem).designAvoid });
  mem = M.merge(mem, des);
  fs.writeFileSync(path.join(out, `student-run${i + 1}.html`), build3DPresentationHTML(d, d[0].title, { style: 'academic' }));
  runs.push(`<li><a href="student-run${i + 1}.html">${i + 1}-презентация</a> — ${SYS.SYSTEMS[des.system].name}, ${des.mood}</li>`);
}
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>DeadLine — жергілікті демо</title>
<body style="font:18px system-ui;max-width:760px;margin:40px auto;line-height:1.6"><h1>DeadLine — жергілікті демо</h1>
<p>Слайдтарды ← → пернелерімен ауыстырыңыз.</p><h2>6 дизайн жүйесі</h2><ul>${links.join('')}</ul>
<h2>Бір студент — 5 презентация қатарынан</h2><ul>${runs.join('')}</ul></body>`);
console.log('Дайын: ' + path.join(out, 'index.html'));
