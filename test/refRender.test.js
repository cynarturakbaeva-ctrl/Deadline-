'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { analyzeReference } = require('../design-dna');
const { applyReferencePlan, layoutMatch } = require('../products/presentation/refPlan');

const rich = analyzeReference(fs.readFileSync(path.join(__dirname, 'fixture-rich.pptx')));
const mk = (n) => Array.from({ length: n }, (_, i) => ({
  title: `Тақырып ${i + 1}`, bullets: ['Бір: бірінші ой', 'Екі: екінші ой', 'Үш: үшінші ой', 'Төрт: төртінші ой'],
}));

test('applyReferencePlan assigns archetype per slide and shapes cards', () => {
  const slides = mk(10);
  const r = applyReferencePlan(slides, rich.outline);
  assert.strictEqual(r.assigned, 10);
  assert.strictEqual(slides[3].composition.refArchetype, 'cards-3');
  assert.strictEqual(slides[3].bullets.length, 3);
  assert.ok(slides[3].bullets.every((b) => b.includes(':')));
});

test('applyReferencePlan builds a table and a stat only from existing text', () => {
  const slides = mk(10);
  slides[6].bullets = ['Өсім 45% жылына'];
  applyReferencePlan(slides, rich.outline);
  assert.ok(slides[4].table && slides[4].table.rows.length >= 3);
  assert.ok(Array.isArray(slides[6].stats) && /45/.test(slides[6].stats[0].value));
});

test('layoutMatch reports a percentage and misses', () => {
  const slides = mk(10);
  applyReferencePlan(slides, rich.outline);
  const m = layoutMatch(slides);
  assert.ok(m.total > 0 && m.pct >= 0 && m.pct <= 100);
  assert.ok(Array.isArray(m.miss));
  assert.strictEqual(layoutMatch(mk(3)).pct, 100); // no reference → nothing to miss
});

test('skin only contains edge decorations, never content blocks', () => {
  const kinds = (rich.skin ? rich.skin.shapes || [] : []);
  for (const s of kinds) {
    assert.ok(['bar', 'side-bar', 'accent-shape'].includes(s.type || s.kind));
  }
});

test('text-only reference: tables, steps, visuals and stats are flattened into bullets', () => {
  const dark = analyzeReference(fs.readFileSync(path.join(__dirname, 'fixture-dark.pptx')));
  const slides = Array.from({ length: dark.outline.slides.length }, (_, i) => ({ title: `Т${i + 1}`, bullets: ['А: бір', 'Б: екі'] }));
  const i = slides.length - 2;
  Object.assign(slides[i], { table: { headers: ['x', 'y'], rows: [['Диод', 'токты өткізеді'], ['Транзистор', 'күшейтеді'], ['Реле', 'ажыратады']] }, visual: { type: 'diagram' }, steps: [{ label: 'Бір' }, { label: 'Екі' }] });
  const arch = dark.outline.slides[i].archetype;
  assert.ok(!['table', 'chart'].includes(arch), 'fixture slide must not be table/chart');
  const r = applyReferencePlan(slides, dark.outline);
  assert.ok(!slides[i].table && !slides[i].visual && !slides[i].steps);
  assert.ok(slides[i].bullets.some((b) => /Диод/.test(b)));
  assert.ok(r.adapted.some((a) => /flatten/.test(a.what)));
});

test('chart/table archetypes keep their structure', () => {
  const slides = mk(10);
  slides[5].visual = { type: 'diagram' };
  slides[4].table = { headers: [], rows: [['a', 'b'], ['c', 'd'], ['e', 'f']] };
  applyReferencePlan(slides, rich.outline);
  assert.ok(slides[5].visual);
  assert.ok(slides[4].table);
});

test('role title: reference conclusion slide gets a conclusion-named title', () => {
  const slides = mk(10);
  const roles = rich.outline.slides.map((x) => x.role);
  const ci = roles.indexOf('conclusion');
  slides[ci].title = 'Римнің тарихи маңызы мен мұрасы';
  const r = applyReferencePlan(slides, rich.outline);
  assert.ok(/қорытынды/i.test(slides[ci].title));
  assert.ok(r.adapted.some((a) => /title role/.test(a.what)));
});

test('decor: Canva-like reference yields bg image, decor items and circle photos', () => {
  const ref = analyzeReference(fs.readFileSync(path.join(__dirname, 'fixture-canva.pptx')));
  assert.ok(ref.skin.decor && ref.skin.decor.hasBgImage);
  assert.ok(ref.skin.decor.items >= 10);
  assert.strictEqual(ref.skin.photoShape, 'circle');
  assert.strictEqual(ref.dna.tone, 'editorial');
  const { build3DPresentationHTML } = require('../products/presentation/html3DBuilder');
  const slides = mk(7).map((s, i) => ({ ...s, title: i === 0 ? 'Тақырып' : s.title }));
  applyReferencePlan(slides, ref.outline);
  const html = build3DPresentationHTML(slides, 'Т', { skin: ref.skin, refRoles: ref.outline.roles });
  assert.ok(/ref-decor/.test(html) && /class="ref-bg dm dm\d+"/.test(html) && /--cl:/.test(html));
});
