'use strict';
/**
 * Үйрену жүйесі: терең оқу (топ түрлендіруі, рөлдер, мәтін сақталмайды), талдау, сақтау (JSON).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeZipAll } = require('../products/presentation/templateFill');
const { readTemplate, scanChildren, fontClass } = require('../design-dna/learnReader');
const { aggregate, similar, topicWords, layoutFamilies } = require('../core/learning');

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const W = 12192000; const H = 6858000;

const textSp = (id, x, y, w, h, sz, face, txt, extra = '') => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="T${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`
  + `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`
  + `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr lang="kk-KZ" sz="${sz * 100}"${extra}><a:solidFill><a:srgbClr val="112233"/></a:solidFill><a:latin typeface="${face}"/></a:rPr><a:t>${txt}</a:t></a:r></a:p></p:txBody></p:sp>`;
// Canva-ға тән: custGeom (<a:lnTo>) + толтыру, масштабталған топ ішінде
const rectFree = (id, x, y, w, h, color) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="F${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>`
  + `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:custGeom><a:pathLst><a:path w="${w}" h="${h}"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="${w}" y="0"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>`
  + `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill></p:spPr></p:sp>`;

function makePptx(slideBodies) {
  const files = new Map();
  files.set('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  files.set('ppt/presentation.xml', `<p:presentation ${NS}><p:sldIdLst>${slideBodies.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${W}" cy="${H}"/></p:presentation>`);
  files.set('ppt/_rels/presentation.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slideBodies.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`);
  files.set('ppt/theme/theme1.xml', `<a:theme ${NS}><a:themeElements><a:clrScheme name="x"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="FF5500"/></a:accent1></a:clrScheme><a:fontScheme name="f"><a:majorFont><a:latin typeface="Lora"/></a:majorFont><a:minorFont><a:latin typeface="Inter"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`);
  slideBodies.forEach((body, i) => {
    files.set(`ppt/slides/slide${i + 1}.xml`, `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`);
    files.set(`ppt/slides/_rels/slide${i + 1}.xml.rels`, '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  });
  return writeZipAll(files);
}

// 1-слайд: толық экранды қараңғы фон (масштабталған топ ішінде), тақырып, 3 бірдей белгі, абзац
const SECRET = 'ҚұпияМәтінОсыЖерде';
const slide1 = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="G"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>`
  + `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${W}" cy="${H}"/><a:chOff x="0" y="0"/><a:chExt cx="${W / 4}" cy="${H / 4}"/></a:xfrm></p:grpSpPr>`
  + rectFree(3, 0, 0, W / 4, H / 4, '0A232F') + '</p:grpSp>'
  + textSp(4, 600000, 500000, 9000000, 1000000, 48, 'League Gothic', `${SECRET} тақырып`)
  + textSp(5, 600000, 2500000, 3000000, 500000, 20, 'Lora', 'Бірінші')
  + textSp(6, 4400000, 2500000, 3000000, 500000, 20, 'Lora', 'Екінші')
  + textSp(7, 8200000, 2500000, 3000000, 500000, 20, 'Lora', 'Үшінші')
  + textSp(8, 600000, 3500000, 10000000, 2000000, 16, 'Inter', 'Бұл ұзын абзац мәтіні онда он екіден көп сөз бар екенін тексеру үшін жазылған сөйлем және тағы бірнеше сөз');

test('scanChildren: ішкі топтар бір блок, <p:spPr>/<p:spTree> шатастырылмайды', () => {
  const kids = scanChildren(`<p:sp><p:spPr/></p:sp><p:grpSp><p:grpSpPr/><p:sp></p:sp><p:grpSp><p:sp></p:sp></p:grpSp></p:grpSp><p:pic></p:pic>`);
  assert.deepStrictEqual(kids.map((k) => k.tag), ['p:sp', 'p:grpSp', 'p:pic']);
});

test('fontClass', () => {
  assert.strictEqual(fontClass('League Gothic'), 'display');
  assert.strictEqual(fontClass('Lora'), 'serif');
  assert.strictEqual(fontClass('Great Vibes'), 'script');
  assert.strictEqual(fontClass('Inter'), 'sans');
});

test('readTemplate: топ түрлендіруі, фон, рөлдер, қайталану; шаблон мәтіні САҚТАЛМАЙДЫ', () => {
  const buf = makePptx([slide1]);
  const r = readTemplate(buf);
  assert.ok(!JSON.stringify(r).includes(SECRET), 'шаблон мәтіні нәтижеде жоқ');
  assert.ok(!JSON.stringify(r).includes('Бірінші'));
  const s = r.slides[0];
  // топ ішіндегі пішін (chExt = 1/4) бүкіл слайдты жабады → фон
  assert.deepStrictEqual([s.background.type, s.background.color], ['solid', '#0a232f']);
  const bg = s.elements.find((e) => e.kind === 'shape');
  assert.deepStrictEqual([bg.x, bg.y, bg.w, bg.h, bg.fullBleed], [0, 0, 1, 1, true]);
  assert.deepStrictEqual(s.textRoles, { title: 1, label: 3, body: 1 });
  const title = s.elements.find((e) => e.role === 'title');
  assert.strictEqual(title.text.font, 'League Gothic'); assert.strictEqual(title.text.fontClass, 'display');
  assert.strictEqual(title.text.sizePt, 48); assert.ok(title.text.chars > 10);
  assert.strictEqual(s.repeat.count, 3); assert.strictEqual(s.repeat.axis, 'row');
  assert.strictEqual(s.typography.hierarchy, 3);
  assert.ok(s.margins.left > 0.04 && s.margins.left < 0.06);
  assert.strictEqual(r.template.pairing.title, 'League Gothic');
  assert.strictEqual(r.fingerprint.length, 16);
  assert.strictEqual(r.slide.aspect, 1.778);
});

test('learning: тақырып сөздері, ұқсастық (сапасы ескеріледі), отбасылар, жиынтық', () => {
  assert.deepStrictEqual(topicWords('Жасанды интеллект және оның рөлі'), ['жасанды', 'интеллект', 'оның', 'рөлі']);
  const uses = [
    { fingerprint: 'a', topic: 'Жасанды интеллект', topicWords: ['жасанды', 'интеллект'], outcome: 'done', fit: { after: 2 }, rating: 2 },
    { fingerprint: 'b', topic: 'Жасанды интеллект медицинада', topicWords: ['жасанды', 'интеллект', 'медицинада'], outcome: 'done', fit: { after: 0 }, rating: 5 },
    { fingerprint: 'c', topic: 'Футбол тарихы', topicWords: ['футбол', 'тарихы'], outcome: 'done' },
  ];
  const sim = similar(uses, 'Жасанды интеллект тарихы');
  assert.strictEqual(sim[0].fingerprint, 'b');
  assert.strictEqual(sim.length, 3);
  const t1 = { fingerprint: 'a', data: readTemplate(makePptx([slide1])) };
  const t2 = { fingerprint: 'b', data: readTemplate(makePptx([slide1, slide1])) };
  const fam = layoutFamilies([t1, t2]);
  assert.strictEqual(fam[0].templates, 2, 'бір шаблон ішінде қайталанған слайд бір рет саналады');
  const a = aggregate([t1, t2], uses);
  assert.strictEqual(a.templates, 2); assert.strictEqual(a.uses, 3); assert.strictEqual(a.rated, 2); assert.strictEqual(a.avgRating, 3.5);
  assert.strictEqual(a.darkPct, 100);
});

test('JSON база: шаблон бір рет (uses+1), қолдану + баға байланысы, cleanup өшірмейді, setFeedback', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-learn-'));
  fs.mkdirSync(path.join(dir, 'storage'));
  fs.copyFileSync(path.join(__dirname, '../storage/jsonDb.js'), path.join(dir, 'storage/jsonDb.js'));
  const db = require(path.join(dir, 'storage/jsonDb.js'));
  await db.initDB();
  const read = readTemplate(makePptx([slide1]));
  assert.strictEqual((await db.saveLearnedTemplate(read)).isNew, true);
  assert.strictEqual((await db.saveLearnedTemplate(read)).isNew, false);
  await db.addLearnUse({ fingerprint: read.fingerprint, jobId: 'J1', topic: 'Тест', topicWords: ['тест'], outcome: 'done' });
  assert.strictEqual(await db.setFeedback('J1', 'U1', { comment: 'бағасыз пікір' }), null, 'пікір бағадан кейін');
  assert.deepStrictEqual(await db.setFeedback('J1', 'U1', { rating: 4 }), { jobId: 'J1', rating: 4, comment: '' });
  assert.deepStrictEqual(await db.setFeedback('J1', 'U1', { comment: 'Жақсы' }), { jobId: 'J1', rating: 4, comment: 'Жақсы' });
  await db.setFeedback('J1', 'U1', { rating: 9 });
  await db.cleanupOldJobs(-60000);
  const tpls = await db.listLearnedTemplates(10);
  assert.strictEqual(tpls.length, 1); assert.strictEqual(tpls[0].uses, 2);
  const uses = await db.listLearnUses(10);
  assert.strictEqual(uses.length, 1); assert.strictEqual(uses[0].rating, 5); assert.strictEqual(uses[0].comment, 'Жақсы');
});

test('registerUser: бұрын тіркелген адамға реферал белгісі жазылады (төлемегенге ғана)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-ref-'));
  fs.mkdirSync(path.join(dir, 'storage'));
  fs.copyFileSync(path.join(__dirname, '../storage/jsonDb.js'), path.join(dir, 'storage/jsonDb.js'));
  const db = require(path.join(dir, 'storage/jsonDb.js'));
  await db.initDB();
  await db.registerUser('100');            // алдымен сілтемесіз кірген
  await db.registerUser('100', '555');     // кейін сілтемемен
  assert.strictEqual((await db.getUser('100')).referredBy, '555');
  await db.registerUser('100', '777');     // қайта жазылмайды
  assert.strictEqual((await db.getUser('100')).referredBy, '555');
  await db.registerUser('200');
  await db.registerUser('200', '200');     // өзін өзі шақыра алмайды
  assert.strictEqual((await db.getUser('200')).referredBy, null);
});
