'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fillTemplatePptx, readZipAll, replaceShapeText, linesForSlide } = require('../products/presentation/templateFill');
const { analyzeReference } = require('../design-dna');

const buf = fs.readFileSync(path.join(__dirname, 'fixture-rich.pptx'));
const mkSlides = () => Array.from({ length: 10 }, (_, i) => ({
  title: 'Жаңа тақырып ' + (i + 1),
  subtitle: 'Субтитр ' + (i + 1),
  bullets: ['Бірінші ой', 'Екінші ой', 'Үшінші ой'],
}));

test('template fill: design is preserved, text is replaced', () => {
  const before = analyzeReference(buf);
  const out = fillTemplatePptx(buf, mkSlides());

  // ZIP құрылымы сақталған: theme, media бар
  const files = readZipAll(out);
  assert.ok([...files.keys()].some((k) => /^ppt\/theme\/theme\d+\.xml$/.test(k)), 'theme file сақталуы керек');

  const after = analyzeReference(out);
  assert.strictEqual(after.outline.slideCount, 10);
  // Дизайн DNA өзгермеуі керек
  assert.strictEqual(after.dna.palette.bg, before.dna.palette.bg);
  assert.strictEqual(after.dna.palette.accent, before.dna.palette.accent);
  assert.strictEqual(after.dna.fonts.heading, before.dna.fonts.heading);
  // Мәтін ауыстырылған (мәтіні бар слайдтарда)
  assert.strictEqual(after.outline.slides[0].title, 'Жаңа тақырып 1');
  assert.strictEqual(after.outline.slides[1].title, 'Жаңа тақырып 2');
  assert.strictEqual(after.outline.slides[2].title, 'Жаңа тақырып 3');
});

test('replaceShapeText keeps first paragraph formatting (rPr)', () => {
  const block = '<p:sp><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="kk-KZ" sz="2800"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:rPr><a:t>Ескі мәтін</a:t></a:r></a:p></p:txBody></p:sp>';
  const out = replaceShapeText(block, ['Жаңа жол 1', 'Жаңа жол 2']);
  assert.ok(out.includes('Жаңа жол 1'));
  assert.ok(out.includes('Жаңа жол 2'));
  assert.ok(!out.includes('Ескі мәтін'));
  assert.ok(out.includes('sz="2800"'), 'шрифт өлшемі сақталуы керек');
  assert.ok(out.includes('FF0000'), 'түс сақталуы керек');
});

test('linesForSlide flattens subtitle, bullets, body, stats', () => {
  const r = linesForSlide({ title: 'Т', subtitle: 'С', bullets: ['Б1', 'Б2'], body: '', stats: [{ label: 'Ж', value: '2024' }] });
  assert.strictEqual(r.title, 'Т');
  assert.deepStrictEqual(r.body, ['С', 'Б1', 'Б2', 'Ж: 2024']);
});

// ─── Template → Content: сыйғызу / логотип / «…» регрессиялары ────────────────────────────
const T = require('../products/presentation/templateFill');
const CTX = { W: 18288000, H: 10287000, badFonts: new Set() };            // 20" × 11.25"
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');
const szs = (xml) => [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]).filter((b) => /<a:t>[^<]+/.test(b))
  .map((b) => ({ t: [...b.matchAll(/<a:t>([^<]*)/g)].map((m) => m[1]).join(''), sz: +((b.match(/ sz="(\d+)"/) || [])[1] || 0) / 100 }));

test('logotype («L|ARANA G|ROUP»): ұзын сөзде бас әріп пен сөз БІРГЕ бірдей кішірейеді (пропорция сақталады)', () => {
  const out = T.fillSlide(fx('logotype-slide.xml'), { title: 'Ортағасырлық Англия', bullets: ['а', 'б'] }, CTX);
  const by = Object.fromEntries(szs(out).map((s) => [s.t, s.sz]));
  assert.ok(by['О'] && by['РТАҒАСЫРЛЫҚ'] && by['А'] && by['НГЛИЯ'], 'төрт бөлік те жазылған');
  assert.ok(by['О'] < 280 && by['О'] >= 280.84 * 0.45 - 0.5, 'әріп кішірейді, бірақ еденнен төмен емес: ' + by['О']);
  assert.ok(Math.abs(by['О'] / by['РТАҒАСЫРЛЫҚ'] - 280.84 / 81.05) < 0.4, 'әріп:сөз пропорциясы шаблондағыдай (≈3.46)');
  assert.ok(Math.abs(by['А'] / by['НГЛИЯ'] - 280.84 / 142.49) < 0.25, 'екінші жұп та (≈1.97)');
  assert.strictEqual(by['О'], by['А'], 'екі бас әріп бірдей өлшемде');
});

