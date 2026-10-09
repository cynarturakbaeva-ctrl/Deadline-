'use strict';
/**
 * Template → Content: орналасу көмекшісі.
 *
 * Мәтін қорапқа сыймағанда бот енді тек қаріпті кішірейтіп/мәтінді қиып тастамайды:
 *   1) қорапты бос орынға қарай үлкейтеді (төмен / оңға);
 *   2) қорапқа кедергі жасаған шағын элементті (сурет, сызық, сәнді пішін) КІШКЕНЕ жылжытады;
 *   3) тек содан кейін қаріпті кішірейтеді, ең соңында ғана мәтінді қысқартады.
 *
 * Модуль таза (тек XML жолдарымен жұмыс істейді), PPTX-ті өзі оқымайды.
 */

const { xfrmOf } = require('../../design-dna/structure');

const GAP = 110000;            // ~0.12" көршіге дейінгі ара
const TOL = 20000;
const MARGIN_BOTTOM = 300000;  // слайд төменгі шетінен қалатын өріс
const MAX_SHIFT = 760000;      // кедергіні жылжытудың ең үлкен қашықтығы (~0.83")
const MAX_WIDEN = 0.4;         // қорап енін ең көбі +40% үлкейтеміз

const TOP_RE = /<(\/?)(p:sp|p:pic|p:grpSp|p:graphicFrame|p:cxnSp)(?=[\s>/])[^>]*?(\/?)>/g;

/** spTree-дің жоғарғы деңгейіндегі пішіндер (топ = бір элемент): [{ block, start, end, tag, box }] */
function topItems(xml) {
  const items = [];
  const s = String(xml || '');
  const from = s.indexOf('<p:spTree');
  if (from < 0) return items;
  const re = new RegExp(TOP_RE.source, 'g');
  re.lastIndex = from;
  let depth = 0, start = -1, tag = null, m;
  const push = (end) => {
    const block = s.slice(start, end);
    const box = xfrmOf(block);
    items.push({ block, start, end, tag, box });
  };
  while ((m = re.exec(s))) {
    const closing = m[1] === '/', self = m[3] === '/';
    if (!closing) {
      if (depth === 0) { start = m.index; tag = m[2]; }
      if (self) { if (depth === 0) push(m.index + m[0].length); } else depth++;
    } else {
      depth--;
      if (depth === 0) push(m.index + m[0].length);
      if (depth < 0) depth = 0;
    }
  }
  return items;
}

const sameBox = (a, b) => a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Фон / өте үлкен пішін — оған тимейміз және кедергі деп санамаймыз. */
function isBackdrop(b, W, H) {
  return !b || b.h > H * 0.85 || b.w * b.h > W * H * 0.5;
}

/** Бірінші <a:off> координатасын (dx, dy) қадамға жылжытады (топ үшін — бүкіл топ). */
function shiftBlock(block, dx, dy) {
  return block.replace(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/, (m, x, y) => `<a:off x="${+x + Math.round(dx)}" y="${+y + Math.round(dy)}"/>`);
}

/** Бірінші <a:ext> биіктігін/енін өзгертеді (тек үлкейтеді). */
function growBlock(block, { cy, cx }) {
  return block.replace(/(<a:ext cx=")(\d+)(" cy=")(\d+)(")/, (m, a, w, b, h, c) => {
    const nw = cx && cx > +w ? cx : +w;
    const nh = cy && cy > +h ? cy : +h;
    return a + nw + b + nh + c;
  });
}

