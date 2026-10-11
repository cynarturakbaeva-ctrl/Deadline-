'use strict';
/**
 * Template → Content v2: рөлдік схема (templateSchema), слот жазушы (templateWriter), placeholder геометриясы.
 * Синтетикалық шаблон: әр слайдта мәзір (chrome), «FILM» таблеткасы, тақырып + сәндік жазу сөзі,
 * карточка (тақырыпша + мәтін), сан + түсіндірме, титулда «PRESENTATION BY / NAME».
 */
const test = require('node:test');
const assert = require('node:assert');
const { writeZipAll, readZipAll, fillTemplatePptx } = require('../products/presentation/templateFill');
const { analyzeTemplate, schemaRuleLine } = require('../products/presentation/templateSchema');
const { writeSlots, slotProblem, fitToLimit, caseLike } = require('../products/presentation/templateWriter');
const { materializePlaceholders } = require('../products/presentation/phGeometry');
const { coverCreditItems } = require('../products/presentation/gemini');

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const W = 12192000; const H = 6858000; const E = 12700;
let nid = 10;
const tb = (x, y, w, h, sz, face, txt, o = {}) => `<p:sp><p:nvSpPr><p:cNvPr id="${++nid}" name="TextBox ${nid}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x * E}" y="${y * E}"/><a:ext cx="${w * E}" cy="${h * E}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`
  + `<p:txBody><a:bodyPr lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/><a:p><a:pPr algn="${o.algn || 'l'}"/><a:r><a:rPr lang="en-US" sz="${sz * 100}"${o.b ? ' b="1"' : ''}><a:latin typeface="${face}"/></a:rPr><a:t>${txt}</a:t></a:r></a:p></p:txBody></p:sp>`;
const ellipse = (x, y, w, h) => `<p:sp><p:nvSpPr><p:cNvPr id="${++nid}" name="Ellipse ${nid}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x * E}" y="${y * E}"/><a:ext cx="${w * E}" cy="${h * E}"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:solidFill><a:srgbClr val="FFCC00"/></a:solidFill></a:ln></p:spPr></p:sp>`;
const chrome = () => tb(40, 20, 120, 16, 10, 'Inter', 'STELLAR STUDIO', { b: true }) + tb(200, 20, 60, 16, 10, 'Inter', 'Discover') + tb(280, 20, 60, 16, 10, 'Inter', 'Project');
const pill = () => ellipse(700, 120, 80, 30) + tb(708, 126, 64, 18, 14, 'Inter', 'FILM', { algn: 'ctr' });

