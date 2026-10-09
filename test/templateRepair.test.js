'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const T = require('../products/presentation/templateFill');
const { repairTemplateSlides } = require('../products/presentation/templateRepair');

// «Сарай халқы» скриншотындағы жағдай: шаблон 3 мәтін күтеді, LLM екі қысқа белгі жазған
const PLAN = [
  { split: true, title: { words: 2, wordMax: 9 }, items: [90, 120] },
  { split: false, title: { max: 40 }, items: [60, 100, 100] },
];
const bad = () => [
  { title: 'Қорытынды: Сарай мұрасы', subtitle: 'Сарай — билік орталығы және мәдениет айнасы', bullets: ['Тамақ, киім мен турнир мәртебені айқындады және әлеуметтік рөлді көрсетті'] },
  { title: 'Сарай халқы: король мен қызметшілер', subtitle: '', bullets: ['Билеушілер', 'Қатардағы қызметшілер'] },
];

test('audit: жіңішке белгілер мен сан сәйкессіздігі ұсталады', () => {
  const a = T.auditSlides(PLAN, bad());
  assert.strictEqual(a.length, 1, 'тек 2-слайд ақаулы');
  const codes = a[0].issues.map((i) => i.code);
  assert.ok(codes.includes('items_few'), codes.join());
  assert.ok(codes.includes('item_thin'), codes.join());
  assert.strictEqual(a[0].index, 2);
});

test('audit: логотип сөзі тым ұзын / сөз саны аз / «…»', () => {
  const plan = [PLAN[0], PLAN[0], PLAN[1]];
  const a = T.auditSlides(plan, [
    { title: 'Ортағасырлықтардың Англиясы', subtitle: 'Жеткілікті ұзын толық сипаттама мәтіні осында тұр', bullets: ['Екінші толық сипаттама мәтіні де осында тұр'] },
    { title: 'Қысқа', subtitle: 'Бірінші толық сипаттама мәтіні осында жазылған', bullets: ['Екінші толық сипаттама мәтіні осында жазылған'] },
    { title: 'Қалыпты тақырып', subtitle: 'Бірінші толық мәтін осында жазылған', bullets: ['Екінші мәтін…', 'Үшінші толық мәтін осында жазылған'] },
  ]);
  const codes = (n) => a.find((x) => x.index === n).issues.map((i) => i.code);
  assert.ok(codes(1).includes('logo_word_long'), codes(1).join());
  assert.ok(codes(2).includes('logo_words'), codes(2).join());
  assert.ok(codes(3).includes('ellipsis'), codes(3).join());
});

test('repair: LLM ақау бойынша түзетеді, цикл тоқтайды, ақаусыз слайд өзгермейді', async () => {
  let calls = 0;
  const llm = async (sys, user) => {
    calls++;
    assert.match(user, /PROBLEMS TO FIX/);
    assert.match(user, /Slide 2/);
    assert.ok(!/Slide 1\b/.test(user), 'ақаусыз слайд LLM-ге жіберілмейді');
    return { slides: [{ index: 2, title: 'Сарай халқы', items: ['Билеушілер: король, бароналар және жоғары дворяндар', 'Қатардағы қызметшілер: аспазшылар, күзетшілер және қызметші әйелдер сарай тұрмысын қамтамасыз еткен', 'Қызметшілердің мәртебесі туған тегіне және король алдындағы адалдығына байланысты болған'] }] };
  };
  const input = bad();
  const r = await repairTemplateSlides({ plan: PLAN, slides: input, llm, topic: 'Сарай', language: 'kk' });
  assert.strictEqual(calls, 1);
  assert.strictEqual(r.after, 0, JSON.stringify(r.remaining));
  assert.deepStrictEqual(r.fixedSlides, [2]);
  assert.deepStrictEqual(r.slides[0], input[0], '1-слайд өзгермеді');
  assert.strictEqual(r.slides[1].bullets.length, 2);
  assert.ok(!/…/.test(JSON.stringify(r.slides)));
  assert.notStrictEqual(r.slides, input, 'кіріс массив мутацияланбайды');
  assert.strictEqual(input[1].bullets[0], 'Билеушілер');
});

test('repair: LLM нашар жауап берсе — нашарлау нұсқа қабылданбайды, ең көбі 3 айналым', async () => {
  let calls = 0;
  const llm = async () => { calls++; return { slides: [{ index: 2, title: 'Т', items: ['а'] }] }; };   // әлі де ақаулы
  const r = await repairTemplateSlides({ plan: PLAN, slides: bad(), llm, maxRounds: 3 });
  assert.ok(calls <= 3);
  assert.ok(r.after <= r.before, 'ақау көбеймеуі керек');
});

test('repair: LLM құласа лақтырмайды, түпнұсқа қайтады', async () => {
  const llm = async () => { throw new Error('network'); };
  const input = bad();
  const r = await repairTemplateSlides({ plan: PLAN, slides: input, llm });
  assert.deepStrictEqual(r.slides, input);
  assert.strictEqual(r.rounds, 1);
});

test('slotRuleLine: LLM-ге «жіңішке белгі жазба» деп минимумды айтады', () => {
  const line = T.slotRuleLine({ split: false, title: { max: 40 }, items: [60, 100, 100] }, 2);
  assert.match(line, /at least \[/);
  assert.match(line, /never a bare one-word label/);
});

test('логотип сөзі wrap="none" болады (екінші қатарға түспейді)', () => {
  const xml = fs.readFileSync(path.join(__dirname, 'fixtures', 'logotype-slide.xml'), 'utf8');
  const out = T.fillSlide(xml, { title: 'Қорытынды: Сарай', bullets: ['а', 'б'] }, { W: 18288000, H: 10287000, badFonts: new Set() });
  for (const b of [...out.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0])) {
    const t = [...b.matchAll(/<a:t>([^<]*)/g)].map((m) => m[1]).join('');
    if (t === 'ОРЫТЫНДЫ' || t === 'АРАЙ') assert.match(b, /<a:bodyPr[^>]* wrap="none"/, t);
  }
});

test('РЕГРЕССИЯ: index.js толтырудан бұрын template layout check жүргізеді', () => {
  const idx = fs.readFileSync(path.join(__dirname, '../products/presentation/index.js'), 'utf8');
  assert.match(idx, /repairTemplateSlides\(\{ templateBuf: referencePptxBuf/);
  assert.ok(idx.indexOf('repairTemplateSlides({') < idx.indexOf('fillTemplatePptx(referencePptxBuf'), 'repair толтырудан бұрын болуы керек');
});
