'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseRequirements, auditSlides, effectiveSlideCount, briefFromRequirements, formatReport } = require('../requirements');
const { baselineItems } = require('../requirements/baseline');
const { checkAll } = require('../requirements/checkers');

const TEXT = 'Презентация кемінде 10 слайд болсын. Әр слайдта 40 сөзден аспасын. Соңында әдебиеттер тізімі, кемінде 5 дереккөз. Шрифт Times New Roman 18. Мұқият рәсімдеңдер.';

test('baseline extracts measurable items with correct operators', () => {
  const items = baselineItems(TEXT);
  const sc = items.find((i) => i.check === 'slide_count');
  assert.deepStrictEqual([sc.op, sc.value], ['>=', 10]);
  assert.ok(items.find((i) => i.check === 'max_words_per_slide' && i.value === 40));
  assert.ok(items.find((i) => i.check === 'sources_min' && i.value === 5));
  assert.ok(items.find((i) => i.kind === 'unverifiable' && /Times/i.test(i.quote)), 'font requirement must be unverifiable');
});

test('LLM items with invented quotes are dropped (no invented requirements)', async () => {
  const llm = async () => ({ items: [
    { kind: 'hard', check: 'has_slide', value: 'conclusion', quote: 'қорытынды слайд міндетті' }, // мәтінде жоқ
    { kind: 'hard', check: 'has_slide', value: 'references', quote: 'әдебиеттер тізімі' },
    { kind: 'soft', check: 'judge', rubric: 'careful formatting', quote: 'Мұқият рәсімдеңдер' },
    { kind: 'hard', check: 'made_up_check', value: 1, quote: 'кемінде 10 слайд' },
  ] });
  const { set, llm: state } = await parseRequirements(TEXT, { llm });
  assert.strictEqual(state, 'ok');
  assert.ok(!set.items.find((i) => i.value === 'conclusion'));
  assert.ok(set.items.find((i) => i.check === 'has_slide' && i.value === 'references'));
  assert.ok(set.items.find((i) => i.kind === 'soft'));
  assert.ok(!set.items.find((i) => i.check === 'made_up_check'));
});

test('LLM failure falls back to baseline', async () => {
  const { set, llm } = await parseRequirements(TEXT, { llm: async () => { throw new Error('down'); } });
  assert.strictEqual(llm, 'failed');
  assert.ok(set.items.length >= 3);
});

test('empty text costs nothing and yields no items', async () => {
  let called = false;
  const r = await parseRequirements('   ', { llm: async () => { called = true; return {}; } });
  assert.strictEqual(r.set.items.length, 0);
  assert.strictEqual(called, false);
});

const mk = (n, bullets = ['a b c']) => Array.from({ length: n }, (_, i) => ({ title: 'Слайд ' + (i + 1), bullets }));

test('checkers: slide_count, words, references', async () => {
  const { set } = await parseRequirements(TEXT, { llm: false });
  const slides = mk(8, ['сөз '.repeat(60).trim()]);
  const res = checkAll(set, slides);
  const by = (c) => res.find((r) => r.item.check === c);
  assert.strictEqual(by('slide_count').status, 'fail');
  assert.strictEqual(by('max_words_per_slide').status, 'fail');
  assert.strictEqual(by('sources_min').status, 'fail');
  const good = mk(10, ['бір екі үш']);
  good[9] = { title: 'Пайдаланылған әдебиеттер', bullets: ['Автор А. Кітап 1. – Астана, 2020.', 'Автор Б. Кітап 2. – Астана, 2021.', 'Автор В. Кітап 3. – Астана, 2019.', 'Автор Г. Кітап 4. – Алматы, 2018.', 'Автор Д. Кітап 5. – Алматы, 2022.'] };
  const res2 = checkAll(set, good);
  assert.ok(res2.filter((r) => r.item.kind === 'hard').every((r) => r.status === 'pass'), JSON.stringify(res2.map((r) => [r.item.check, r.status])));
});

test('effectiveSlideCount: exact requirement overrides the form, with a note', async () => {
  const { set } = await parseRequirements('Ровно 12 слайдов', { llm: false });
  const r = effectiveSlideCount(set, 8);
  assert.strictEqual(r.count, 12);
  assert.ok(r.note);
  assert.strictEqual(effectiveSlideCount({ items: [] }, 8).count, 8);
});

test('report never marks soft or unverifiable items as passed', async () => {
  const llm = async () => ({ items: [{ kind: 'soft', check: 'judge', rubric: 'few words', quote: 'Мұқият рәсімдеңдер' }] });
  const { set } = await parseRequirements(TEXT, { llm });
  const rep = await auditSlides(set, mk(10), { judgeLlm: async () => ({ scores: [{ id: set.items.find((i) => i.kind === 'soft').id, score: 0.7, note: 'жақсы' }] }) });
  const soft = rep.results.find((r) => r.kind === 'soft');
  assert.strictEqual(soft.status, 'soft');
  assert.strictEqual(soft.score, 0.7);
  assert.ok(rep.results.filter((r) => r.kind === 'unverifiable').every((r) => r.status === 'unverifiable'));
  const txt = formatReport(rep, 'kk');
  assert.ok(/➖/.test(txt) && /🔸/.test(txt));
  assert.ok(briefFromRequirements(set).includes('Teacher requirements'));
});
