'use strict';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../products/presentation/design/decor');

const tags = (t) => Object.keys(D.THEMES).filter((k) => D.THEMES[k].test(t));
const icons = (t) => D.pickIconDecor(t, new Set(), 2).map((x) => x.name);

test('decor themes match word stems, not fragments inside other words', () => {
  for (const t of ['Клиент портреті', 'Алгоритм сортировки', 'Start the chart', 'We have been there', 'Тауар нарығы', 'Жергілікті нарық', 'Ала алмау', 'Pressure', 'Свою работу']) {
    assert.deepStrictEqual(tags(t), [], t);
  }
  assert.ok(tags('Қазақ хандығы').includes('crown'));
  assert.ok(tags('Теңіз порты').includes('anchor'));
  assert.ok(tags('Морские порты').includes('ship'));
  assert.ok(tags('Ақын өлеңдері').includes('quill'));
  assert.ok(!tags('Өнеркәсіп').includes('theater'));
});

test('icon decor: social media is a phone, not a network diagram; no ship for portfolio', () => {
  assert.strictEqual(icons('Маркетинг арналары: Instagram, TikTok')[0], 'smartphone');
  assert.deepStrictEqual(icons('Клиент портреті, сегменттеу'), []);
  assert.deepStrictEqual(icons('Search portfolio'), []);
  assert.deepStrictEqual(icons('Арнайы әдістер'), []);
  assert.deepStrictEqual(icons('История России'), []);
  assert.strictEqual(icons('Искусственный интеллект')[0], 'brain-circuit');
});
