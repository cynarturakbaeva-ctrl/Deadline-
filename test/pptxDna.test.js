'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { extractDna, dnaToTheme } = require('../design-dna/pptxDna');
const T = require('../products/presentation/design/tokens');
const { applyDeckTheme } = require('../products/presentation/deckPolish');

const dna = extractDna(fs.readFileSync(path.join(__dirname, 'fixture-dark.pptx')));

test('DNA reads palette, fonts, sizes from a real PPTX', () => {
  assert.strictEqual(dna.slides, 4);
  assert.strictEqual(dna.palette.bg, '#0f172a');
  assert.strictEqual(dna.palette.accent, '#3b82f6');
  assert.strictEqual(dna.palette.dark, true);
  assert.strictEqual(dna.fonts.heading, 'Georgia');
  assert.strictEqual(dna.tone, 'editorial');
  assert.strictEqual(dna.typography.titlePt, 36);
});

test('reference theme is stamped on every slide and survives buildPalette', () => {
  const slides = [{}, {}];
  const mood = applyDeckTheme(slides, { seed: 's', style: 'business', refTheme: dnaToTheme(dna) });
  assert.ok(mood.startsWith('ref_'));
  assert.ok(slides.every((s) => s.composition.mood === mood && s.composition.accentColor === '#3b82f6'));
  const pal = T.buildPalette(mood, '#3b82f6', 'business');
  assert.strictEqual(pal.bg, '#0f172a');
  assert.strictEqual(pal.tone, 'editorial'); // style hint must not override the reference
});

test('non-pptx input is rejected', () => {
  assert.throws(() => extractDna(Buffer.from('not a zip at all, definitely')));
});
