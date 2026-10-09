'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const S = require('../products/presentation/templateStory');
const T = require('../products/presentation/templateFill');
const { analyzeReference } = require('../design-dna');

const FIXTURES = ['fixture-rich.pptx', 'fixture-canva.pptx', 'fixture-dark.pptx'].map((f) => path.join(__dirname, f));

/** Шаблон слайдтарындағы мәтін фрагменттері (≥ 4 әріп сөздер мен тақырыптар) */
function templateTexts(buf) {
  const files = T.readZipAll(buf);
  const out = new Set();
  for (const [name, xml] of files) {
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue;
    for (const sh of T.textShapes(xml)) {
      const t = sh.text.replace(/&amp;/g, '&').trim();
      if (t.length >= 6) out.add(t.slice(0, 40));
    }
  }
  return [...out];
}

test('шаблонның мәтіні мен бөлім атаулары жоспарлаушыға да, слот ережелеріне де ЖЕТПЕЙДІ', () => {
  for (const f of FIXTURES) {
    const buf = fs.readFileSync(f);
    const ref = analyzeReference(buf);
    const plan = T.planTemplateSlots(buf);
    const prompt = S.buildPrompt({ topic: 'Цифрлық экономика', brief: '', language: 'Kazakh', plan, anchors: S.anchorsFromOutline(ref.outline, plan.length) });
    const rules = plan.map((p, i) => T.slotRuleLine(p, i + 1)).join('\n');
    const leaked = templateTexts(buf).filter((t) => prompt.includes(t) || rules.includes(t));
    assert.deepStrictEqual(leaked, [], `${path.basename(f)}: шаблон мәтіні промптқа кірді`);
    assert.match(prompt, new RegExp(`exactly ${plan.length} entries`));
  }
});

test('тіректер: тек форма-деңгейіндегі рөлдер (мұқаба, мазмұны, қорытынды, әдебиет, рахмет)', () => {
  const outline = { slides: [{ role: 'title' }, { role: 'goal' }, { role: 'agenda' }, { role: 'intro' }, { role: 'content' }, { role: 'conclusion' }, { role: 'thanks' }] };
  assert.deepStrictEqual(S.anchorsFromOutline(outline, 7), ['title', null, 'agenda', null, null, 'conclusion', 'thanks']);
  // «Executive summary» 3-слайдта — қорытынды емес; «Thank you» ортада — тірек емес
  const biz = { slides: [{ role: 'title' }, { role: 'content' }, { role: 'conclusion' }, { role: 'content' }, { role: 'thanks' }, { role: 'content' }, { role: 'content' }, { role: 'content' }, { role: 'content' }, { role: 'conclusion' }, { role: 'thanks' }] };
  assert.deepStrictEqual(S.anchorsFromOutline(biz, 11), ['title', null, null, null, null, null, null, null, null, 'conclusion', 'thanks']);
});

test('slotKind: қысқа белгі / сөйлем / абзац', () => {
  assert.strictEqual(S.slotKind(22).kind, 'label');
  assert.strictEqual(S.slotKind(100).kind, 'sentence');
  assert.strictEqual(S.slotKind(400).kind, 'paragraph');
  assert.strictEqual(S.slotKind(400).max, 320);
});

test('planStoryline: дұрыс жауап → outline; қате/құлау → null (әдеттегі жолға көшеді)', async () => {
  const plan = [{ split: false, title: { max: 40 }, items: [80] }, { split: false, title: { max: 40 }, items: [22, 22, 22] }, { split: false, title: { max: 30 }, items: [] }];
  const good = async (sys, user) => {
    assert.match(user, /3 text slot\(s\): \[label ≤22, label ≤22, label ≤22\]/);
    assert.match(user, /FIXED ROLE: COVER/);
    return { title: 'Электр тогы', slides: [
      { index: 1, heading: 'Электр тогы', purpose: 'тақырыпты таныстыру', key_points: [] },
      { index: 2, heading: 'Тізбектің үш шамасы', purpose: 'негізгі шамалар', slot_plan: '3 labels = U, I, R', key_points: ['кернеу', 'ток', 'кедергі'] },
      { index: 3, heading: 'Рахмет!', purpose: '' },
    ] };
  };
  const o = await S.planStoryline({ topic: 'Электр тогы', plan, outline: { slides: [{ role: 'title' }, { role: 'content' }, { role: 'thanks' }] }, llm: good });
  assert.strictEqual(o.title, 'Электр тогы');
  assert.strictEqual(o.slideTopics.length, 3);
  assert.match(o.slideTopics[1], /Тізбектің үш шамасы — негізгі шамалар\. Key points: кернеу; ток; кедергі\. Slots: 3 labels/);
  assert.strictEqual(await S.planStoryline({ topic: 'x', plan, llm: async () => ({ slides: [{ index: 1, heading: 'a' }] }) }), null);
  assert.strictEqual(await S.planStoryline({ topic: 'x', plan, llm: async () => { throw new Error('down'); } }), null);
});

test('pipeline: шаблон режимінде құрылым storyline-нан, шаблон қаңқасы мен сөз шегі берілмейді', () => {
  const idx = fs.readFileSync(path.join(__dirname, '../products/presentation/index.js'), 'utf8');
  const gem = fs.readFileSync(path.join(__dirname, '../products/presentation/gemini.js'), 'utf8');
  assert.match(idx, /planStoryline\(\{/);
  assert.match(idx, /coverMeta, slotRules, outline: storyOutline/);
  assert.match(idx, /if \(mode === 'template'\) \{[\s\S]{0,400}refIt = refIt\.filter/);
  assert.match(idx, /refDna && mode !== 'template'/);
  assert.match(gem, /const pre = options\.outline/);
  assert.match(gem, /PROFESSIONAL WRITING/);
});
