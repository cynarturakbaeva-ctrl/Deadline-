'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const R = require('../products/referat/index');

const SAMPLE = `МАЗМҰНЫ
КІРІСПЕ
1 Теориялық негіздер
1.1 Ұғымдар
1.2 Тарихы
2 Талдау
2.1 Қазіргі жағдай
2.2 Мәселелер
3 Ұсыныстар
3.1 Шешімдер
3.2 Болашағы
ҚОРЫТЫНДЫ
ПАЙДАЛАНЫЛҒАН ӘДЕБИЕТТЕР ТІЗІМІ
` + 'Зерттеудің өзектілігі мынада. Мақсаты — талдау. Міндеттері: анықтау, бағалау. '.repeat(30);

const para = 'Бұл бөлімде тақырыптың негізгі мәселелері қарастырылады және олардың маңызы ғылыми тұрғыдан түсіндіріледі. '.repeat(6).trim();

function mockLlm(calls) {
  return async (system, user, label) => {
    calls.push({ system, user, label });
    if (label === 'sample') {
      return {
        chapters: 3, subsections: 2,
        headings: { intro: 'КІРІСПЕ', conclusion: 'ҚОРЫТЫНДЫ', references: 'ПАЙДАЛАНЫЛҒАН ӘДЕБИЕТТЕР ТІЗІМІ' },
        intro_elements: ['өзектілігі', 'мақсаты', 'міндеттері'],
        style: 'Ресми ғылыми стиль, жақсыз сөйлемдер.',
        paragraph_chars: 650, citations: 'brackets_with_pages', citation_example: '[2, б. 15]',
        reference_example: 'Әбішев А. Экономика негіздері. – Алматы: Білім, 2015. – 240 б.',
        reference_count: 9, chapter_title_style: 'алдымен теория, сосын талдау, соңында ұсыныстар',
        requirements: ['әр тарау соңында қысқа қорытынды'],
      };
    }
    if (label === 'outline') {
      const ch = (n) => ({ title: 'Тарау ' + n, sections: [{ title: 'Бөлім А', focus: 'x' }, { title: 'Бөлім Б', focus: 'y' }] });
      return { title: 'Жаңа реферат', intro_focus: 'i', conclusion_focus: 'c', chapters: [ch(1), ch(2), ch(3)], references: Array.from({ length: 12 }, (_, i) => `Автор ${i}. Кітап. – Алматы: Баспа, 2010.`) };
    }
    return { paragraphs: [para, para] };
  };
}

test('үлгі реферат: терең талдау → құрылым, атаулар, стиль, әдебиет форматы қолданылады', async () => {
  const calls = [];
  const r = await R.generateReferat({ topic: 'Цифрлық экономика', pages: 12, language: 'kk', sample: SAMPLE, llm: mockLlm(calls) });
  assert.ok(fs.existsSync(r.docxPath));
  assert.strictEqual(calls[0].label, 'sample', 'алдымен үлгі талданады');
  const outline = calls.find((c) => c.label === 'outline');
  assert.match(outline.user, /exactly 3 main chapters, each with exactly 2 sub-sections/);
  assert.match(outline.user, /Әбішев А\. Экономика негіздері/, 'әдебиет форматы үлгіден');
  assert.match(outline.user, /exactly 9 references/);
  const write = calls.find((c) => c.label === 'write');
  assert.match(write.system, /өзектілігі, мақсаты, міндеттері/);
  assert.match(write.system, /\[2, б\. 15\]/);
  assert.match(write.user, /about 650 characters each/);
  // бөлім атаулары үлгідегідей
  const xml = require('child_process').execSync(`unzip -p "${r.docxPath}" word/document.xml`).toString();
  assert.match(xml, /ПАЙДАЛАНЫЛҒАН ӘДЕБИЕТТЕР ТІЗІМІ/);
  fs.unlinkSync(r.docxPath);
});

test('үлгісіз реферат бұрынғыдай: талдау шақырылмайды', async () => {
  const calls = [];
  const r = await R.generateReferat({ topic: 'Цифрлық экономика', pages: 8, language: 'kk', llm: mockLlm(calls) });
  assert.ok(!calls.some((c) => c.label === 'sample'));
  assert.ok(!/TEACHER-ACCEPTED SAMPLE/.test(calls.find((c) => c.label === 'write').system));
  fs.unlinkSync(r.docxPath);
});

test('үлгі талдауы құласа — реферат бәрібір жасалады', async () => {
  const base = mockLlm([]);
  const llm = async (s, u, label, n) => { if (label === 'sample') throw new Error('down'); return base(s, u, label, n); };
  const r = await R.generateReferat({ topic: 'Цифрлық экономика', pages: 8, language: 'kk', sample: SAMPLE, llm });
  assert.ok(fs.existsSync(r.docxPath));
  fs.unlinkSync(r.docxPath);
});

test('applyProfile: аз бетке көп бөлім сыймаса, азайтады', () => {
  const plan = R.planFor(6);
  R.applyProfile(plan, { chapters: 5, subs: 3, headings: {}, introElements: [], requirements: [], citations: 'brackets', refCount: 20 }, 6);
  assert.ok(plan.unitChars >= 1100);
  assert.ok(plan.refsCount <= 7);
});

test('UI + сервер: үлгі жүктеу реферат режимінде, sampleId генерацияға жіберіледі', () => {
  const html = fs.readFileSync(require('path').join(__dirname, '../webapp/index.html'), 'utf8');
  const js = fs.readFileSync(require('path').join(__dirname, '../webapp/app.js'), 'utf8');
  const srv = fs.readFileSync(require('path').join(__dirname, '../server.js'), 'utf8');
  assert.match(html, /referat-only hidden">[\s\S]*?id="sampleFile"/);
  assert.match(js, /sampleId: state\.mode === 'referat'/);
  assert.match(srv, /sample: job\.payload\.sampleText/);
});
