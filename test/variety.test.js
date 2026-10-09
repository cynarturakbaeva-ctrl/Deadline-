'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../products/presentation/design/tokens');
const { limitTables, applyDeckTheme } = require('../products/presentation/deckPolish');
const { build3DPresentationHTML } = require('../products/presentation/html3DBuilder');
// axios орнатылмаған ортада (npm install жоқ) жалған axios — желі қолданылмайды
try { require.resolve('axios'); } catch (e) {
  const Module = require('module'); const orig = Module._load;
  Module._load = function (req, ...rest) { return req === 'axios' ? { get: async () => { throw new Error('no network in test'); } } : orig.call(this, req, ...rest); };
}
const { isLatinQuery, findImage } = require('../products/presentation/images');

test('theme varies between decks (not always dark/gold)', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(T.pickTheme({ seed: 'topic-' + i, style: '' }));
  assert.ok(seen.size >= 8, 'distinct themes: ' + [...seen].join(','));
  const light = [...seen].filter(T.isLightMood).length;
  assert.ok(light >= 3, 'light themes present');
});

test('explicit client wish about background wins', () => {
  for (let i = 0; i < 20; i++) {
    assert.ok(!T.isLightMood(T.pickTheme({ seed: 's' + i, brief: 'қара фон болсын' })));
    assert.ok(T.isLightMood(T.pickTheme({ seed: 's' + i, brief: 'светлая тема, пожалуйста' })));
  }
});

test('two decks in a row never get the same theme', () => {
  const a = applyDeckTheme([{}], { seed: 'same' });
  const b = applyDeckTheme([{}], { seed: 'same' });
  assert.notStrictEqual(a, b);
});

test('applyDeckTheme overrides the LLM mood/accent on every slide', () => {
  const slides = [{ composition: { mood: 'dark', accentColor: '#d4a843', decorative: ['corner_circle'] } }, {}];
  const mood = applyDeckTheme(slides, { seed: 'x1', style: 'academic' });
  for (const s of slides) {
    assert.strictEqual(s.composition.mood, mood);
    assert.strictEqual(s.composition.accentColor, T.MOODS[mood].accent);
  }
});

test('limitTables: <=1 table per 4 slides, never adjacent; extras become bullets', () => {
  const mk = (i) => ({ title: 'S' + i, table: { headers: ['A', 'B', 'C'], rows: [['x', 'y', 'z'], ['p', 'q', 'r']] }, composition: { layout: 'comparison_table' } });
  const slides = [{ title: 'cover' }, ...Array.from({ length: 7 }, (_, i) => mk(i))];
  const converted = limitTables(slides);
  const kept = slides.filter((s) => s.table).length;
  assert.strictEqual(kept, 2);
  assert.strictEqual(converted, 5);
  slides.forEach((s, i) => { if (s.table && slides[i + 1]) assert.ok(!slides[i + 1].table, 'adjacent tables'); });
  const conv = slides.find((s) => !s.table && s.title === 'S1');
  assert.ok(conv.bullets.length === 2 && /B: y/.test(conv.bullets[0]), conv.bullets.join('|'));
});

test('decoration is rendered on plain slides, not on photo slides', () => {
  const plain = [{ title: 'cover' }, { title: 'Points', bullets: ['a: b', 'c: d'] }];
  plain.forEach((s) => { s.composition = { mood: 'midnight', accentColor: T.MOODS.midnight.accent }; });
  const html = build3DPresentationHTML(plain, 'T', {});
  assert.ok(/class="deco deco-grid dp-1"/.test(html), 'deco present');
});

test('image search never receives Kazakh/Russian queries', async () => {
  assert.strictEqual(isLatinQuery('Мемлекеттің экономикадағы рөлі'), false);
  assert.strictEqual(isLatinQuery('city skyline at dusk'), true);
  assert.strictEqual(isLatinQuery('Kazakhstan мемлекет'), false);
  assert.strictEqual(await findImage('Мемлекеттің экономикадағы рөлі', { used: new Set() }), null);
});

test('regression: photo-first grids keep text in the same row; steps split "label — detail"', () => {
  const slides = [{ title: 'A' }, { title: 'Photo', webImageUrl: 'data:image/jpeg;base64,AAAA', bullets: ['x: y', 'p: q'], composition: { mood: 'cloud', image: 'right_half' } }];
  const html = build3DPresentationHTML(slides, 'T', {});
  assert.ok(/\.g12>\*\{grid-row:1\}/.test(html), 'single grid row');
  const { toNode } = require('../products/presentation/design/analyze');
  assert.deepStrictEqual(toNode('Қарқын — әр оқушы өз жылдамдығымен'), { label: 'Қарқын', detail: 'әр оқушы өз жылдамдығымен' });
});

test('intro slide is guaranteed; credits parse from separate lines', () => {
  const g = require('../products/presentation/gemini');
  const sl = [{ title: 'Cover' }, { title: 'Нарық' }, { title: 'A' }, { title: 'B' }, { title: 'C' }];
  assert.strictEqual(g.ensureIntroSlide(sl, 'Kazakh'), true);
  assert.strictEqual(sl[1].title, 'Кіріспе');
  assert.strictEqual(sl[1].subtitle, 'Нарық');
  const ru = [{ title: 'x' }, { title: 'y' }, { title: 'a' }, { title: 'b' }, { title: 'c' }];
  g.ensureIntroSlide(ru, 'Russian');
  assert.strictEqual(ru[1].title, 'Введение');
  const m = g.parseCoverMeta('Тема. 8 слайд. қазақша\nОрындаған: Асан\nТексерген: Үсен');
  assert.strictEqual(m.performedBy, 'Асан');
  assert.strictEqual(m.checkedBy, 'Үсен');
});

test('language detection: "Казахстан" in the topic does not force Kazakh', () => {
  const { parseUserInput } = require('../products/presentation/gemini');
  assert.strictEqual(parseUserInput('Экономика Казахстана. 8 слайд. орысша').language, 'Russian');
  assert.strictEqual(parseUserInput('Влияние ИИ. 10 слайд. русский').language, 'Russian');
  assert.strictEqual(parseUserInput('Қазақстан экономикасы. 8 слайд. қазақша').language, 'Kazakh');
  assert.strictEqual(parseUserInput('History of Kazakhstan. 8 слайд. ағылшынша').language, 'English');
});

test('language mismatch detector + timeline never mixes long labels with numbers', () => {
  const g = require('../products/presentation/gemini');
  const kk = [{ title: 'Лев Толстой: өмірі мен шығармашылығы', bullets: ['Романдары әлемнің көптеген тілдеріне аударылған', '«Соғыс және бейбітшілік» — әдебиет тарихындағы ең ауқымды туындылардың бірі', 'Оның шығармалары адамгершілік пен әділеттілік мәселелерін көтереді'] }];
  assert.ok(g.languageMismatch(kk, 'Russian'));
  assert.strictEqual(g.languageMismatch(kk, 'Kazakh'), null);
});
