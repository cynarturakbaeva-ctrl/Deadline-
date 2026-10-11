'use strict';
const test = require('node:test');
const assert = require('node:assert');
const IG = require('../products/presentation/design/infographics');
const A = require('../products/presentation/design/analyze');
const { build3DPresentationHTML } = require('../products/presentation/html3DBuilder');
const { pickIcon, ICON_NAMES } = require('../products/presentation/design/icons');
const { SAMPLES } = require('../scripts/infographic-gallery');
const P = require('../products/presentation/design/tokens').buildPalette('midnight');

test('every library component validates its showroom sample and renders text as HTML (editable in PPTX)', () => {
  const kinds = new Set();
  for (const s of SAMPLES) {
    const d = IG.validateInfographic(s.infographic);
    assert.ok(d, 'valid: ' + s.infographic.kind);
    kinds.add(d.kind);
    const html = IG.renderInfographic(d, 1000, 600, P);
    assert.ok(html.includes('ig-kind-' + d.kind));
    assert.ok(/data-role="label"/.test(html), d.kind + ' has text labels');
  }
  assert.deepStrictEqual([...kinds].sort(), IG.KIND_NAMES.slice().sort(), 'showroom covers all kinds');
});

test('validators refuse data that cannot be drawn honestly', () => {
  assert.strictEqual(IG.validateInfographic({ kind: 'bar', items: [{ label: 'A', value: 'көп' }, { label: 'B', value: '3' }] }), null);
  assert.strictEqual(IG.validateInfographic({ kind: 'donut', items: [{ label: 'A', value: '100%' }] }), null);
  assert.strictEqual(IG.validateInfographic({ kind: 'matrix', items: [{ label: 'A' }, { label: 'B' }] }), null);
  assert.strictEqual(IG.validateInfographic({ kind: 'pictogram', items: [{ label: 'A', value: '250' }] }), null);
  assert.strictEqual(IG.validateInfographic({ kind: 'unknown', items: [] }), null);
  assert.strictEqual(IG.validateInfographic(null), null);
  const d = IG.validateInfographic({ kind: 'line', unit: 'млн', items: [{ label: '2000', value: 14.9 }, { label: '2010', value: 16 }, { label: '2020', value: 18.7 }] });
  assert.strictEqual(d.items[0].display, '14,9', 'numbers use a decimal comma');
});

test('content is recognised as an infographic even without the LLM field', () => {
  const bar = IG.autoInfographic({ stats: [{ value: '40%', label: 'a' }, { value: '30%', label: 'b' }, { value: '20%', label: 'c' }, { value: '10%', label: 'd' }] });
  assert.strictEqual(bar.kind, 'bar');
  const swot = IG.autoInfographic({ bullets: ['Күшті жақтары: команда', 'Әлсіз жақтары: шығын', 'Мүмкіндіктер: нарық', 'Қауіптер: бәсеке'] });
  assert.strictEqual(swot.kind, 'matrix');
  assert.strictEqual(IG.autoInfographic({ stats: [{ value: '1', label: 'a' }, { value: '2', label: 'b' }] }), null, '2 stats stay cards');
});

test('builder picks the infographic layout (never on the cover) and keeps unrelated slides unchanged', () => {
  const deck = [
    { title: 'Cover', infographic: SAMPLES[0].infographic },
    SAMPLES[0], SAMPLES[6],
    { title: 'Text', bullets: ['a: b', 'c: d'] },
  ];
  const types = A.planDeck(deck).map((p) => p.type);
  assert.deepStrictEqual(types.slice(0, 3), ['cover', 'infographic', 'infographic']);
  assert.notStrictEqual(types[3], 'infographic');
  const html = build3DPresentationHTML(deck, 'T', {});
  assert.ok(html.includes('data-layout="infographic"') && html.includes('ig-kind-bar') && html.includes('ig-kind-cycle'));
});

test('icon picker understands Kazakh / Russian / English words and the explicit name', () => {
  assert.strictEqual(pickIcon('rocket', ''), 'rocket');
  assert.strictEqual(pickIcon('', 'Халық саны'), 'users');
  assert.strictEqual(pickIcon('', 'Экономика'), 'chart-bar');
  assert.strictEqual(pickIcon('', 'бойынша'), null, 'no false match inside words');
  assert.ok(ICON_NAMES.length >= 100);
});