test('logotype: сөздің қалғаны сыятын болса масштаб өзгермейді (k=1)', () => {
  const out = T.fillSlide(fx('logotype-slide.xml'), { title: 'Ән Ор', bullets: ['а', 'б'] }, CTX);
  const by = Object.fromEntries(szs(out).map((s) => [s.t, s.sz]));
  assert.strictEqual(by['Ә'], 280.84);
});

test('logotype: сөз оң жақтағы мәтін/«таблеткаға» шықпайды', () => {
  const out = T.fillSlide(fx('logotype-slide.xml'), { title: 'Қорытынды: Сарай', bullets: ['а', 'б'] }, CTX);
  const blk = [...out.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]).find((b) => /<a:t>АРАЙ<\/a:t>/.test(b));
  const x = blk.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  const rightIn = (+x[1] + +x[3]) / 914400;
  assert.ok(rightIn <= 12.4, 'АРАЙ қорабы оң жақтағы қораптан (x≈12.4") аспайды: ' + rightIn.toFixed(2));
  assert.match(blk, /<a:bodyPr[^>]* wrap="none"/);
});

test('logotype: кішірейген әріптің табаны слайд төменгі шетінен төмен түспейді', () => {
  const out = T.fillSlide(fx('logotype-slide.xml'), { title: 'Ортағасырлық Англия', bullets: ['а', 'б'] }, CTX);
  for (const b of [...out.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0])) {
    const t = [...b.matchAll(/<a:t>([^<]*)/g)].map((m) => m[1]).join('');
    if (t !== 'О' && t !== 'А') continue;
    const x = b.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    const ln = +b.match(/<a:lnSpc><a:spcPts val="(\d+)"/)[1] / 100;
    const baseline = +x[2] + 0.89 * ln * 12700;
    assert.ok(baseline <= CTX.H - 300000 + 2000, `"${t}" табаны слайд шетінен төмен: ${baseline}`);
  }
});

test('shortenLine: «…» қоймайды, мағыналық шекарада қияды', () => {
  const a = T.shortenLine('Тарихи деректер шектеулі, ал мифтер кең таралған және оларды түзету қиын');
  assert.ok(!/…|\.\.\./.test(a) && a.endsWith('.'), a);
  assert.ok(a.length < 60);
  const b = T.shortenLine('Бірнеше сөзден тұратын тоқтаусыз ұзын жолдың ортасында үтір мүлдем жоқ және ол өте ұзақ жалғасады');
  assert.ok(!/…|\.\.\./.test(b) && b.endsWith('.'), b);
});

test('ұзын мәтін «…» арқылы кесілмейді (бос орын пайдаланылады / кегль кішірейеді)', () => {
  const long = ['Тарихи деректер шектеулі, ал мифтер кең таралған және оларды түзету үшін көптеген зерттеулер қажет болады',
    'Жазба дереккөздері аз және біржақты — шіркеу мен король жаздырған, сондықтан қарапайым халықтың дауысы естілмейді',
    'Мифтер: «лас ортағасырлар» бейнесі шындықты бұрмалайды және оқулықтарда әлі де қайталанады'];
  const out = T.fillSlide(fx('text-slide.xml'), { title: 'Мәселе: деректер, мифтер және теңсіздік', bullets: long }, CTX);
  assert.ok(!/…/.test(out.replace(/<[^>]+>/g, '')), 'мәтінде «…» болмауы керек');
  for (const l of long) assert.ok(out.includes(l.slice(0, 40)), 'жол түсіп қалмаған: ' + l.slice(0, 30));
});

test('roomBelow: көршіге дейінгі бос орынды ғана береді (қабаттаспайды)', () => {
  const { tagBlocks, xfrmOf } = require('../design-dna/structure');
  const xml = fx('text-slide.xml');
  const boxes = tagBlocks(xml, 'p:sp').filter((b) => /<a:t>[^<]+/.test(b));
  for (const b of boxes) {
    const room = T.roomBelow(xml, b, CTX.W, CTX.H), me = xfrmOf(b);
    assert.ok(room >= 0 && me.y + me.h + room <= CTX.H, 'слайдтан шықпайды');
  }
});

