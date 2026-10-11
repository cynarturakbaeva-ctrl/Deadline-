'use strict';
/**
 * Соңғы геометриялық тексеруші: мәтін ↔ таблетка/мәтін қабаттасуы, әдейі қабаттасу сақталады,
 * сөз ортасынан кесілмейді, мөлдір безендіру кедергі емес.
 */
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { checkSlide, hideDeco, glyphRect, readText } = require('../products/presentation/templateCheck');
const { opaqueRatio } = require('../products/presentation/pngAlpha');
const { shortenLine } = require('../products/presentation/templateFill');

const W = 18288000; const H = 10287000; const E = 12700;
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const sld = (body) => `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${body}</p:spTree></p:cSld></p:sld>`;
const text = (name, x, y, w, h, sz, t, ln) => `<p:sp><p:nvSpPr><p:cNvPr id="9" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x * E}" y="${y * E}"/><a:ext cx="${w * E}" cy="${h * E}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>`
  + `<p:txBody><a:bodyPr anchor="t" lIns="0" tIns="0" rIns="0" bIns="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="l">${ln ? `<a:lnSpc><a:spcPts val="${ln * 100}"/></a:lnSpc>` : ''}</a:pPr><a:r><a:rPr lang="kk-KZ" sz="${sz * 100}"><a:latin typeface="Times New Roman"/></a:rPr><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`;
// «таблетка»: рамкалы пішін тобы + ішіндегі мәтін
const pill = (x, y, w, h, label) => `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="20" name="Pill"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="${x * E}" y="${y * E}"/><a:ext cx="${w * E}" cy="${h * E}"/><a:chOff x="0" y="0"/><a:chExt cx="${w * E}" cy="${h * E}"/></a:xfrm></p:grpSpPr>`
  + `<p:sp><p:nvSpPr><p:cNvPr id="21" name="R"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w * E}" cy="${h * E}"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></p:spPr></p:sp></p:grpSp>`
  + text('PillText', x + 6, y + 6, w - 12, h - 12, 20, label);
const yOf = (xml, name) => +xml.match(new RegExp(`name="${name}"[\\s\\S]*?<a:off x="-?\\d+" y="(-?\\d+)"`))[1] / E;
const szOf = (xml, name) => +xml.match(new RegExp(`name="${name}"[\\s\\S]*?sz="(\\d+)"`))[1] / 100;

test('тақырып таблеткаға түсіп тұрса — төмен жылжиды (сөз кесілмейді, кегль сақталады)', () => {
  // 10-слайд (Өнер тарихы) жағдайы: тақырып қорабы y=193, таблеткалар y=237…287
  const body = text('Title', 76, 193, 579, 436, 60, 'Назарларыңызға рахмет!', 84) + pill(81, 237, 510, 50, 'Эстетикалық тәрбие');
  const orig = text('Title', 76, 193, 579, 436, 154, 'Thank you', 216) + pill(81, 237, 510, 50, 'Label');
  const r = checkSlide(sld(orig), sld(body), { W, H });
  assert.strictEqual(r.issues.length, 1);
  assert.strictEqual(r.issues[0].fixed, true);
  assert.match(r.issues[0].code, /holder_overlap|text_overlap/);
  const t = readText(r.xml.match(/<p:sp>(?:(?!<p:sp>)[\s\S])*?name="Title"[\s\S]*?<\/p:sp>/)[0]);
  const g = glyphRect(t);
  assert.ok(g.y >= 287 + 5, `тақырып таблеткадан төмен: ${g.y}`);
  assert.ok(r.xml.includes('Назарларыңызға рахмет!'), 'мәтін өзгермейді');
  assert.ok(yOf(r.xml, 'Title') > 193);
});

test('ақау жоқ слайд өзгермейді; шаблонда әуелден бар әдейі қабаттасу ақау емес', () => {
  const clean = sld(text('A', 50, 50, 600, 100, 40, 'Тақырып') + text('B', 50, 300, 600, 100, 20, 'Мәтін'));
  const r1 = checkSlide(clean, clean, { W, H });
  assert.deepStrictEqual(r1.issues, []);
  assert.strictEqual(r1.xml, clean);
  // үлкен «фондық сан» мен мәтін әуелден қабаттасқан (дизайн)
  const layered = sld(text('Big', 50, 50, 600, 300, 200, '01') + text('Over', 60, 120, 500, 60, 24, 'Кіріспе бөлімі'));
  const r2 = checkSlide(layered, layered, { W, H });
  assert.deepStrictEqual(r2.issues, []);
});

test('бір сөз қорап енінен кең болса (сөз ортасынан бөлінеді) — кегль кішірейеді', () => {
  const s = sld(text('T', 50, 50, 300, 200, 50, 'Жаңашылдықтарымыздың'));
  const r = checkSlide(s, s, { W, H });
  assert.strictEqual(r.issues[0].code, 'word_split');
  assert.strictEqual(r.issues[0].fixed, true);
  assert.ok(szOf(r.xml, 'T') < 50);
  assert.strictEqual(glyphRect(readText(r.xml.match(/<p:sp>[\s\S]*?<\/p:sp>/)[0])).broken, false);
});

test('shortenLine сөзді ешқашан ортасынан кеспейді', () => {
  let c = 'Назарларыңызға рахмет!';
  for (let i = 0; i < 6; i++) {
    const n = shortenLine(c);
    for (const w of n.replace(/[.!?,]/g, '').split(/\s+/)) assert.ok(['Назарларыңызға', 'рахмет'].includes(w), `үзік сөз: ${w}`);
    if (n === c) break;
    c = n;
  }
  assert.strictEqual(shortenLine('Жаңашылдықтарымыздың'), 'Жаңашылдықтарымыздың');
});

// ─── PNG мөлдірлігі және безендіруді жасыру ──────────────────────────────
function png(w, h, alphaAt) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw[y * (w * 4 + 1) + 1 + x * 4 + 3] = alphaAt(x, y);
  const chunk = (tag, data) => { const b = Buffer.alloc(12 + data.length); b.writeUInt32BE(data.length, 0); b.write(tag, 4, 'latin1'); data.copy(b, 8); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('opaqueRatio: мөлдір жарқыл ≈0, тұтас сурет ≈1', () => {
  assert.ok(opaqueRatio(png(20, 20, (x, y) => (x === 10 && y === 10 ? 255 : 0))) < 0.01);
  assert.strictEqual(opaqueRatio(png(10, 10, () => 255)), 1);
  assert.strictEqual(opaqueRatio(Buffer.from('not a png')), null);
});

test('hideDeco: мөлдір безендіру уақытша алынып, орнына дәл қайтарылады', () => {
  const deco = '<p:sp><p:nvSpPr><p:cNvPr id="5" name="Sparkle"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm><a:custGeom/><a:blipFill><a:blip r:embed="rId3"/></a:blipFill></p:spPr></p:sp>';
  const xml = sld(text('T', 50, 50, 300, 100, 30, 'Тақырып') + deco);
  const h = hideDeco(xml, new Set(['rId3']));
  assert.strictEqual(h.count, 1);
  assert.ok(!h.xml.includes('Sparkle'));
  assert.strictEqual(h.restore(h.xml), xml);
  assert.strictEqual(hideDeco(xml, new Set(['rId9'])).count, 0, 'басқа сурет жасырылмайды');
});
