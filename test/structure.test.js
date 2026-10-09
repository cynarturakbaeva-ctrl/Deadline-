'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { analyzeReference, referenceItems } = require('../design-dna');
const { checkAll } = require('../requirements/checkers');

const rich = analyzeReference(fs.readFileSync(path.join(__dirname, 'fixture-rich.pptx')));
const roles = rich.outline.slides.map((s) => s.role);
const arch = rich.outline.slides.map((s) => s.archetype);

test('outline: count, order and roles come from the reference', () => {
  assert.strictEqual(rich.outline.slideCount, 10);
  assert.deepStrictEqual(roles, ['title', 'relevance', 'goal', 'content', 'content', 'content', 'content', 'content', 'conclusion', 'references']);
  assert.strictEqual(rich.outline.slides[1].title, 'Өзектілік');
});

test('archetypes are read from geometry', () => {
  assert.strictEqual(arch[0], 'title');
  assert.strictEqual(arch[1], 'text-image-left');
  assert.strictEqual(arch[3], 'cards-3');
  assert.strictEqual(arch[4], 'table');
  assert.strictEqual(arch[5], 'chart');
  assert.strictEqual(arch[6], 'big-number');
  assert.strictEqual(arch[7], 'full-image');
});

test('recurring elements: logo, bottom bar, slide number', () => {
  const types = rich.recurring.map((r) => r.type);
  assert.ok(types.includes('logo') && types.includes('bar') && types.includes('slide-number'), types.join(','));
  assert.strictEqual(rich.recurring.find((r) => r.type === 'bar').zone, 'bottom');
});

test('palette and fonts still come through', () => {
  assert.strictEqual(rich.dna.palette.bg, '#faf7f2');
  assert.strictEqual(rich.dna.palette.dark, false);
  assert.strictEqual(rich.dna.fonts.heading, 'Georgia');
});

test('image-only reference is flagged as unreliable', () => {
  const r = analyzeReference(fs.readFileSync(path.join(__dirname, 'fixture-images.pptx')));
  assert.ok(r.warnings.includes('image_only'));
});

test('reference items become hard requirements the checkers can verify', () => {
  const items = referenceItems(rich.outline).map((it, i) => ({ id: 'ref' + (i + 1), ...it }));
  assert.ok(items.find((i) => i.check === 'slide_count' && i.value === 10));
  assert.ok(items.find((i) => i.check === 'has_slide' && i.value === 'references'));
  const deck = Array.from({ length: 10 }, (_, i) => ({ title: 'Слайд ' + i, bullets: ['x'] }));
  deck[1].title = 'Өзектілік'; deck[2].title = 'Мақсат және міндеттер'; deck[8].title = 'Қорытынды'; deck[9].title = 'Пайдаланылған әдебиеттер';
  const res = checkAll({ items }, deck);
  assert.ok(res.every((r) => r.status === 'pass'), JSON.stringify(res.map((r) => [r.item.check, r.item.value, r.status])));
  const short = checkAll({ items }, deck.slice(0, 8));
  assert.ok(short.find((r) => r.item.check === 'slide_count').status === 'fail');
});
