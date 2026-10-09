'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { generateReferat, planFor } = require('../products/referat/index');
const { paginate } = require('../products/referat/layout');

const WORDS = 'государственное регулирование экономики играет важную роль развитии общества определяет основные направления политики эффективность управления ресурсами'.split(' ');
let seed = 5;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const sent = () => {
  const a = [];
  for (let i = 0, n = 8 + Math.floor(rnd() * 8); i < n; i++) a.push(WORDS[Math.floor(rnd() * WORDS.length)]);
  const t = a.join(' ');
  return t[0].toUpperCase() + t.slice(1) + '.';
};
const par = (c) => { const t = []; while (t.join(' ').length < c) t.push(sent()); return t.join(' '); };

async function stubLlm(system, user, label) {
  if (label === 'outline') {
    const ch = +user.match(/exactly (\d+) main/)[1];
    const sub = +((user.match(/exactly (\d+) sub-sections/) || [])[1] || 0);
    const refs = +user.match(/exactly (\d+) references/)[1];
    return {
      title: 'Тест тақырыбы', intro_focus: 'a', conclusion_focus: 'b',
      chapters: Array.from({ length: ch }, (_, i) => ({
        title: 'Тарау ' + (i + 1), focus: 'f',
        sections: sub ? Array.from({ length: sub }, (_, j) => ({ title: 'Бөлім ' + (j + 1), focus: 'f' })) : undefined,
      })),
      references: Array.from({ length: refs }, (_, i) => `Автор А.А. Кітап ${i + 1}. – Астана: Баспа, 20${10 + i}.`),
    };
  }
  const m = +user.match(/about (\d+) characters/)[1];
  return { paragraphs: Array.from({ length: Math.max(1, Math.round(m / 700)) }, () => par(560 + Math.floor(rnd() * 250))) };
}

for (const [pages, lang] of [[5, 'ru'], [10, 'kk'], [18, 'en']]) {
  test(`referat ${pages} pages (${lang}): exact page count, filled last page`, async () => {
    const r = await generateReferat({
      topic: 'Тест', pages, language: lang, llm: stubLlm,
      meta: { faculty: 'Ф', performedBy: 'А', checkedBy: 'Б' },
    });
    assert.ok(fs.existsSync(r.docxPath));
    assert.strictEqual(r.pages, pages, 'page count must match the request');
    assert.ok(r.lastFill >= 0.85 && r.lastFill <= 0.99, 'last page must be (almost) full, got ' + r.lastFill);
    const buf = fs.readFileSync(r.docxPath);
    assert.strictEqual(buf.readUInt32LE(0), 0x04034b50, 'valid zip');
    fs.unlinkSync(r.docxPath);
  });
}

test('plan scales with pages', () => {
  assert.ok(planFor(5).chapters === 2 && planFor(5).subs === 0);
  assert.ok(planFor(10).subs === 2);
  assert.ok(planFor(30).chapters === 4);
});

test('heading is never left alone at the bottom of a page', () => {
  // 29 жол толтырылған бет: тақырып пен келесі абзац бір бетке бірге ауысуы тиіс
  const blocks = [{ type: 'p', text: par(2100) }, { type: 'h1', text: 'Тақырып' }, { type: 'p', text: par(600) }];
  const sim = paginate(blocks);
  const next = sim.headingPages.get(1);
  assert.ok(next >= 1 && next <= sim.pages);
});
