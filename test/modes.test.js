'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseRequirements, runRequirementsQa } = require('../requirements');
const { analyzeReference } = require('../design-dna');
const { buildTemplateReport } = require('../products/presentation/templateQa');
const { applyReferencePlan } = require('../products/presentation/refPlan');

const mk = (n, title) => Array.from({ length: n }, (_, i) => ({
  index: i + 1,
  title: title || ('Слайд ' + (i + 1)),
  subtitle: 'Қосымша түсініктеме',
  bullets: ['бір екі үш төрт бес'],
  composition: {},
}));

test('requirements QA: deterministic fix renames last slide to conclusion and shortens words', async () => {
  const llm = async () => ({ items: [
    { kind: 'hard', check: 'has_slide', value: 'conclusion', quote: 'қорытынды слайд болсын' },
    { kind: 'hard', check: 'max_words_per_slide', op: '<=', value: 5, quote: '5 сөзден аспасын' },
  ] });
  const { set } = await parseRequirements('Соңында қорытынды слайд болсын. Әр слайдта 5 сөзден аспасын.', { llm });
  const slides = mk(3);
  slides[2].title = 'Соңы';
  slides[2].subtitle = '';
  slides[2].bullets = ['бір екі үш төрт бес алты жеті'];
  const r = await runRequirementsQa(set, slides, { language: 'kk', repairLlm: false, judge: false });
  assert.strictEqual(r.report.summary.hardTotal, 2);
  assert.ok(r.report.results.filter((x) => x.kind === 'hard').every((x) => x.status === 'pass'), JSON.stringify(r.report.results));
  assert.ok(r.repaired.length >= 1);
  assert.strictEqual(r.slides.length, 3);
});

test('requirements QA: slide_count mismatch is reported (no crash without LLM repair)', async () => {
  const { set } = await parseRequirements('Дәл 8 слайд болуы керек', { llm: false });
  const r = await runRequirementsQa(set, mk(3), { language: 'kk', repairLlm: false, judge: false });
  const sc = r.report.results.find((x) => x.check === 'slide_count');
  assert.strictEqual(sc.status, 'fail');
  assert.strictEqual(r.report.summary.hardPassed, 0);
});

test('requirements QA: LLM repair path is used when allowed', async () => {
  const { set } = await parseRequirements('Дәл 5 слайд болуы керек', { llm: false });
  const llm = async (s, u, l) => ({ slides: Array.from({ length: 5 }, (_, i) => ({ index: i + 1, title: 'Слайд ' + (i + 1), bullets: ['бір екі'] })) });
  const r = await runRequirementsQa(set, mk(3), { language: 'kk', llm, judge: false });
  assert.strictEqual(r.slides.length, 5);
  assert.strictEqual(r.report.summary.hardPassed, 1);
});

test('template QA: reports pass/fail checks and a score', () => {
  const ref = analyzeReference(fs.readFileSync(path.join(__dirname, 'fixture-rich.pptx')));
  const slides = mk(ref.outline.slideCount);
  applyReferencePlan(slides, ref.outline);
  const rep = buildTemplateReport(ref, slides, { refTheme: ref.theme });
  assert.strictEqual(rep.total, 6);
  assert.ok(Number.isFinite(rep.score));
  assert.ok(rep.checks.find((c) => c.name === 'slide_count').status === 'pass');
  assert.ok(rep.checks.find((c) => c.name === 'role_order').status === 'pass');
  assert.ok(/Template compliance/.test(rep.summary));

  const short = buildTemplateReport(ref, mk(5), { refTheme: ref.theme });
  assert.strictEqual(short.checks.find((c) => c.name === 'slide_count').status, 'fail');
});
