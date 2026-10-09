'use strict';
const test = require('node:test');
const assert = require('node:assert');
const T = require('../products/presentation/design/tokens');
const A = require('../products/presentation/design/analyze');
const { build3DPresentationHTML } = require('../products/presentation/html3DBuilder');

const deck = [
  { title: 'Cover', subtitle: 'Sub', bullets: ['Орындаған: A'] },
  { title: 'Intro', body: 'word '.repeat(40) },
  { title: 'Steps', bullets: ['A: a', 'B: b', 'C: c'], composition: { visualPurpose: 'process' } },
  { title: 'When', bullets: ['1990: a', '2000: b', '2010: c'], composition: { visualPurpose: 'timeline' } },
  { title: 'Num', stats: [{ value: '87%', label: 'x' }] },
  { title: 'Nums', stats: [{ value: '1', label: 'a' }, { value: '2', label: 'b' }] },
  { title: 'Tbl', table: { headers: ['a', 'b'], rows: [['1', '2']] } },
  { title: 'Quote', subtitle: 'Words', composition: { layout: 'quote_hero' } },
  { title: 'Қорытынды', bullets: ['x', 'y'] },
];

test('every palette keeps text/accent readable', () => {
  for (const mood of Object.keys(T.MOODS)) {
    const p = T.buildPalette(mood, null, '');
    assert.ok(T.contrast(p.text, p.bg) >= 7, mood + ' text');
    assert.ok(T.contrast(p.accent, p.bg) >= 3.4, mood + ' accent');
  }
});

test('classification picks distinct compositions', () => {
  const types = A.planDeck(deck).map((p) => p.type);
  assert.deepStrictEqual(types.slice(0, 1), ['cover']);
  for (const t of ['process', 'timeline', 'number', 'stats', 'comparison', 'quote', 'conclusion']) assert.ok(types.includes(t), t);
});

test('no three identical layouts in a row (rhythm)', () => {
  const same = Array.from({ length: 8 }, (_, i) => ({ title: 'T' + i, bullets: ['a: b', 'c: d', 'e'], body: 'x' }));
  same.unshift({ title: 'Cover' });
  const l = A.planDeck(same).map((p) => p.layout);
  for (let i = 2; i < l.length; i++) assert.ok(l[i] !== l[i - 1], 'adjacent repeat at ' + i + ': ' + l.join(' '));
});

test('builder keeps public API + runtime hooks the renderer relies on', () => {
  const html = build3DPresentationHTML(deck, 'Deck', { style: 'business' });
  for (const hook of ['class="slide', 'id="stage"', 'id="controls"', 'id="dots"', 'window.__qaDone', 'data-layout="cover"', 'class="block']) {
    assert.ok(html.includes(hook), hook);
  }
  assert.strictEqual((html.match(/<article class="slide/g) || []).length, deck.length);
});

test('empty / malformed slides never throw', () => {
  assert.doesNotThrow(() => build3DPresentationHTML([{}, { title: null, bullets: 'x' }, { stats: [{}] }], 't'));
  assert.doesNotThrow(() => build3DPresentationHTML([], 't'));
});
