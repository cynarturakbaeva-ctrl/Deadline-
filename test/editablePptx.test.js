'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const { exportToPptx, blockRuns, blockBox, officeFont, proofLang } = require('../products/presentation/pptxExporter');

const style = (o = {}) => Object.assign({ font: 'Calibri', size: 40, bold: false, italic: false, color: 'FFFFFF', alpha: 1, spacing: 0, upper: false }, o);
const block = (lines, o = {}) => Object.assign({ x: 128, y: 200, w: 800, h: 120, align: 'left', lineHeight: 48, nowrap: false, lines }, o);
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('browser lines become one paragraph with soft breaks; same-style words merge', () => {
  const runs = blockRuns(block([
    [{ text: 'Қазақ', space: false, s: style() }, { text: 'хандығы', space: true, s: style() }],
    [{ text: 'және', space: false, s: style() }, { text: 'дамуы', space: true, s: style({ color: 'D6B25E', italic: true }) }],
  ]), 'kk-KZ');
  assert.deepStrictEqual(runs.map((r) => r.text), ['Қазақ хандығы', 'және', ' дамуы']);
  assert.strictEqual(runs[1].options.softBreakBefore, true);
  assert.ok(!runs[0].options.softBreakBefore && !runs[2].options.softBreakBefore);
  assert.strictEqual(runs[2].options.color, 'D6B25E');
  assert.strictEqual(runs[0].options.fontSize, 20); // 40px on the 1920 stage = 20pt on a 13.33in slide
  assert.ok(runs.every((r) => r.options.lang === 'kk-KZ'));
});

test('uppercase labels, Office font mapping, proofing language', () => {
  const runs = blockRuns(block([[{ text: 'Орындаған', space: false, s: style({ upper: true, spacing: 3 }) }]]));
  assert.strictEqual(runs[0].text, 'ОРЫНДАҒАН');
  assert.strictEqual(runs[0].options.charSpacing, 1.5);
  assert.strictEqual(officeFont('Times New Roman'), 'Times New Roman');
  assert.strictEqual(officeFont('Calibri'), 'Calibri');
  assert.strictEqual(proofLang('Қазақ'), 'kk-KZ');
  assert.strictEqual(proofLang('Экономика'), 'ru-RU');
  assert.strictEqual(proofLang('Economy'), 'en-US');
  // short Kazakh word without special letters follows the deck language
  assert.strictEqual(blockRuns(block([[{ text: 'Топ', space: false, s: style() }]]), 'kk-KZ')[0].options.lang, 'kk-KZ');
});

test('text boxes get width slack without moving centred text', () => {
  const l = blockBox(block([[{ text: 'a', s: style() }]]));
  assert.strictEqual(l.x, 128); assert.ok(l.w > 800);
  const c = blockBox(block([[{ text: 'a', s: style() }]], { align: 'center' }));
  assert.ok(Math.abs((c.x + c.w / 2) - (128 + 400)) < 0.01, 'centre kept');
});

test('export writes a background picture + native editable text; missing layer falls back to the full picture', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edpptx-'));
  const full = [path.join(dir, 'f1.png'), path.join(dir, 'f2.png')];
  const bg = path.join(dir, 'b1.png');
  [...full, bg].forEach((p) => fs.writeFileSync(p, PNG_1PX));
  const layer = [block([[{ text: 'Цифрлық', space: false, s: style({ font: 'Times New Roman', size: 120 }) }, { text: 'экономика', space: true, s: style({ font: 'Times New Roman', size: 120 }) }]])];
  const out = await exportToPptx(full, 'T', [{ speakerNotes: 'Сөз' }, {}], { bgPaths: [bg, null], textLayers: [layer, null], language: 'Kazakh' });
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
  const s2 = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.ok(s1.includes('<a:t>Цифрлық экономика</a:t>'), 'native text on slide 1');
  assert.ok(/typeface="Times New Roman"/.test(s1) && /lang="kk-KZ"/.test(s1));
  assert.ok(!/<a:t>/.test(s2), 'slide 2 has no text layer → picture only');
  assert.strictEqual((s1.match(/<p:pic>/g) || []).length, 1);
  fs.rmSync(dir, { recursive: true, force: true }); fs.unlinkSync(out);
});