const textOf = (block) => [...String(block).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('').replace(/\s+/g, ' ').trim();

/**
 * Суреттер: жоғарғы деңгейдегі p:pic / blipFill-ді пішін + слайд-көлеміндегі фон тобының (p:grpSp) ІШІНДЕГІ суреттер
 * (Canva-экспорт көбіне бүкіл слайдты бір топқа салады). Топ түрлендіруі (off/ext/chOff/chExt) ескеріледі.
 */
function picturesOf(items) {
  const isPic = (b) => /^<p:pic[\s>]/.test(b) || (/<a:blipFill/.test(b) && !textOf(b));
  const out = [];
  for (const it of items) {
    if (it.tag !== 'p:grpSp') { if (isPic(it.block)) out.push(it); continue; }
    if (!it.box) continue;
    const g = it.block.match(/<p:grpSpPr>\s*<a:xfrm[^>]*>\s*<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>\s*<a:chOff x="(-?\d+)" y="(-?\d+)"\/>\s*<a:chExt cx="(\d+)" cy="(\d+)"\/>/);
    const sx = g ? +g[3] / (+g[7] || 1) : 1, sy = g ? +g[4] / (+g[8] || 1) : 1;
    for (const m of it.block.matchAll(/<p:pic>[\s\S]*?<\/p:pic>|<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<a:blipFill(?:(?!<\/p:sp>)[\s\S])*?<\/p:sp>/g)) {
      const b = xfrmOf(m[0]);
      if (!b || textOf(m[0])) continue;
      const box = g ? { x: Math.round(+g[1] + (b.x - +g[5]) * sx), y: Math.round(+g[2] + (b.y - +g[6]) * sy), w: Math.round(b.w * sx), h: Math.round(b.h * sy) } : b;
      out.push({ tag: 'p:pic', block: m[0], box, sy });   // sy — топ масштабы (жылжытқанда бала координатасына аудару үшін)
    }
  }
  return out;
}

/**
 * Мәтін қорабының айналасындағы орын.
 *  room       — қораптың астындағы бос орын (EMU) көршіге/контейнер шетіне/слайд шетіне дейін (нұсқа: roomBelow-мен бірдей мағына)
 *  container  — мәтінді қоршап тұрған пішін (таблетка т.б.), бар болса
 *  blockers   — төменде тұрған, көлденең қиылысатын элементтер (жылжытылуы мүмкін), жоғарыдан төмен
 *  right      — оң жақта бос орын (EMU), қорапты кеңейту үшін
 */
function surround(xml, block, W, H, items, vExtra) {
  items = items || topItems(xml);
  const b = xfrmOf(block);
  if (!b) return { room: 0, container: null, blockers: [], right: 0, box: null };
  const bottom = b.y + b.h;
  let limit = H - 457200;
  let container = null;
  const blockers = [];
  let peerBelow = false;
  let peerLimit = Infinity;     // жылжытылмайтын мәтінді көршінің жоғарғы шеті: одан әрі өсуге болмайды
  for (const it of items) {
    const x = it.box;
    if (!x || sameBox(x, b) || it.block === block) continue;
    if (isBackdrop(x, W, H)) continue;
    const contains = x.x <= b.x + TOL && x.y <= b.y + TOL && x.x + x.w >= b.x + b.w - TOL && x.y + x.h >= b.y + b.h - TOL;
    if (contains) {
      if (!container || x.w * x.h < container.box.w * container.box.h) container = it;
      continue;
    }
    const ov = Math.min(b.x + b.w, x.x + x.w) - Math.max(b.x, x.x);
    if (ov < 0.25 * Math.min(b.w, x.w)) continue;
    if (x.y < b.y + b.h * 0.6) continue;
    limit = Math.min(limit, x.y - GAP);
    if (/<a:t>[^<]*\S[^<]*<\/a:t>/.test(it.block)) { peerBelow = true; peerLimit = Math.min(peerLimit, x.y - GAP); }
    // мәтіні бар көрші (тізімдегі қатарлас қораптар, дене мәтіні) — тең құқықты: оны жылжытпаймыз, тек шек болады
    if (/<a:t>[^<]*\S[^<]*<\/a:t>/.test(it.block)) continue;
    blockers.push(it);
  }
  if (container) limit = Math.min(limit, container.box.y + container.box.h - 60000);
  blockers.sort((p, q) => p.box.y - q.box.y);

  // оң жақтағы бос орын (көлденең кеңейту үшін): биіктікте қиылысатын ең жақын пішіннің сол шеті
  let rightLimit = W - 457200;
  for (const it of items) {
    const x = it.box;
    if (!x || sameBox(x, b) || it.block === block || isBackdrop(x, W, H)) continue;
    if (x.x + x.w <= b.x + b.w * 0.5) continue;                       // оң жақта емес
    if (x.x < b.x + b.w - TOL && x.x + x.w > b.x + b.w + TOL) {
      // қорапты көлденең кесіп өтетін немесе оның ішіндегі пішін — контейнер/кедергі
      const vOv = Math.min(b.y + b.h + (vExtra || 0), x.y + x.h) - Math.max(b.y, x.y);
      if (vOv > 0.1 * b.h && !(x.x <= b.x + TOL)) rightLimit = Math.min(rightLimit, x.x - GAP);
      continue;
    }
    if (x.x < b.x + b.w - TOL) continue;
    const vOv = Math.min(b.y + b.h + (vExtra || 0), x.y + x.h) - Math.max(b.y, x.y);
    if (vOv < 0.1 * Math.min(b.h, x.h)) continue;
    rightLimit = Math.min(rightLimit, x.x - GAP);
  }
  if (container) rightLimit = Math.min(rightLimit, container.box.x + container.box.w - 60000);
  // оң жақтан қораптың ішіне кіріп тұрған СУРЕТ: мәтін оған тимеуі үшін ені қысқарады (сәнді сызықтар есептелмейді)
  let rightCut = Infinity, rightCutTop = -Infinity, rightCutItem = null;
  for (const it of picturesOf(items)) {
    const x = it.box;
    if (!x || x.w * x.h > W * H * 0.5 || it.block === block) continue;   // бүкіл слайдты жабатын фон-сурет емес
    const vOv = Math.min(b.y + b.h, x.y + x.h) - Math.max(b.y, x.y);
    if (x.x > b.x + b.w * 0.35 && x.x < b.x + b.w - TOL && vOv > 0.2 * Math.min(b.h, x.h) && x.x - GAP < rightCut) { rightCut = x.x - GAP; rightCutTop = x.y; rightCutItem = it; }
  }
  const room = Math.max(0, limit - bottom);
  // кедергілер қай сызықтан төмен тұрады: контейнер болса — оның төменгі шеті, әйтпесе мәтіннің ең төменгі мүмкін шеті
  const baseBottom = container ? container.box.y + container.box.h : bottom + room;
  return { room, rightCut, rightCutTop, rightCutItem, container, blockers, baseBottom, noNudge: !!(container && peerBelow), peerLimit, right: Math.max(0, rightLimit - (b.x + b.w)), box: b };
}

/**
 * Кедергілерді төмен жылжыту арқылы қосымша қанша биіктік (EMU) алуға болады және қандай жылжытулар керек.
 * g — қажет қосымша өсім (room-нан ТЫС, яғни room толық пайдаланылғаннан кейін). Қайтарады { grow, moves:[{item, dy}] } — grow ≤ g (толық мүмкін болмаса, ең үлкені).
 */
function planNudge(sur, g, W, H) {
  if (!sur || !sur.box || sur.noNudge || g <= 0) return { grow: 0, moves: [] };
  const baseBottom = sur.baseBottom;
  const lastOk = H - 200000;
  const hOverlap = (p, q) => Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) > 0.25 * Math.min(p.w, q.w);
  const tryG = (gg) => {
    const moves = [];
    if (baseBottom + gg > H - 457200) return null;
    if (Number.isFinite(sur.peerLimit) && baseBottom + gg > sur.peerLimit) return null;      // слайд шетінен шықпаймыз
    const need = baseBottom + gg + GAP;                 // көршілер осы сызықтан төмен тұруы керек
    for (const it of sur.blockers) {
      const b = it.box;
      // бұрын жылжытылған көрші осы элементтің үстінде болса — одан да төмен түсіру керек
      let reach = need;
      for (const mv of moves) if (hOverlap(mv.item.box, b) && mv.item.box.y <= b.y) reach = Math.max(reach, mv.item.box.y + mv.dy + mv.item.box.h + GAP / 2);
      const dy = reach - b.y;
      if (dy <= 0) continue;
      if (dy > MAX_SHIFT || b.y > lastOk || b.y + dy > lastOk) return null;
      moves.push({ item: it, dy });
    }
    return moves;
  };
  for (let f = 1; f >= 0.2; f -= 0.1) {
    const gg = Math.round(g * f);
    const moves = tryG(gg);
    if (moves) return { grow: gg, moves };
  }
  return { grow: 0, moves: [] };
}

