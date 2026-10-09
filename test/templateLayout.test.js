'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../products/presentation/templateLayout');
const T = require('../products/presentation/templateFill');
const { xfrmOf } = require('../design-dna/structure');

const W = 12192000, H = 6858000;
const sp = (id, x, y, w, h, txt) => `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="s${id}"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm></p:spPr>${txt ? `<p:txBody><a:bodyPr/><a:p><a:pPr algn="l"/><a:r><a:rPr sz="1400"/><a:t>${txt}</a:t></a:r></a:p></p:txBody>` : ''}</p:sp>`;
const pic = (id, x, y, w, h) => `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="p${id}"/></p:nvPicPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm></p:spPr></p:pic>`;
const slide = (...parts) => `<p:sld><p:cSld><p:spTree>${parts.join('')}</p:spTree></p:cSld></p:sld>`;

test('topItems: топ бір элемент, ішкі пішіндер санала бермейді', () => {
  const xml = slide(sp(1, 0, 0, 100, 100, 'a'), `<p:grpSp><p:grpSpPr><a:xfrm><a:off x="5" y="6"/><a:ext cx="7" cy="8"/></a:xfrm></p:grpSpPr>${sp(2, 1, 1, 1, 1)}${sp(3, 2, 2, 2, 2)}</p:grpSp>`, pic(4, 9, 9, 9, 9));
  const it = L.topItems(xml);
  assert.deepStrictEqual(it.map((i) => i.tag), ['p:sp', 'p:grpSp', 'p:pic']);
  assert.deepStrictEqual(it[1].box, { x: 5, y: 6, w: 7, h: 8 });
});

test('shiftBlock: тек өз координатасын жылжытады', () => {
  const b = L.shiftBlock(pic(1, 100, 200, 50, 50), 0, 300);
  assert.strictEqual(xfrmOf(b).y, 500);
  assert.strictEqual(xfrmOf(b).x, 100);
});

test('planNudge: төмендегі суретті жылжытады, шектен асса бас тартады', () => {
  const xml = slide(sp(1, 1000000, 1000000, 4000000, 800000, 'x'), pic(2, 1000000, 2000000, 2000000, 1500000));
  const txt = L.topItems(xml)[0].block;
  const sur = L.surround(xml, txt, W, H);
  assert.ok(sur.room > 0 && sur.room < 300000, 'room кедергіге дейін ғана');
  const plan = L.planNudge(sur, 400000, W, H);
  assert.strictEqual(plan.grow, 400000);
  assert.strictEqual(plan.moves.length, 1);
  assert.ok(plan.moves[0].dy > 0 && plan.moves[0].dy <= L.MAX_SHIFT);
  assert.strictEqual(L.planNudge(sur, 5000000, W, H).grow < 5000000, true);
});

test('fillSlide: ұзын мәтін кедергіні жылжытады, қаріп тым кішірейіп/мәтін қиылмайды', () => {
  const long = 'Электр тізбегіндегі негізгі шамалар кернеу, ток, кедергі, қуат, жиілік және сыйымдылық болып табылады. '.repeat(3).trim();
  const xml = slide(sp(1, 1000000, 800000, 4500000, 500000, 'Тақырып'), sp(2, 1000000, 1500000, 4500000, 700000, 'Lorem ipsum dolor sit amet consectetur'), pic(3, 1000000, 2500000, 2000000, 1200000));
  const out = T.fillSlide(xml, { title: 'Электр шамалары', bullets: [long] }, { W, H });
  assert.ok(out.includes(long), 'мәтін толық сақталды (қиылмады)');
  const items = L.topItems(out);
  const body = items.find((i) => /Электр тізбегіндегі/.test(i.block));
  const img = items.find((i) => i.tag === 'p:pic');
  assert.ok(img.box.y > 2500000, 'сурет төмен жылжытылды');
  assert.ok(body.box.y + body.box.h <= img.box.y, 'қорап суретке тимейді');
  const sz = +(body.block.match(/ sz="(\d+)"/) || [])[1];
  assert.ok(sz >= 1200, 'қаріп оқылатын өлшемде: ' + sz);
});

test('әріп аралығы (spc) өлшеуге кіреді: кең аралықты тақырып ерте тасымалданады', () => {
  const w0 = T.textWidthPt('БИЗНЕС', 100, false, false);
  const w1 = T.textWidthPt('БИЗНЕС', 100, false, false, 16);
  assert.ok(Math.abs(w1 - w0 - 6 * 16) < 0.01);
  assert.ok(T.countLines('Бизнес негіздері', 60, 600, true, false, 15) > T.countLines('Бизнес негіздері', 60, 600, true, false, 0));
});

test('fillSlide: оң жақтан қорапқа кіретін сурет — мәтін суретке тимейді', () => {
  // кең тақырып қорабы (16" ), оң жақта толық биік сурет 10.8"-дан басталады (Canva-дағыдай топ ішінде)
  const grp = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="9" name="g"/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${W}" cy="${H}"/><a:chOff x="0" y="0"/><a:chExt cx="${W}" cy="${H}"/></a:xfrm></p:grpSpPr>${pic(10, 7900000, 0, 4292000, H)}</p:grpSp>`;
  const title = `<p:sp><p:nvSpPr><p:cNvPr id="1" name="t"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="800000" y="900000"/><a:ext cx="10500000" cy="2600000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr algn="l"/><a:r><a:rPr sz="9000" spc="1500"/><a:t>BUSINESS PLAN</a:t></a:r></a:p></p:txBody></p:sp>`;
  const xml = slide(grp, title);
  const out = T.fillSlide(xml, { title: 'Бизнес негіздері: идеядан табысқа', bullets: [] }, { W, H });
  const t = L.topItems(out).find((i) => /Бизнес/.test(i.block));
  assert.ok(t.box.x + t.box.w <= 7900000, 'қорап суретке дейін тарылды');
  const sz = +(t.block.match(/ sz="(\d+)"/) || [])[1];
  const spc = +(t.block.match(/ spc="(\d+)"/) || [])[1];
  assert.ok(sz < 9000 && spc < 1500 && Math.abs(spc / sz - 1500 / 9000) < 0.01, 'әріп аралығы қаріппен бірге кішірейді');
});

test('fillSlide: сурет қораптың тек төменгі бөлігіне кірсе — мәтін оның ҮСТІНЕ сыйғызылады (тым кішірейіп кетпейді)', () => {
  const title = `<p:sp><p:nvSpPr><p:cNvPr id="1" name="t"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="800000" y="500000"/><a:ext cx="10000000" cy="3000000"/></a:xfrm></p:spPr><p:txBody><a:bodyPr/><a:p><a:pPr algn="l"/><a:r><a:rPr sz="8000"/><a:t>BUSINESS PLAN</a:t></a:r></a:p></p:txBody></p:sp>`;
  const gear = pic(11, 4500000, 2300000, 3000000, 3000000);   // тақырып қорабының төменгі-оң бөлігінде
  const out = T.fillSlide(slide(title, gear), { title: 'Бизнес негіздері идеядан табысқа', bullets: [] }, { W, H });
  const t = L.topItems(out).find((i) => /Бизнес/.test(i.block));
  const g = L.topItems(out).find((i) => i.tag === 'p:pic');
  const overlapX = t.box.x + t.box.w > g.box.x, overlapY = t.box.y + t.box.h > g.box.y;
  assert.ok(!(overlapX && overlapY), 'мәтін қорабы суретпен қиылыспайды');
  assert.ok(+(t.block.match(/ sz="(\d+)"/) || [])[1] >= 3000, 'тақырып оқылатын ірі өлшемде');
});
