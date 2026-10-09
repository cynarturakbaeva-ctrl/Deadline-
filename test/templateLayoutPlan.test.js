'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const P = require('../products/presentation/templateLayoutPlan');
const T = require('../products/presentation/templateFill');
const { orderedSlides, tagBlocks } = require('../design-dna/structure');

const sp = (id, x, y, w, h, sz, txt) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="s${id}"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:rPr sz="${sz}"/><a:t>${txt}</a:t></a:r></a:p></p:txBody></p:sp>`;
const pic = (id, x, y, w, h) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="p${id}"/></p:nvPicPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm></p:spPr></p:pic>`;
// «Electrical Properties» жағдайы: дене мәтіні тақырыптан ЖОҒАРЫ тұр
const XML = `<p:sld><p:cSld><p:spTree>${sp(1, 2000000, 3000000, 6000000, 2000000, 2300, 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Etiam vitae tellus risus. Sed fringilla commodo tellus, rutrum lacinia dui scelerisque in. Vestibulum velit velit, condimentum quis ante pretium.')}${sp(2, 8000000, 3500000, 4000000, 1500000, 6800, 'Electrical Properties')}${pic(3, 2000000, 5600000, 1500000, 1000000)}</p:spTree></p:cSld></p:sld>`;
const W = 12192000, H = 6858000;
const SLIDE = { title: 'Электрлік қасиеттер', subtitle: 'Өткізгіштік, кедергі, сыйымдылық және басқа шамалар материалдың табиғатына байланысты' };

test('describeSlide: геометрия мен рөл-үміткер беріледі', () => {
  const d = P.describeSlide(XML, W, H);
  assert.strictEqual(d.skip, false);
  assert.strictEqual(d.shapes.length, 2);
  assert.strictEqual(d.shapes[0].fontPt, 68, 'ең ірі қарпі бар қорап — 0-id');
  assert.strictEqual(d.others[0].kind, 'picture');
});

test('validatePlan: мәтін толық болса қабылдайды; жоғалса/ойдан қосылса қабылдамайды', () => {
  const d = P.describeSlide(XML, W, H);
  const ok = P.validatePlan({ assign: [{ id: 0, lines: [SLIDE.title] }, { id: 1, lines: [SLIDE.subtitle], fontPt: 18 }] }, SLIDE, d);
  assert.ok(ok);
  assert.strictEqual(ok.assign[1].fontPt, 18);
  assert.strictEqual(P.validatePlan({ assign: [{ id: 0, lines: [SLIDE.title] }, { id: 1, lines: ['Өткізгіштік'] }] }, SLIDE, d), null, 'мәтін жоғалды');
  assert.strictEqual(P.validatePlan({ assign: [{ id: 0, lines: [SLIDE.title + ' мүлде басқа ойдан шығарылған ұзын сөйлем қосылды'] }, { id: 1, lines: [SLIDE.subtitle] }] }, SLIDE, d), null, 'ойдан қосылды');
  assert.strictEqual(P.validatePlan({ assign: [{ id: 5, lines: ['x'] }] }, SLIDE, d), null, 'жарамсыз id');
});

test('validatePlan: ұзын мәтін қысқа (белгі) қорабына салынса — жоспар қабылданбайды', () => {
  const d = P.describeSlide(XML, W, H);
  const longT = 'Электрлік қасиеттер — материалдың электр тогын өткізу, кедергі көрсету және заряд жинау қабілеттерін сипаттайтын шамалар жиынтығы';
  assert.strictEqual(P.validatePlan({ assign: [{ id: 0, lines: [longT] }, { id: 1, lines: [SLIDE.title, SLIDE.subtitle] }] }, { title: longT, subtitle: SLIDE.title + ' ' + SLIDE.subtitle }, d), null);
});

test('validatePlan: fontPt және move шектеледі', () => {
  const d = P.describeSlide(XML, W, H);
  const v = P.validatePlan({ assign: [{ id: 0, lines: [SLIDE.title], fontPt: 500 }, { id: 1, lines: [SLIDE.subtitle] }], move: [{ id: 'o0', dx: 0, dy: 9 }, { id: 'zzz', dy: 1 }] }, SLIDE, d);
  assert.ok(v.assign[0].fontPt <= 68 * 1.3 + 0.01);
  assert.strictEqual(v.move.length, 1);
  assert.strictEqual(v.move[0].dy, Math.round(0.8 * 914400));
});

test('planLayout + fillSlide: LLM рөлді түзетеді, сурет жылжиды', async () => {
  const llm = async (sys, user) => {
    assert.match(user, /CONTENT TO PLACE/);
    return { slides: [{ index: 1, assign: [{ id: 0, lines: [SLIDE.title] }, { id: 1, lines: [SLIDE.subtitle], fontPt: 20 }], move: [{ id: 'o0', dx: 0, dy: 0.3 }] }] };
  };
  const desc = { W, H, slideIn: { w: 13.3, h: 7.5 }, slides: [P.describeSlide(XML, W, H)] };
  const [plan] = await P.planLayout({ slides: [SLIDE], llm, desc, topic: 't', language: 'kk' });
  assert.ok(plan);
  const out = T.fillSlide(XML, SLIDE, { W, H, layoutPlan: plan });
  const blocks = tagBlocks(out, 'p:sp');
  const big = blocks.find((b) => /Электрлік қасиеттер/.test(b));
  assert.ok(/ sz="6\d{3}"/.test(big) || / sz="[4-6]\d{3}"/.test(big), 'тақырып ірі қорапқа түсті');
  assert.ok(/<a:off x="2000000" y="5874320"/.test(out), 'сурет 0.3" төмен жылжыды');
});

test('planLayout: LLM құласа/нашар жоспар берсе — null (детерминді жол)', async () => {
  const desc = { W, H, slideIn: { w: 13.3, h: 7.5 }, slides: [P.describeSlide(XML, W, H)] };
  const r1 = await P.planLayout({ slides: [SLIDE], llm: async () => { throw new Error('down'); }, desc });
  assert.deepStrictEqual(r1, [null]);
  const r2 = await P.planLayout({ slides: [SLIDE], llm: async () => ({ slides: [{ index: 1, assign: [{ id: 0, lines: ['жоқ'] }] }] }), desc });
  assert.deepStrictEqual(r2, [null]);
  // жоспарсыз да слайд толтырылады (рөл — ең ірі қарпі бойынша)
  const out = T.fillSlide(XML, SLIDE, { W, H });
  assert.ok(/Электрлік қасиеттер/.test(tagBlocks(out, 'p:sp').find((b) => / sz="[4-6]\d{3}"/.test(b))));
});

test('index.js: planLayout толтырудан бұрын шақырылады және fillTemplatePptx-ке беріледі', () => {
  const idx = fs.readFileSync(require('path').join(__dirname, '../products/presentation/index.js'), 'utf8');
  assert.ok(idx.indexOf('planLayout({') < idx.indexOf('fillTemplatePptx(referencePptxBuf'));
  assert.match(idx, /fillTemplatePptx\(referencePptxBuf, slides, \{ language, layout \}\)/);
});