/** Қанша қосымша биіктік (EMU) жылжыту арқылы алуға болады: контейнер немесе жылжытылатын кедергі болмаса — 0 (room слайд шетіне дейін есептелген). */
function nudgeCapacity(sur, W, H) {
  if (!sur || !sur.box || sur.noNudge) return 0;
  if (!sur.container && !sur.blockers.length) return 0;
  const lastOk = H - 200000;
  let cap = Math.min(MAX_SHIFT, (H - 457200) - sur.baseBottom) - GAP;
  for (const it of sur.blockers) cap = Math.min(cap, lastOk - it.box.y - GAP);
  if (Number.isFinite(sur.peerLimit)) cap = Math.min(cap, sur.peerLimit - sur.baseBottom);   // мәтінді көршіге қосылып кетпейді
  // room-ның өзі кедергіге дейін есептелген: cap — room-нан ТЫС қосымша өсім
  return Math.max(0, cap);
}

/** Слайдтағы жылжытуға болатын мәтінсіз элементтер (сурет, пішін): тұрақты тәртіппен, id = 'o0','o1'… */
function othersOf(xml, W, H) {
  return topItems(xml)
    .filter((it) => it.box && !isBackdrop(it.box, W, H) && !textOf(it.block) && it.box.w * it.box.h > 0.002 * W * H)
    .map((it, i) => ({ id: 'o' + i, item: it }));
}

/** Пішін енін (ext cx) өзгертеді (кішірейтуге де болады). */
function setWidth(block, cx) {
  return block.replace(/(<a:ext cx=")(\d+)(")/, (m, a, v, c) => a + Math.round(cx) + c);
}

/** Пішін биіктігін (ext cy) орнатады (кішірейтуге де болады). */
function setHeight(block, cy) {
  return block.replace(/(<a:ext cx="\d+" cy=")(\d+)(")/, (m, a, v, c) => a + Math.round(cy) + c);
}

/** Кіші көмекші: контейнер төменгі шеті қорапты қамтуы үшін. */
function growContainerBlock(block, extra) {
  const b = xfrmOf(block);
  return b ? growBlock(block, { cy: b.h + extra }) : block;
}

module.exports = { picturesOf, setWidth, setHeight, othersOf, topItems, surround, planNudge, nudgeCapacity, shiftBlock, growBlock, growContainerBlock, isBackdrop, GAP, MAX_SHIFT, MAX_WIDEN };