test('РЕГРЕССИЯ: live pipeline шаблон қораптарының лимитін LLM-ге береді (v4 көшуінде жоғалған еді)', () => {
  const idx = fs.readFileSync(path.join(__dirname, '../products/presentation/index.js'), 'utf8');
  const gem = fs.readFileSync(path.join(__dirname, '../products/presentation/gemini.js'), 'utf8');
  assert.match(idx, /planTemplateSlots\(referencePptxBuf\)/);
  assert.strictEqual((idx.match(/coverMeta, slotRules/g) || []).length, 2, 'негізгі және тілді қайта жазу шақыруларының екеуіне де slotRules берілуі керек');
  assert.match(gem, /options\.slotRules/);
  assert.match(gem, /NEVER end a text item with/);
});

// ─── Түпнұсқамен салыстыру (History Project шаблоны): тақырып қатары, мәтін көлемі, қаріп ───────
const IN = 914400;
const RPR = (sz) => `<a:rPr lang="en-US" sz="${sz}"/>`;
const PPR = (ln) => `<a:pPr algn="l"><a:lnSpc><a:spcPts val="${ln}"/></a:lnSpc></a:pPr>`;

test('тақырып: «Еуропа 20 ғасыр» 3 қатарға емес, түпнұсқадағыдай 2 қатарға сыяды', () => {
  const lines = ['Еуропа 20 ғасыр'];
  const box = { w: 4.6 * IN, h: 4.6 * IN };
  const r = T.fitLines(lines, { box, pPr: PPR(12000), rPr: RPR(10000), serif: true, bold: false, origTexts: ['HISTORY PROJECT'] });
  const sz = r.sz / 100;
  const wPt = (4.6 * 72);
  assert.ok(T.countLines(r.lines[0], sz, wPt, true, false) <= 2, `қатар саны ≤ 2 (sz=${sz})`);
  assert.ok(sz >= 55, 'тақырып тым кішірейіп кетпеуі керек: ' + sz);
  // салыстыру: пікірсіз іздеуде 3 қатарға түсетін еді
  const free = T.fitLines(lines, { box, pPr: PPR(12000), rPr: RPR(10000), serif: true, bold: false });
  assert.ok(T.countLines(free.lines[0], free.sz / 100, wPt, true, false) >= 2);
});

test('мәтін қорабы: қысқа мәтін үлкен қорапта түпнұсқа кегліне қарағанда үлкейеді (≤1.5×), қорапты асырмайды', () => {
  const box = { w: 8 * IN, h: 3.5 * IN };
  const lore = ['Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nulla faucibus pretium nunc, ut accumsan leo tempus vel. '.repeat(3)];
  const r = T.fitLines(['20 ғасырдағы Еуропа: екі әлемдік соғыс, империялардың күйреуі және әлемдік көшбасшылықтан кету.'],
    { box, pPr: PPR(1900), rPr: RPR(1300), serif: false, bold: false, origTexts: lore });
  assert.ok(r.sz > 1300 && r.sz <= 1950, 'өсті, бірақ 1.5×-тен аспайды: ' + r.sz);
  assert.ok(r.usedH <= (3.5 * 72) * 0.85, 'қорап 85%-дан артық толмайды');
});

test('мәтін қорабы: толы мәтін кішірейіп сыяды (өспейді)', () => {
  const box = { w: 8 * IN, h: 1.2 * IN };
  const long = ['Өте ұзын мәтін '.repeat(40)];
  const r = T.fitLines(long, { box, pPr: PPR(1900), rPr: RPR(1300), serif: false, bold: false, origTexts: ['x'.repeat(300)] });
  assert.ok(r.sz <= 1300);
});

test('қаріп ауыстыру: sans → Arial, serif/кескінді (≥30pt) → Times New Roman', () => {
  assert.strictEqual(T.fallbackFace('Work Sans', 14), 'Arial');
  assert.strictEqual(T.fallbackFace('Canva Sans', 12), 'Arial');
  assert.strictEqual(T.fallbackFace('Playfair Display', 14), 'Times New Roman');
  assert.strictEqual(T.fallbackFace('Le Jour Serif', 14), 'Times New Roman');
  assert.strictEqual(T.fallbackFace('Work Sans', 60), 'Times New Roman');
});

test('minItemChars: үлкен қорапқа нақты абзац керек, шағын қорапқа жеңіл', () => {
  assert.strictEqual(T.minItemChars(400), 160);
  assert.strictEqual(T.minItemChars(100), 25);
  assert.strictEqual(T.minItemChars(40), 0);
});
