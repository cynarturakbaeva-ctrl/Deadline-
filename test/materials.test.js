'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { analyzeMaterialFile, materialsToText, detectKind } = require('../core/materials');
const { makeZip } = require('../products/referat/zipmin');

test('detectKind: extension and magic bytes', () => {
  assert.strictEqual(detectKind('талап.pdf', Buffer.from('')), 'pdf');
  assert.strictEqual(detectKind('file.DOCX', Buffer.from('')), 'docx');
  assert.strictEqual(detectKind('file.PPTX', Buffer.from('')), 'pptx');
  assert.strictEqual(detectKind('file.ppt', Buffer.from('')), 'ppt');
  assert.strictEqual(detectKind('file.png', Buffer.from('')), 'image');
  assert.strictEqual(detectKind('notes.txt', Buffer.from('hello')), 'text');
  assert.strictEqual(detectKind('x.bin', Buffer.from('%PDF-1.4 test')), 'pdf');
});

test('txt material is read fully (not just filename)', async () => {
  const r = await analyzeMaterialFile({ name: 'материал.txt', buffer: Buffer.from('Кіріспе\nНегізгі бөлім\nҚорытынды\n', 'utf8') });
  assert.strictEqual(r.kind, 'text');
  assert.ok(r.text.includes('Негізгі бөлім'));
  assert.ok(r.preview.length > 0);
});

test('docx material text is extracted from word/document.xml', async () => {
  const docx = makeZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'word/document.xml', data: '<w:document><w:body><w:p><w:r><w:t>Мұғалім талабы: кемінде 10 слайд</w:t></w:r></w:p><w:p><w:r><w:t>Әр слайдта 40 сөзден аспасын</w:t></w:r></w:p></w:body></w:document>' },
  ]);
  const r = await analyzeMaterialFile({ name: 'талап.docx', buffer: docx });
  assert.strictEqual(r.kind, 'docx');
  assert.ok(r.text.includes('кемінде 10 слайд'));
  assert.ok(r.text.includes('40 сөзден аспасын'));
});

test('pptx material text is extracted in slide order', async () => {
  const buf = fs.readFileSync(path.join(__dirname, 'fixture-rich.pptx'));
  const r = await analyzeMaterialFile({ name: 'reference.pptx', buffer: buf });
  assert.strictEqual(r.kind, 'pptx');
  assert.ok(r.meta.slides >= 10);
  assert.ok(r.text.includes('[Слайд 1]'));
  assert.ok(r.text.includes('[Слайд 10]'));
  assert.ok(r.text.length > 200);
});

test('legacy OLE text salvage (ppt/doc): UTF-16LE strings', async () => {
  const payload = Buffer.from('Тақырып\0Қорытынды\0Әдебиеттер\0', 'utf16le');
  const r = await analyzeMaterialFile({ name: 'old.ppt', buffer: payload });
  assert.strictEqual(r.kind, 'ppt');
  assert.ok(r.text.includes('Тақырып'));
  assert.ok(r.text.includes('Қорытынды'));
});

test('unreadable binary returns safe empty result, never throws', async () => {
  const r = await analyzeMaterialFile({ name: 'x.bin', buffer: Buffer.from([1, 2, 3, 4, 5]) });
  assert.strictEqual(r.text, '');
  assert.ok(typeof r.note === 'string');
});

test('materialsToText joins multiple files as one context', () => {
  const list = [
    { name: 'талап.txt', kind: 'text', text: '10 слайд' },
    { name: 'материал.txt', kind: 'text', text: 'ЖИ рөлі' },
  ];
  const t = materialsToText(list);
  assert.ok(t.includes('ФАЙЛ: талап.txt'));
  assert.ok(t.includes('ФАЙЛ: материал.txt'));
  assert.ok(t.includes('10 слайд') && t.includes('ЖИ рөлі'));
});