function makePptx(bodies) {
  const files = new Map();
  files.set('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  files.set('ppt/presentation.xml', `<p:presentation ${NS}><p:sldIdLst>${bodies.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/></p:presentation>`);
  files.set('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${bodies.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`);
  bodies.forEach((b, i) => {
    files.set(`ppt/slides/slide${i + 1}.xml`, `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${b}</p:spTree></p:cSld></p:sld>`);
    files.set(`ppt/slides/_rels/slide${i + 1}.xml.rels`, '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  });
  return writeZipAll(files);
}

const cover = chrome() + tb(100, 160, 700, 90, 72, 'Inter', 'Film Cinema') + tb(100, 260, 600, 30, 20, 'Inter', 'CONTEMPORARY FILM PRODUCTION')
  + tb(40, 440, 160, 16, 10, 'Inter', 'PRESENTATION BY') + tb(40, 460, 160, 16, 10, 'Inter', 'MATTHEW COLLINS', { b: true });
const content = chrome() + pill() + tb(60, 80, 500, 70, 60, 'Inter', 'The Cinematic') + tb(250, 130, 400, 80, 80, 'Great Vibes', 'Manifesto')
  + tb(60, 300, 260, 22, 18, 'Inter', 'Kinetic Commercial', { b: true }) + tb(60, 326, 260, 60, 11, 'Inter', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore')
  + tb(600, 300, 100, 40, 32, 'Inter', '92%') + tb(600, 345, 100, 18, 12, 'Inter', 'ABOUT');
const content2 = chrome() + pill() + tb(60, 80, 500, 70, 60, 'Inter', 'Key Creative') + tb(60, 200, 600, 120, 14, 'Inter', 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.');
const tpl = () => makePptx([cover, content, content2]);

test('схема: chrome, таблетка (бүкіл презентацияға ортақ), тақырып/сәндік сөз, карточка, сан, авторлар', () => {
  const sc = analyzeTemplate(tpl());
  assert.deepStrictEqual(sc.deck.chrome.map((c) => c.orig), ['STELLAR STUDIO', 'Discover', 'Project']);
  assert.ok(sc.deck.tags.some((t) => t.orig === 'FILM' && t.count === 2));
  const s1 = sc.slides[0]; const s2 = sc.slides[1];
  assert.strictEqual(s1.kind, 'cover');
  const role = (s, orig) => { const x = s.slots.find((y) => y.orig === orig); return x && `${x.role}${x.part ? '.' + x.part : ''}`; };
  assert.strictEqual(role(s1, 'PRESENTATION BY'), 'credit.label');
  assert.strictEqual(role(s1, 'MATTHEW COLLINS'), 'credit.value');
  assert.strictEqual(role(s2, 'The Cinematic'), 'title');
  assert.strictEqual(role(s2, 'Manifesto'), 'accent', 'каллиграфиялық қаріп — сәндік сөз, тақырып емес (қаріпі ең үлкен болса да)');
  assert.strictEqual(role(s2, 'Kinetic Commercial'), 'card.heading');
  assert.strictEqual(role(s2, 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore'), 'card.body');
  assert.strictEqual(role(s2, '92%'), 'stat.value');
  assert.strictEqual(role(s2, 'ABOUT'), 'stat.label');
  assert.strictEqual(role(s2, 'FILM'), 'tag');
  assert.ok(s2.slots.find((x) => x.orig === 'FILM').deck);
  assert.match(schemaRuleLine(s2), /title ≤ \d+ chars \+ one decorative word/);
  assert.match(schemaRuleLine(s2), /"Heading: text"/);
});

// Тестік LLM: промпттағы әр слот кілтіне рөліне сай қазақша мәтін
function mockLlm({ failSlides = false, english = false } = {}) {
  const calls = [];
  const fn = async (sys, user, label) => {
    calls.push(label);
    if (label === 'template-deck') {
      const deck = {};
      for (const m of user.matchAll(/^\s*"((?:ch|tg)\d+)":/gm)) deck[m[1]] = m[1].startsWith('tg') ? 'КИНО' : { ch1: 'Кино тарихы', ch2: 'Кіріспе', ch3: 'Дәуірлер' }[m[1]] || 'Бөлім';
      return { deck };
    }
    if (failSlides && label === 'template-slots') throw new Error('Unexpected end of JSON input');
    const slides = [];
    let cur = null;
    for (const line of user.split('\n')) {
      const sm = line.match(/^Slide (\d+)/);
      if (sm) { cur = { index: +sm[1], slots: {} }; slides.push(cur); continue; }
      const km = line.match(/^\s*"([a-z]+\d*[a-z]?)":\s*(.*)$/);
      if (!cur || !km) continue;
      const desc = km[2];
      const v = /calligraphic/.test(desc) ? 'тарихы' : /main slide heading/.test(desc) ? 'Кино' : /card heading/.test(desc) ? 'Үнсіз кино' : /key figure/.test(desc) ? '1895' : /caption/.test(desc) ? 'Алғашқы сеанс'
        : /card text|text block/.test(desc) ? 'Люмьер ағайындылары 1895 жылы Парижде алғашқы ақылы кино көрсетілімін өткізді, бұл жаңа өнердің басы болды.' : 'Кино тілі';
      const max = +((desc.match(/(?:≤ |–)(\d+) characters/) || [])[1] || 999);
      const cut = (t) => { if (t.length <= max) return t; let o = ''; for (const w of t.split(' ')) { if ((o + ' ' + w).trim().length > max) break; o = (o + ' ' + w).trim(); } return o; };
      cur.slots[km[1]] = english && /main slide heading/.test(desc) ? 'The Cinematic' : cut(v);
    }
    return { slides };
  };
  fn.calls = calls;
  return fn;
}

const META = { performedBy: 'Нуркаев Мурзабек', checkedBy: 'Рамазанова Ханым', group: 'ВТиПО 25-1', university: 'Есенов университеті' };

test('слот жазушы: әр қорапқа өз мәтіні, мәзір бәрінде бірдей, авторлар өз орнында, шаблонның ағылшын сөзі қалмайды', async () => {
  const buf = tpl();
  const sc = analyzeTemplate(buf);
  const slides = [{ title: 'Кино тарихы' }, { title: 'Кино', bullets: ['Люмьер: 1895 жылы алғашқы сеанс'] }, { title: 'Дыбысты кино' }];
  const r = await writeSlots({ schema: sc, slides, topic: 'Кино тарихы', language: 'Kazakh', coverMeta: META, creditLines: coverCreditItems, llm: mockLlm() });
  assert.deepStrictEqual(r.report.problems, []);
  const out = fillTemplatePptx(buf, slides, { slotFill: r.plan, qa: false });
  const files = readZipAll(out);
  const texts = (n) => [...files.get(`ppt/slides/slide${n}.xml`).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
  for (const n of [1, 2, 3]) {
    const t = texts(n);
    for (const eng of ['STELLAR STUDIO', 'Discover', 'Project', 'FILM', 'Lorem', 'Manifesto', 'MATTHEW', 'PRESENTATION BY', 'ABOUT']) assert.ok(!t.some((x) => x.includes(eng)), `слайд ${n}: «${eng}» қалып қойды: ${JSON.stringify(t)}`);
  }
  // мәзір барлық слайдта бірдей (түпнұсқа БАС ӘРІППЕН болғандықтан — бас әріппен)
  for (const n of [1, 2, 3]) assert.ok(texts(n).includes('Кіріспе') && texts(n).includes('Дәуірлер'));
  assert.ok(texts(2).includes('КИНО') && texts(3).includes('КИНО'), 'таблетка сөзі бүкіл презентацияда бірдей');
  // титул: университет — жоғарғы брендте, орындаған + топ — «PRESENTATION BY» орнында
  const t1 = texts(1);
  assert.ok(t1.includes('ЕСЕНОВ УНИВЕРСИТЕТІ'), JSON.stringify(t1));
  assert.ok(t1.includes('ОРЫНДАҒАН') && t1.includes('НУРКАЕВ МУРЗАБЕК'), JSON.stringify(t1));
  assert.ok(t1.some((x) => /ТОП: ВТИПО 25-1/.test(x)));
  assert.ok(texts(2).includes('1895') && texts(2).includes('тарихы'));
});

test('слот жазушы: LLM құласа — слайдтар жеке сұралады, қайта жазу раунды толтырады; ағылшын мәтін түзетуге жіберіледі', async () => {
  const sc = analyzeTemplate(tpl());
  const slides = [{ title: 'Кино тарихы' }, { title: 'Кино' }, { title: 'Дыбысты кино' }];
  const llm = mockLlm({ failSlides: true });
  const r = await writeSlots({ schema: sc, slides, topic: 'Кино', language: 'Kazakh', llm });
  assert.ok(r.report.llmFailed >= 1);
  assert.ok(llm.calls.includes('template-slots-fix'));
  assert.deepStrictEqual(r.report.problems, []);
  const eng = mockLlm({ english: true });
  const r2 = await writeSlots({ schema: sc, slides, topic: 'Кино', language: 'Kazakh', llm: eng });
  assert.ok(eng.calls.includes('template-slots-fix'), 'ағылшынша тақырып қайта жазуға жіберілді');
  void r2;
});

test('slotProblem / fitToLimit / caseLike', () => {
  const s = { role: 'title', max: 20, orig: 'The Cinematic' };
  assert.strictEqual(slotProblem(s, '', 'Kazakh'), 'empty');
  assert.match(slotProblem(s, 'Өте ұзын тақырып мәтіні лимиттен асып кетеді', 'Kazakh'), /limit 20/);
  assert.strictEqual(slotProblem(s, 'The Cinematic', 'Kazakh'), 'left the English template text');
  assert.strictEqual(slotProblem({ role: 'stat', part: 'value', max: 6 }, 'Lorem', 'Kazakh'), 'a figure must contain a number');
  assert.strictEqual(slotProblem({ role: 'stat', part: 'value', max: 6 }, '1895', 'Kazakh'), null);
  // сөз ортасынан кеспейді, шылау сөзбен аяқталмайды
  assert.strictEqual(fitToLimit('Кино өнерінің дамуы және оның болашағы туралы', 20, 1), 'Кино өнерінің дамуы');
  assert.strictEqual(fitToLimit('Жаңашылдықтарымыздың', 5, 1), 'Жаңашылдықтарымыздың');
  assert.strictEqual(caseLike('STELLAR STUDIO', 'Кино тарихы', 'chrome'), 'КИНО ТАРИХЫ');
  assert.strictEqual(caseLike('Discover', 'Кіріспе', 'chrome'), 'Кіріспе');
});

test('placeholder: мұраланған орын мен кегль слайдқа жазылады (сыйғызу жұмыс істеуі үшін)', () => {
  const files = new Map();
  files.set('ppt/presentation.xml', `<p:presentation ${NS}><p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`);
  files.set('ppt/slides/_rels/slide1.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>');
  files.set('ppt/slideLayouts/slideLayout1.xml', `<p:sldLayout ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="T"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="3000" cy="400"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="4400"/></a:lvl1pPr></a:lstStyle><a:p/></p:txBody></p:sp></p:spTree></p:cSld></p:sldLayout>`);
  const slide = `<p:sld ${NS}><p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Тақырып</a:t></a:r></a:p></p:txBody></p:sp>`
    + `<p:sp><p:nvSpPr><p:cNvPr id="3" name="TB"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="10"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Мәтін</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const out = materializePlaceholders(files, 'ppt/slides/slide1.xml', slide);
  assert.match(out, /name="Title 1"[\s\S]*?<a:off x="100" y="200"\/><a:ext cx="3000" cy="400"\/>/);
  assert.match(out, /<a:rPr lang="kk-KZ" sz="4400"\/><a:t>Тақырып/);
  assert.match(out, /<a:rPr lang="kk-KZ" sz="1800"\/><a:t>Мәтін/);
});
