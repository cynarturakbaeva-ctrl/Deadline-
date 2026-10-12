'use strict';
const test = require('node:test');
const assert = require('node:assert');
const A = require('../products/presentation/design/analyze');
const { planPhotoSlides } = require('../products/presentation/photoPlan');
const { SAMPLES } = require('../scripts/infographic-gallery');

const PHOTO = 'data:image/jpeg;base64,' + Buffer.alloc(30).toString('base64');
const deck = [
  { title: 'Cover', subtitle: 'Sub' },
  { title: 'Intro', body: 'word '.repeat(40) },
  { title: 'Points', bullets: ['a: b c', 'd: e f', 'g: h i'] },
  { title: 'Numbers', stats: [{ value: '40%', label: 'a' }, { value: '20%', label: 'b' }] },
  { title: 'Photo moment', subtitle: 'short line' },
  SAMPLES[0],
  { title: 'Steps', bullets: ['A: a', 'B: b', 'C: c'], composition: { visualPurpose: 'process' } },
  { title: 'Table', table: { headers: ['a', 'b'], rows: [['1', '2']] }, composition: { image: 'none' } },
  { title: 'Қорытынды', bullets: ['x', 'y'] },
];

test('photos are searched only where the layout shows one, and the layouts stay exactly the same', () => {
  const { indexes } = planPhotoSlides(deck, { budget: 99 });
  const all = deck.map((s) => ({ ...s, webImageUrl: PHOTO }));
  const only = deck.map((s, i) => ({ ...s, webImageUrl: indexes.has(i) ? PHOTO : '' }));
  assert.deepStrictEqual(A.planDeck(only).map((p) => p.layout), A.planDeck(all).map((p) => p.layout));
  assert.ok(indexes.has(0), 'cover gets a photo');
  for (const i of [3, 5, 6, 7]) assert.ok(!indexes.has(i), 'no search for slide ' + (i + 1));
  assert.ok(indexes.size < deck.length);
});

test('the budget keeps the cover first', () => {
  const { indexes } = planPhotoSlides(deck, { budget: 1 });
  assert.deepStrictEqual([...indexes], [0]);
  assert.strictEqual(planPhotoSlides(deck, { budget: 0 }).indexes.size, 0);
});
