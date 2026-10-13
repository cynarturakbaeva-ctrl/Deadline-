'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../products/presentation/design/analyze');
const { limitInfographics, limitTables } = require('../products/presentation/deckPolish');
const { planPhotoSlides } = require('../products/presentation/photoPlan');

const years = (ys, vs) => ys.map((y, i) => ({ label: String(y), value: vs[i] }));
const line = (ys, vs) => ({ kind: 'line', items: years(ys, vs) });
const cycle = { kind: 'cycle', center: 'Цикл', items: [{ label: 'A', detail: 'a' }, { label: 'B', detail: 'b' }, { label: 'C', detail: 'c' }, { label: 'D', detail: 'd' }] };
const bar = { kind: 'bar', items: [{ label: 'Азия', value: '60%' }, { label: 'Африка', value: '18%' }, { label: 'Еуропа', value: '9%' }] };
const iconGrid = { kind: 'iconGrid', items: [{ label: 'Білім', detail: 'мектеп' }, { label: 'Денсаулық', detail: 'аурухана' }, { label: 'Еңбек', detail: 'жұмыс' }] };
const matrix = { kind: 'matrix', items: [{ label: 'S', detail: 'a' }, { label: 'W', detail: 'b' }, { label: 'O', detail: 'c' }, { label: 'T', detail: 'd' }] };
const compare = { kind: 'compare', items: [{ label: '1920', value: '20%' }, { label: '2020', value: '56%' }] };

const layouts = (slides) => A.planDeck(slides).map((p) => p.layout);
const count = (arr, v) => arr.filter((x) => x === v).length;

test('chart-heavy 10-slide deck keeps at most 3 infographics, never adjacent', () => {
  const deck = [
    { title: 'Мұқаба', subtitle: 'x' },
    { title: 'Кіріспе', bullets: ['a: b', 'c: d', 'e: f'] },
    { title: 'Өсу', subtitle: 's', infographic: line([1920, 1950, 1980, 2024], ['1,9', '2,5', '4,4', '8,1']) },
    { title: 'Цикл', subtitle: 's', infographic: cycle },
    { title: 'Аймақтар', subtitle: 's', infographic: bar },
    { title: 'Бағыттар', subtitle: 's', infographic: iconGrid },
    { title: 'SWOT', subtitle: 's', infographic: matrix },
    { title: 'Қала', subtitle: 's', infographic: compare },
    { title: 'Тағы өсу', subtitle: 's', infographic: line([1927, 1960, 1999], ['2', '3', '6']) },
    { title: 'Қорытынды', bullets: ['a', 'b', 'c'] },
  ];
  const converted = limitInfographics(deck);
  const plan = layouts(deck);
  assert.ok(count(plan, 'infographic') <= 3, plan.join(','));
  assert.strictEqual(converted, 7 - count(plan, 'infographic'));
  plan.forEach((l, i) => { if (i && l === 'infographic') assert.notStrictEqual(plan[i - 1], 'infographic', plan.join(',')); });
  // every converted slide keeps its data as text
  deck.forEach((s) => { if (s.noInfographic) assert.ok((s.bullets && s.bullets.length) || (s.stats && s.stats.length), s.title); });
  // and the deck now has room for photos
  assert.ok(planPhotoSlides(deck, { budget: 4 }).indexes.size >= 3);
});

test('two trend charts of one deck: only the first stays a chart', () => {
  const deck = [
    { title: 'Мұқаба' },
    { title: 'Өсу 1920–2024', subtitle: 's', infographic: line([1920, 1950, 1980, 2024], ['1,9 млрд', '2,5 млрд', '4,4 млрд', '8,1 млрд']) },
    { title: 'Мәтін', bullets: ['a: b', 'c: d'] },
    { title: 'Жарылыс 1927–1999', subtitle: 's', infographic: { kind: 'column', items: years([1927, 1960, 1974, 1999], ['2', '3', '4', '6']) } },
    { title: 'Мәтін 2', bullets: ['a: b', 'c: d'] },
    { title: 'Қорытынды', bullets: ['a', 'b'] },
  ];
  limitInfographics(deck);
  assert.ok(deck[1].infographic);
  assert.strictEqual(deck[3].infographic, null);
  assert.deepStrictEqual(deck[3].bullets, ['1927 — 2', '1960 — 3', '1974 — 4', '1999 — 6']);
  assert.notStrictEqual(layouts(deck)[3], 'infographic');
});

test('a kept table counts as a data slide: no infographic right next to it', () => {
  const deck = [
    { title: 'Мұқаба' },
    { title: 'Кіріспе', bullets: ['a: b', 'c: d'] },
    { title: 'Кесте', table: { headers: ['A', 'B'], rows: [['1', '2'], ['3', '4']] } },
    { title: 'Цикл', subtitle: 's', infographic: cycle },
    { title: 'Мәтін', bullets: ['a: b', 'c: d'] },
    { title: 'Бағыттар', subtitle: 's', infographic: iconGrid },
    { title: 'Мәтін 2', bullets: ['a: b', 'c: d'] },
    { title: 'Қорытынды', bullets: ['a', 'b'] },
  ];
  limitTables(deck);
  limitInfographics(deck);
  assert.strictEqual(deck[3].infographic, null);
  assert.ok(deck[5].infographic);
});

test('auto-detected infographic is blocked once converted, explicit ones win', () => {
  const stats = [{ value: '40%', label: 'a' }, { value: '30%', label: 'b' }, { value: '20%', label: 'c' }, { value: '10%', label: 'd' }];
  const deck = [
    { title: 'Мұқаба' },
    { title: 'Авто', stats },
    { title: 'Анық', subtitle: 's', infographic: bar },
    { title: 'Мәтін', bullets: ['a: b', 'c: d'] },
  ];
  limitInfographics(deck);
  assert.ok(deck[2].infographic, 'explicit LLM infographic kept');
  assert.strictEqual(deck[1].noInfographic, true);
  assert.notStrictEqual(layouts(deck)[1], 'infographic');
});

test('compare becomes stat cards; existing text is never overwritten', () => {
  const deck = [
    { title: 'Мұқаба' },
    { title: 'A', subtitle: 's', infographic: bar },
    { title: 'Қала', subtitle: 's', infographic: compare },
    { title: 'Мәтінді', bullets: ['өз ойы бір', 'өз ойы екі'], infographic: cycle },
  ];
  limitInfographics(deck);
  assert.deepStrictEqual(deck[2].stats, [{ value: '20%', label: '1920' }, { value: '56%', label: '2020' }]);
  assert.deepStrictEqual(deck[3].bullets, ['өз ойы бір', 'өз ойы екі']);
});

test('balanced deck is left alone', () => {
  const deck = [
    { title: 'Мұқаба' },
    { title: 'Кіріспе', bullets: ['a: b', 'c: d'] },
    { title: 'Өсу', subtitle: 's', infographic: line([1920, 1950, 1980, 2024], ['1', '2', '3', '4']) },
    { title: 'Мәтін', bullets: ['a: b', 'c: d'] },
    { title: 'Мәтін', bullets: ['e: f', 'g: h'] },
    { title: 'Цикл', subtitle: 's', infographic: cycle },
    { title: 'Мәтін', bullets: ['a: b', 'c: d'] },
    { title: 'Қорытынды', bullets: ['a', 'b'] },
  ];
  assert.strictEqual(limitInfographics(deck), 0);
});
