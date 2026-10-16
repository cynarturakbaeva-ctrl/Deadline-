'use strict';
/**
 * LAYOUT ENGINE — one composition function per slide type.
 * Each returns { bg, fg, cls } (HTML strings). They reason about the 12-column grid
 * (tokens.GRID), content density and photo geometry — no per-slide magic coordinates.
 * Text that does not fit is handled later by the in-page QA (auto-fit / trim).
 *
 * Reveal order: every animated element carries class "rv" and style="--i:n".
 */
const { GRID, TYPE_SCALE } = require('./tokens');
const { fitSize, bodySize } = require('./typography');
const { splitLabelDetail, toNode, truncate, parseStatNumber } = require('./analyze');
const I = require('./imagery');
const IG = require('./infographics');
const { formatNum } = require('./systems/numbers');

const esc = (v) => (v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
const pad2 = (n) => String(n).padStart(2, '0');
const NUMERAL_HERO = [340, 290, 240, 200, 160, 128];
// Atmosphere (background layer only — no data-role, so the in-page QA never measures it)
const AURORA = '<div class="aurora" aria-hidden="true"><i class="a1"></i><i class="a2"></i><i class="a3"></i></div>';
const AURORA_SOFT = '<div class="aurora soft" aria-hidden="true"><i class="a1"></i><i class="a2"></i></div>';
const ghost = (cls, text) => '<div class="ghost ' + cls + '" aria-hidden="true">' + esc(text) + '</div>';
/** Share of a full bar for each stat: % values are absolute, other numbers relative to the largest one. */
function statShares(items) {
  const nums = items.map((s) => parseStatNumber(String(s.value)));
  const isPct = items.map((s) => /%/.test(String(s.value)));
  const max = Math.max(0, ...nums.filter((n, i) => n != null && isFinite(n) && !isPct[i]).map(Math.abs));
  return nums.map((n, i) => {
    if (n == null || !isFinite(n)) return null;
    if (isPct[i]) return n >= 0 && n <= 100 ? Math.max(0.04, n / 100) : null;
    return max > 0 ? Math.max(0.08, Math.abs(n) / max) : null;
  });
}

// ── shared building blocks ────────────────────────────────────────────────
const BASE_SYS = { id: 'aurora', num: 'pad', folio: { title: true, total: true, pad: true, cover: true }, cover: 'classic', closing: 'rows' };
function makeCtx(a, plan, palette, ts, deckTitle, sys) {
  const head = ts.display.split(',')[0];
  const serif = /Times|DisplayFace|serif/i.test(head);
  let i = 0;
  return {
    a, plan, palette, ts, deckTitle, serif, sys: sys || BASE_SYS,
    rv() { i += 1; return 'class="rv" style="--i:' + i + '"'; },
    rvAttr() { i += 1; return { cls: 'rv', style: '--i:' + i }; },
    kind: serif ? 'serif' : /Arial/i.test(head) ? 'arial' : 'sans',
  };
}
/** Дизайн жүйесі бойынша нөмір (01 / 1 / 1. / I / [01]) */
const num = (ctx, n) => formatNum((ctx.sys || BASE_SYS).num, n);

function el(ctx, tag, cls, inner, o = {}) {
  ctx._n = (ctx._n || 0) + 1;
  const role = o.role ? ' data-role="' + o.role + '"' : '';
  const style = 'style="--i:' + ctx._n + (o.style ? ';' + o.style : '') + '"';
  return '<' + tag + ' class="' + cls + ' rv"' + role + ' ' + style + '>' + inner + '</' + tag + '>';
}
function titleH1(ctx, text, o) {
  const role = o.role || 'title';
  const scale = o.scale || (role === 'display' ? TYPE_SCALE.display : TYPE_SCALE.title);
  const weight = role === 'display' ? ctx.ts.displayWeight : ctx.ts.titleWeight;
  const tracking = parseFloat(role === 'display' ? ctx.ts.displayTracking : ctx.ts.titleTracking);
  const fit = fitSize(text, { width: o.width, maxLines: o.maxLines || 3, scale, kind: ctx.kind, weight, tracking });
  return el(ctx, 'h1', 'title' + (role === 'display' ? ' t-display' : '') + (o.cls ? ' ' + o.cls : ''), titleWords(text, o.hl), {
    role: 'title', style: '--ts:' + fit.size + 'px;' + (o.style || ''),
  });
}

/**
 * Title → word spans (staggered reveal in the HTML) with the KEY phrase highlighted in the accent gradient.
 * Key phrase: the part after a colon/dash when it is short, otherwise the last word (never the whole long title).
 */
function keyRange(ws, text) {
  const m = String(text).match(/^(.{3,}?)\s*[:—–]\s+(\S.*)$/);
  if (m) {
    const tail = m[2].trim().split(/\s+/).length;
    if (tail <= 3 && tail < ws.length) return [ws.length - tail, ws.length];
  }
  if (ws.length === 1) return ws[0].length <= 14 ? [0, 1] : [1, 1];
  return [ws.length - 1, ws.length];
}
function titleWords(text, hl) {
  const ws = String(text == null ? '' : text).trim().split(/\s+/).filter(Boolean);
  if (!ws.length) return '';
  const [a, b] = hl ? keyRange(ws, text) : [ws.length, ws.length];
  return ws.map((w, k) => '<span class="w' + (k >= a && k < b ? ' hl' : '') + '" style="--w:' + Math.min(k, 12) + '">' + esc(w) + '</span>').join(' ');
}
const rule = (ctx, w) => el(ctx, 'div', 'rule', '', { style: 'width:' + (w || 56) + 'px' });
const kicker = (ctx, text) => (text ? el(ctx, 'div', 'kicker', esc(text), { role: 'kicker' }) : '');
const lead = (ctx, text, size, o = {}) => (text ? el(ctx, 'p', 'lead' + (o.cls ? ' ' + o.cls : ''), esc(text), { role: 'lead', style: '--ls:' + (size || TYPE_SCALE.lead) + 'px' + (o.maxw ? ';max-width:' + o.maxw + 'px' : '') }) : '');
const para = (ctx, text, size, o = {}) => (text ? el(ctx, 'p', 'para' + (o.cls ? ' ' + o.cls : ''), esc(text), { role: 'text', style: '--bs:' + size + 'px' + (o.maxw ? ';max-width:' + o.maxw + 'px' : '') }) : '');

/** Running title for the folio: the whole title, or its part before ':' / '—', else nothing (never a cut title). */
function runningTitle(title, max = 46) {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const head = t.split(/\s*[:—–]\s+|\s*:\s*/)[0].trim();
  return head.length >= 6 && head.length <= max ? head : '';
}
function folio(ctx) {
  const a = ctx.a;
  const f = (ctx.sys && ctx.sys.folio) || BASE_SYS.folio;
  if (a.index === 0 && f.cover === false) return '';
  const n = (v) => (f.pad === false ? String(v) : pad2(v));
  return '<div class="folio" data-role="folio"><span class="folio-l">' + (f.title === false ? '' : esc(runningTitle(ctx.deckTitle))) + '</span>' +
    '<span class="folio-r"><b>' + n(a.index + 1) + '</b>' + (f.total === false ? '' : '<span class="of"> / ' + n(a.total) + '</span>') + '</span></div>';
}
const sectionLabel = (ctx) => {
  const s = ctx.a.slideRef || {};
  return s.section || s.eyebrow || '';
};

/** Numbered list (rows separated by hairlines). Items may be "Label: detail". */
function listRows(ctx, items, o = {}) {
  const n = items.length;
  const big = n <= 3 && !o.compact;
  const L = o.labelSize || (o.large ? 40 : big ? 38 : n === 4 ? 34 : 30);
  const D = o.detailSize || (o.large ? 28 : big ? 28 : n === 4 ? 26 : 24);
  const rows = items.map((raw, k) => {
    const p = splitLabelDetail(raw);
    const hasDetail = !!p.detail;
    const lab = hasDetail ? p.label : p.label;
    return '<li class="row drop" data-role="row"><span class="row-n">' + num(ctx, k + 1) + '</span><div class="row-b">' +
      '<div class="row-l' + (hasDetail ? ' strong' : '') + '" style="--rl:' + L + 'px">' + esc(lab) + '</div>' +
      (hasDetail ? '<div class="row-d" style="--rd:' + D + 'px">' + esc(p.detail) + '</div>' : '') + '</div></li>';
  }).join('');
  return el(ctx, 'ol', 'rows', rows, { role: 'list', style: o.style || '' });
}

/** Short notes (accent left rule) for secondary bullets. */
function notes(ctx, items, size) {
  if (!items.length) return '';
  return el(ctx, 'ul', 'notes', items.map((b) => '<li class="drop" data-role="note" style="--bs:' + (size || TYPE_SCALE.small) + 'px">' + esc(b) + '</li>').join(''), { role: 'list' });
}

const cols = (from, to) => 'grid-column:' + from + '/' + (to + 1);

function photoBleed(ctx, side, spanCols) {
  const a = ctx.a;
  const w = GRID.marginX + GRID.span(spanCols);
  const pos = side === 'left' ? 'left:0' : 'right:0';
  return '<div class="bleed" data-role="photo" data-bleed="1" style="' + pos + ';width:' + Math.round(w) + 'px">' +
    I.imgTag(a.photo, a.img, ctx.palette, { focus: a.focus }) + '</div>';
}

// ── Layouts ───────────────────────────────────────────────────────────────
const L = {};

/** Мұқабаның ортақ бөліктері: титул деректері (факультет, орындаған…), ұйым атауы, лид */
function coverParts(ctx, metaMax) {
  const a = ctx.a;
  const meta = a.bullets.map(splitLabelDetail);
  // Титул деректері: «Кілт: мән» жолдары (факультет, кафедра, орындаған, тексерген, топ) + кілтсіз ұйым атауы (университет).
  // Барлығы көрсетіледі (бұрын 3–4-ке қиылатын), 3-тен көп болса — ықшам тор.
  const keyed = meta.filter((m) => m.detail);
  const plain = meta.filter((m) => !m.detail).map((m) => m.label);
  const labeled = keyed.length > 0 && plain.length <= 2;
  const org = labeled && plain.length
    ? el(ctx, 'div', 'cover-org', esc(plain.join(' · ')), { role: 'meta' })
    : '';
  const dense = labeled && keyed.length > (metaMax || 3);
  const metaHtml = meta.length
    ? el(ctx, 'div', 'meta-row' + (dense ? ' is-dense' : ''), (labeled
      ? keyed.slice(0, 6).map((m) => '<div class="meta-i" data-role="meta"><span class="meta-k">' + esc(m.label) + '</span><span class="meta-v">' + esc(m.detail) + '</span></div>').join('')
      : '<div class="meta-i" data-role="meta"><span class="meta-v">' + esc(a.bullets.slice(0, 3).join('  ·  ')) + '</span></div>'), { role: 'meta-row' })
    : '';
  return { org, metaHtml, labeled };
}

L.cover = (ctx) => {
  const v = (ctx.sys && ctx.sys.cover) || 'classic';
  if (!(ctx.plan && ctx.plan.refCover) && COVER[v]) return COVER[v](ctx);
  return COVER.classic(ctx);
};

const COVER = {};
/** Классикалық: үлкен тақырып төменгі сол жақта, фото бүкіл фонда (аврора, техно) */
COVER.classic = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const rc = ctx.plan && ctx.plan.refCover;
  const bleedOK = !rc && a.hasPhoto && I.bleedOK(a.img, 1920, a.imgAI);
  let bg = '<div class="plate plate-cover"></div>' + AURORA + '<div class="halo" aria-hidden="true"><i></i></div>';
  let fgCls = 'cover-plain';
  if (rc) {
    bg += '<div class="ref-cover-photo' + (rc.shape === 'circle' ? ' is-circle' : '') + '" style="left:' + rc.x + 'px;top:' + rc.y + 'px;width:' + rc.w + 'px;height:' + rc.h + 'px">' + I.imgTag(a.photo, a.img, p, { focus: a.focus }) + '</div>';
  }
  if (a.hasPhoto && bleedOK) {
    bg = '<div class="full">' + I.imgTag(a.photo, a.img, p, { focus: a.focus }) + '</div>' +
      '<div class="scrim" style="background:' + I.scrim('left', p) + '"></div>' +
      '<div class="scrim" style="background:' + I.scrim('bottom', p) + '"></div>' + AURORA_SOFT;
    fgCls = 'cover-photo';
  }
  const w = GRID.span(10);
  const { org, metaHtml, labeled } = coverParts(ctx);
  const fg = '<div class="canvas cover">' +
    '<div class="cover-top">' + (sectionLabel(ctx) ? rule(ctx, 56) + kicker(ctx, sectionLabel(ctx)) : '') + org + '</div>' +
    '<div class="block cover-block">' +
      titleH1(ctx, a.title, { role: 'display', width: w, maxLines: 3, hl: true }) +
      lead(ctx, labeled ? '' : a.subtitle, 38, { maxw: GRID.span(7) }) +
      (a.body && !a.subtitle ? para(ctx, a.body, 28, { maxw: GRID.span(7) }) : '') +
      metaHtml +
    '</div></div>';
  return { bg, fg: fg + folio(ctx), cls: fgCls };
};

/** Ортаға тураланған: тақырып пен деректер ортада, фото бүкіл фонда біркелкі қараңғыланып (академия, ателье) */
COVER.center = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const bleedOK = a.hasPhoto && I.bleedOK(a.img, 1920, a.imgAI);
  // фото үстінде мәтін әрқашан ақ, фото қараңғыланады (ашық палитрада бұрын фото «ағарып» көрінбей қалатын)
  const bg = bleedOK
    ? '<div class="full">' + I.imgTag(a.photo, a.img, p, { focus: a.focus }) + '</div><div class="scrim" style="background:radial-gradient(120% 90% at 50% 50%,rgba(8,10,14,.48) 0%,rgba(8,10,14,.66) 100%)"></div>'
    : '<div class="plate plate-cover"></div>' + AURORA_SOFT;
  const w = GRID.span(10);
  const { org, metaHtml, labeled } = coverParts(ctx, 3);
  const fg = '<div class="canvas cover cover-c' + (bleedOK ? ' on-photo' : '') + '">' +
    '<div class="cover-top">' + org + '</div>' +
    '<div class="block cover-block">' +
      rule(ctx, 64) +
      titleH1(ctx, a.title, { role: 'display', width: w, maxLines: 3, cls: 'center', hl: true, scale: [128, 112, 98, 86, 76, 66] }) +
      lead(ctx, labeled ? '' : a.subtitle, 36, { maxw: GRID.span(8), cls: 'center' }) +
    '</div>' +
    '<div class="cover-foot">' + metaHtml + '</div></div>';
  return { bg, fg: fg + folio(ctx), cls: bleedOK ? 'cover-photo cover-center' : 'cover-plain cover-center' };
};

/** Панель: сол жақта түсті тұтас панель (тақырып ішінде), оң жақта фото (швейцар) */
COVER.panel = (ctx) => {
  const a = ctx.a;
  const panelW = Math.round(GRID.marginX + GRID.span(7) + GRID.gutter / 2);
  const photoOK = a.hasPhoto && I.sharpEnough(a.img, 1100);
  const bg = '<div class="plate plate-cover"></div>' +
    (photoOK ? photoBleed(ctx, 'right', 5) : '<div class="panel-pattern" aria-hidden="true"></div>') +
    '<div class="cover-panel" style="width:' + panelW + 'px"></div>';
  const w = GRID.span(6);
  const { org, metaHtml, labeled } = coverParts(ctx, 2);
  const fg = '<div class="canvas g12 cover-p">' +
    '<div class="cell on-accent cover-p-l" style="' + cols(1, 6) + '">' +
      '<div class="cover-top">' + org + '</div>' +
      '<div class="block">' +
        titleH1(ctx, a.title, { role: 'display', width: w, maxLines: 5, hl: true, scale: [112, 98, 86, 76, 66, 58] }) +
        lead(ctx, labeled ? '' : a.subtitle, 32, { maxw: w }) +
      '</div>' +
      metaHtml +
    '</div></div>';
  return { bg, fg: fg + folio(ctx), cls: 'cover-panel-slide' };
};

/** Доға мұқаба (heritage): сол жақта ірі тақырып, оң жақта доға пішінді фото + күн-шеңбер + түсті табан */
COVER.arch = (ctx) => {
  const a = ctx.a;
  const photoOK = a.hasPhoto && I.sharpEnough(a.img, 700);
  const bg = '<div class="plate plate-cover"></div>' +
    (photoOK
      ? '<div class="arch-line" aria-hidden="true"></div><div class="arch-photo" data-role="photo">' + I.imgTag(a.photo, a.img, ctx.palette, { focus: a.focus }) + '</div>'
      : '<div class="cover-frame" aria-hidden="true"></div>') +
    '<div class="orn orn-cover" aria-hidden="true"></div>';
  const w = GRID.span(photoOK ? 6 : 9);
  const { org, metaHtml, labeled } = coverParts(ctx, 2);
  const fg = '<div class="canvas cover cover-arch">' +
    '<div class="block cover-block" style="width:' + w + 'px">' +
      (org || kicker(ctx, sectionLabel(ctx))) +
      titleH1(ctx, a.title, { role: 'display', width: w, maxLines: 6, hl: true, scale: [112, 100, 90, 80, 72, 64] }) +
      lead(ctx, labeled ? '' : a.subtitle, 32, { maxw: w }) +
      metaHtml +
    '</div></div>';
  return { bg, fg: fg + folio(ctx), cls: 'cover-arch-slide' + (photoOK ? ' has-arch' : ' no-arch') };
};

/** Дудл мұқаба (campus): сол жақта тақырып, оң жақта тақырыпқа сай қолмен салынған иллюстрация (Open Doodles, CC0) */
COVER.doodle = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const D = require('./doodles');
  const uri = D.doodleUri(D.pickDoodle(ctx.deckTitle + ' ' + a.title), p.accent, p.text);
  const bg = '<div class="plate plate-cover"></div>' + (uri ? '<img class="doodle doodle-cover" alt="" src="' + uri + '">' : '');
  const w = GRID.span(7);
  const { org, metaHtml, labeled } = coverParts(ctx, 2);
  const fg = '<div class="canvas cover cover-doodle">' +
    '<div class="block cover-block" style="width:' + w + 'px">' +
      (org || kicker(ctx, sectionLabel(ctx))) +
      titleH1(ctx, a.title, { role: 'display', width: w, maxLines: 5, hl: true, scale: [112, 100, 90, 80, 72, 64] }) +
      lead(ctx, labeled ? '' : a.subtitle, 32, { maxw: w }) +
      metaHtml +
    '</div></div>';
  return { bg, fg: fg + folio(ctx), cls: 'cover-doodle-slide' };
};

/** Журнал мұқабасы: жоғарыда ұйым атауы + қос сызық, үлкен тақырып, оң жақта биік жақтаулы фото */
COVER.masthead = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const photoOK = a.hasPhoto && I.sharpEnough(a.img, 760);
  const bg = '<div class="plate plate-cover"></div>';
  const tw = photoOK ? GRID.span(7) : GRID.span(11);
  const { org, metaHtml, labeled } = coverParts(ctx, photoOK ? 2 : 3);
  const photo = photoOK
    ? '<div class="cell mast-photo" style="' + cols(9, 12) + '">' + I.framedPhoto(a.photo, a.img, p, { fill: true, focus: a.focus }) + '</div>'
    : '';
  const fg = '<div class="canvas g12 cover-m">' +
    '<div class="cell mast-l" style="' + cols(1, photoOK ? 7 : 12) + '">' +
      '<div class="mast-top">' + (org || '<div class="cover-org">&nbsp;</div>') + '</div>' +
      '<div class="block">' +
        titleH1(ctx, a.title, { role: 'display', width: tw, maxLines: 4, hl: true, scale: [124, 108, 94, 82, 72, 62] }) +
        lead(ctx, labeled ? '' : a.subtitle, 34, { maxw: tw }) +
      '</div>' +
      metaHtml +
    '</div>' + photo + '</div>';
  return { bg, fg: fg + folio(ctx), cls: 'cover-mast' };
};

L.section = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const sn = ctx.plan.section || a.index;
  const numTxt = ['roman', 'plain', 'dot'].includes(ctx.sys.num) ? formatNum(ctx.sys.num === 'dot' ? 'plain' : ctx.sys.num, sn) : pad2(sn);
  const hasP = a.hasPhoto && I.sharpEnough(a.img, 900);
  const bg = '<div class="plate plate-section"></div>' + AURORA_SOFT + (hasP ? photoBleed(ctx, 'right', 5) : ghost('ghost-num', numTxt));
  const textW = hasP ? GRID.span(6) : GRID.span(9);
  const fg = '<div class="canvas sect">' +
    el(ctx, 'div', 'numeral-xl', numTxt, { role: 'numeral' }) +
    '<div class="block sect-block">' + rule(ctx, 56) +
      titleH1(ctx, a.title, { role: 'display', width: textW, maxLines: 3, scale: [120, 104, 92, 80, 68], hl: true }) +
      lead(ctx, a.subtitle || a.body, 34, { maxw: textW }) +
    '</div></div>';
  return { bg, fg, cls: 'sect-slide' };
};

L.statement = (ctx) => {
  const a = ctx.a;
  const w = GRID.span(9);
  const long = a.title.length > 70;
  const support = a.subtitle || a.body;
  const fg = '<div class="canvas stmt"><div class="block stmt-block">' +
    kicker(ctx, sectionLabel(ctx)) +
    titleH1(ctx, a.title, { role: long ? 'title' : 'display', width: w, maxLines: long ? 4 : 3, scale: long ? [92, 80, 70, 62] : [128, 112, 98, 86, 76], hl: true }) +
    (support ? rule(ctx, 56) : '') +
    (a.subtitle ? lead(ctx, a.subtitle, 38, { maxw: GRID.span(7) }) : '') +
    (a.body ? para(ctx, a.body, bodySize(a.bodyWords), { maxw: GRID.span(7) }) : '') +
    '</div></div>';
  return { bg: '<div class="plate"></div>' + AURORA_SOFT, fg: fg + folio(ctx), cls: 'stmt-slide' };
};

L.split = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const flip = ctx.plan.flip;
  const land = a.img.orientation === 'landscape' || a.img.orientation === 'unknown';
  const imgCols = land ? 6 : 5;
  const txtCols = 12 - imgCols - 1;
  const imgRange = flip ? [13 - imgCols, 12] : [1, imgCols];
  const txtRange = flip ? [1, txtCols] : [imgCols + 2, 12];
  const tw = GRID.span(txtCols);
  const photo = I.framedPhoto(a.photo, a.img, p, { fill: !land, focus: a.focus, ratio: land ? '4 / 3' : undefined, style: land ? 'align-self:center' : '' });
  const hasBul = a.bullets.length > 0;
  const body = a.body ? para(ctx, a.body, bodySize(a.bodyWords, { large: 30, normal: 28 }), { maxw: tw }) : '';
  const fg = '<div class="canvas g12 split">' +
    '<div class="cell photo-cell" style="' + cols(...imgRange) + '">' + photo + '</div>' +
    '<div class="cell text-cell" style="' + cols(...txtRange) + '"><div class="block">' +
      kicker(ctx, sectionLabel(ctx)) +
      titleH1(ctx, a.title, { width: tw, maxLines: 3, scale: [80, 70, 62, 54, 48] }) +
      (a.subtitle ? lead(ctx, a.subtitle, 32, { maxw: tw }) : '') +
      (body || hasBul ? rule(ctx, 48) : '') + body +
      (hasBul ? listRows(ctx, a.bullets.slice(0, 4), { compact: true, labelSize: 32, detailSize: 26 }) : '') +
    '</div></div></div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

L.fullImage = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const bg = '<div class="full">' + I.imgTag(a.photo, a.img, p, { focus: a.focus }) + '</div>' +
    '<div class="scrim" style="background:' + I.scrim('bottom', p) + '"></div>';
  const w = GRID.span(9);
  const fg = '<div class="canvas fimg"><div class="block fimg-block">' +
    rule(ctx, 56) +
    titleH1(ctx, a.title, { role: 'display', width: w, maxLines: 3, scale: [112, 98, 86, 74, 64], hl: true }) +
    (a.subtitle ? lead(ctx, a.subtitle, 34, { maxw: GRID.span(7) }) : '') +
    '</div></div>';
  return { bg, fg: fg + folio(ctx), cls: 'fimg-slide' };
};

/** Тақырып жоғарыда, мазмұн астында (референс осылай құрылған болса) */
L.stackPoints = (ctx) => {
  const a = ctx.a;
  const items = a.bullets.slice(0, 6);
  const n = items.length;
  const tw = GRID.span(11);
  const fg = '<div class="canvas stack"><div class="block stack-head">' +
    kicker(ctx, sectionLabel(ctx)) +
    titleH1(ctx, a.title, { width: tw, maxLines: 2, scale: [84, 74, 66, 58, 52] }) +
    (a.subtitle ? lead(ctx, a.subtitle, 32, { maxw: GRID.span(9) }) : '') +
    '</div><div class="stack-body">' +
      (a.body ? para(ctx, a.body, bodySize(a.bodyWords, { large: 32, normal: 30 }), { maxw: GRID.span(10) }) : '') +
      (n ? listRows(ctx, items, { compact: a.longestBullet > 110 || n > 4, style: n > 3 ? 'column-count:2;column-gap:' + GRID.gutter * 2 + 'px' : '' }) : '') +
    '</div></div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

L.stackRefs = (ctx) => {
  const a = ctx.a;
  const lines = (a.bullets.length ? a.bullets : String(a.body || '').split(/\n+/)).filter(Boolean).slice(0, 14);
  const fg = '<div class="canvas stack"><div class="block stack-head">' +
    titleH1(ctx, a.title, { width: GRID.span(11), maxLines: 2, scale: [84, 74, 66, 58, 52] }) +
    '</div><div class="stack-body">' + el(ctx, 'ol', 'refs-list' + (lines.length > 6 ? ' two' : ''),
      lines.map((t, i) => '<li class="drop" data-role="ref" style="--bs:' + (lines.length > 8 ? 22 : 24) + 'px"><span class="ref-n">' + (i + 1) + '</span><span>' + esc(t) + '</span></li>').join(''), { role: 'list' }) +
    '</div></div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

L.stackSplit = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const flip = ctx.plan.flip;
  const imgCols = 6; const txtCols = 5;
  const imgRange = flip ? [13 - imgCols, 12] : [1, imgCols];
  const txtRange = flip ? [1, txtCols] : [imgCols + 2, 12];
  const photo = I.framedPhoto(a.photo, a.img, p, { fill: true, focus: a.focus });
  const hasBul = a.bullets.length > 0;
  const tw = GRID.span(txtCols);
  const fg = '<div class="canvas stack"><div class="block stack-head">' +
    kicker(ctx, sectionLabel(ctx)) +
    titleH1(ctx, a.title, { width: GRID.span(11), maxLines: 2, scale: [84, 74, 66, 58, 52] }) +
    '</div><div class="stack-body g12">' +
      '<div class="cell" style="' + cols(...imgRange) + '">' + photo + '</div>' +
      '<div class="cell stack-txt" style="' + cols(...txtRange) + '">' +
        (a.subtitle ? lead(ctx, a.subtitle, 30, { maxw: tw }) : '') +
        (a.body ? para(ctx, a.body, bodySize(a.bodyWords, { large: 28, normal: 26 }), { maxw: tw }) : '') +
        (hasBul ? listRows(ctx, a.bullets.slice(0, 4), { compact: true, labelSize: 32, detailSize: 26 }) : '') +
      '</div></div></div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

L.imageFocus = (ctx) => {
  const a = ctx.a;
  const flip = ctx.plan.flip;
  const tw = GRID.span(4);
  // 8 бағандық панель ≈ 1300px: ≤1.3× үлкейту ғана (sharpEnough-тың 0.6-сы 700px суретті 1.8× созатын → бұлыңғыр)
  const sharp = I.sharpEnough(a.img, 1660) && !(a.img.h && a.img.w && a.img.w / a.img.h < 0.9);
  // Сурет үлкен панельге жарамаса — 8 баған бос қалмайды: жақтаулы кіші фото (6 баған ≈ 900px), ол да болмаса тек мәтін
  const framed = !sharp && a.hasPhoto && I.sharpEnough(a.img, 1070);
  const bg = '<div class="plate"></div>' + (sharp ? photoBleed(ctx, flip ? 'right' : 'left', 8) : '');
  const txt = flip ? [1, 4] : [9, 12];
  if (!sharp && !framed) return L.statement(ctx);
  const support = a.subtitle || a.body;
  const frame = framed
    ? '<div class="cell photo-cell" style="' + cols(...(flip ? [6, 11] : [2, 7])) + ';align-self:center">' +
      I.framedPhoto(a.photo, a.img, ctx.palette, { ratio: '4 / 3', focus: a.focus }) + '</div>'
    : '';
  const fg = '<div class="canvas g12 focus">' + frame +
    '<div class="cell text-cell end" style="' + cols(...txt) + '"><div class="block">' +
      kicker(ctx, sectionLabel(ctx)) + rule(ctx, 48) +
      titleH1(ctx, a.title, { width: tw, maxLines: 5, scale: [64, 56, 50, 44, 40] }) +
      (support ? para(ctx, support, bodySize(a.bodyWords || 10, { large: 28, normal: 26 }), { maxw: tw }) : '') +
      (a.bullets.length ? notes(ctx, a.bullets.slice(0, 2), 24) : '') +
    '</div></div></div>';
  return { bg, fg: fg + folio(ctx), cls: 'focus-slide' };
};

L.editorial = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const flip = ctx.plan.flip;
  const lw = GRID.span(4); const rw = GRID.span(7);
  const L_ = flip ? [9, 12] : [1, 4];
  const R_ = flip ? [1, 7] : [6, 12];
  // Мәтіні жоқ слайд (ырғақ үшін points → editorial болған) — пункттер абзац болып ТОЛЫҚ шығады
  // (бұрын тек алғашқы 2 пункт көрінетін, 3–4-сі үнсіз жоғалатын)
  const paras = a.body ? a.body.split(/\n+/).filter(Boolean) : a.bullets.slice(0, 6);
  const words = a.body ? a.bodyWords : a.bulletWords;
  const twoCol = words > 90;
  const size = twoCol ? 26 : words <= 48 ? 36 : words <= 75 ? 32 : 28;
  const small = a.hasPhoto && I.sharpEnough(a.img, 700)
    ? '<div class="cell-photo">' + I.framedPhoto(a.photo, a.img, p, { ratio: '4 / 3', focus: a.focus }) + '</div>' : '';
  const fg = '<div class="canvas g12 edit">' +
    '<div class="cell edit-l ' + (flip ? 'at-r' : 'at-l') + '" style="' + cols(...L_) + '"><div class="block">' +
      kicker(ctx, sectionLabel(ctx)) +
      titleH1(ctx, a.title, { width: lw, maxLines: 5, scale: [72, 64, 56, 50, 44] }) +
      (a.subtitle ? lead(ctx, a.subtitle, 30, { maxw: lw }) : '') + small +
    '</div></div>' +
    '<div class="cell edit-r" style="' + cols(...R_) + '">' +
      (paras.length ? el(ctx, 'div', 'prose' + (twoCol ? ' two' : ''), paras.map((t) => '<p style="--bs:' + size + 'px">' + esc(t) + '</p>').join(''), { role: 'text' }) : '') +
      (a.body ? notes(ctx, a.bullets.slice(0, 4), 26) : '') +
    '</div></div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

L.points = (ctx) => {
  const a = ctx.a;
  const items = a.bullets.slice(0, 6);
  const n = items.length;
  const parsed = items.map(splitLabelDetail);
  const conceptCols = (n === 3 || n === 4) && parsed.every((x) => x.detail) &&
    parsed.every((x) => x.detail.length <= 130) && !a.body;
  if (conceptCols) return pointsColumns(ctx, parsed);
  const flip = ctx.plan.flip;
  const lw = GRID.span(5); const rw = GRID.span(6);
  const Lr = flip ? [8, 12] : [1, 5];
  const Rr = flip ? [1, 6] : [7, 12];
  const longest = a.longestBullet;
  const fg = '<div class="canvas g12 pts">' +
    '<div class="cell pts-l ' + (flip ? 'at-r' : 'at-l') + '" style="' + cols(...Lr) + '"><div class="block">' +
      kicker(ctx, sectionLabel(ctx)) +
      titleH1(ctx, a.title, { width: lw, maxLines: 4, scale: [84, 74, 66, 58, 52, 46] }) +
      (a.subtitle ? lead(ctx, a.subtitle, 30, { maxw: lw }) : '') +
      (a.body ? para(ctx, a.body, 26, { maxw: lw }) : '') +
    '</div></div>' +
    '<div class="cell pts-r" style="' + cols(...Rr) + '">' +
      listRows(ctx, items, { compact: longest > 110 }) +
    '</div></div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

function pointsColumns(ctx, parsed) {
  const a = ctx.a; const n = parsed.length;
  const tw = GRID.span(8);
  const cards = parsed.map((m, k) => '<li class="concept drop" data-role="concept"><span class="concept-n">' + num(ctx, k + 1) + '</span>' +
    '<div class="concept-l" style="--rl:' + (n <= 3 ? 52 : n === 4 ? 46 : 38) + 'px">' + esc(m.label) + '</div>' +
    (m.detail ? '<div class="concept-d" style="--rd:' + (n <= 3 ? 30 : n === 4 ? 28 : 25) + 'px">' + esc(m.detail) + '</div>' : '') + '</li>').join('');
  const fg = '<div class="canvas conc"><div class="block conc-head">' +
    kicker(ctx, sectionLabel(ctx)) +
    titleH1(ctx, a.title, { width: tw, maxLines: 2, scale: [92, 80, 70, 62, 54] }) +
    (a.subtitle ? lead(ctx, a.subtitle, 32, { maxw: GRID.span(7) }) : '') +
    '</div>' + el(ctx, 'ul', 'concepts n' + n, cards, { role: 'list' }) + '</div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
}

L.cards = (ctx) => {
  const a = ctx.a;
  const n = Math.min(6, Math.max(2, a.bullets.length));
  const parsed = a.bullets.slice(0, n).map((b) => {
    const m = splitLabelDetail(b);
    if (m.detail) return m;
    const nd = toNode(b);
    if (nd.detail) return nd;
    const w = String(b).trim().split(/\s+/);
    return w.length > 6 ? { label: w.slice(0, 3).join(' '), detail: w.slice(3).join(' ') } : { label: String(b).trim(), detail: '' };
  });
  return pointsColumns(ctx, parsed);
};

L.stats = (ctx) => {
  const a = ctx.a;
  const items = a.stats.slice(0, 4);
  const n = items.length;
  const base = n === 2 ? [176, 150, 124, 100] : n === 3 ? [144, 124, 104, 88, 76] : [112, 96, 84, 72, 64];
  // value sits inside a glass card: column minus card padding (2×32), border and a little slack
  const colW = (GRID.contentW - 32 * (n - 1)) / n - 110;
  const widest = items.reduce((m, s) => (String(s.value).length > m.length ? String(s.value) : m), '0');
  const fit = fitSize(widest.replace(/\s/g, '\u00a0'), { width: colW, maxLines: 1, scale: base, kind: ctx.kind, weight: ctx.ts.displayWeight, tracking: 0.02 });
  const shares = statShares(items);
  const cells = items.map((s, k) => {
    const raw = String(s.value);
    const m = raw.match(/^([^\d-]*)(-?[\d][\d\s.,]*)(.*)$/);
    const val = m ? parseStatNumber(m[2]) : null;
    let valHtml;
    if (m && val != null && isFinite(val)) {
      const numTxt = m[2].trim();
      valHtml = (m[1] ? '<span class="sfx">' + esc(m[1]) + '</span>' : '') +
        '<span data-count="' + val + '" data-raw="' + esc(numTxt) + '">' + esc(numTxt) + '</span>' +
        (m[3] ? '<span class="sfx">' + esc(m[3].trim()) + '</span>' : '');
    } else valHtml = esc(raw);
    const meter = shares[k] != null ? '<div class="meter" aria-hidden="true"><i style="--p:' + shares[k].toFixed(3) + ';--k:' + k + '"></i></div>' : '';
    return '<li class="stat" data-role="stat"><span class="stat-ix">' + num(ctx, k + 1) + '</span><div class="stat-v" style="--ns:' + fit.size + 'px">' + valHtml + '</div>' +
      meter + '<div class="stat-l">' + esc(s.label || '') + '</div></li>';
  }).join('');
  const support = a.subtitle || a.body;
  const fg = '<div class="canvas stats">' +
    '<div class="stats-head g12">' +
      '<div class="block" style="' + cols(1, 7) + '">' + kicker(ctx, sectionLabel(ctx)) +
        titleH1(ctx, a.title, { width: GRID.span(7), maxLines: 3, scale: [80, 70, 62, 54, 48] }) + '</div>' +
      '<div class="cell" style="' + cols(9, 12) + ';align-self:end">' +
        (support ? para(ctx, support, 26, { maxw: GRID.span(4) }) : '') +
        (a.bullets.length ? notes(ctx, a.bullets.slice(0, 2), 24) : '') + '</div>' +
    '</div>' + el(ctx, 'ul', 'stat-row n' + n, cells, { role: 'stats' }) + '</div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

L.number = (ctx) => {
  const a = ctx.a; const s = a.stats[0];
  const raw = String(s.value);
  const num = parseStatNumber(raw);
  const w = GRID.span(7);
  const fit = fitSize(raw.replace(/\s/g, ''), { width: w, maxLines: 1, scale: NUMERAL_HERO, kind: ctx.kind, weight: ctx.ts.displayWeight, tracking: -0.04 });
  const valHtml = num != null
    ? '<span data-count="' + num + '" data-raw="' + esc(raw) + '">' + esc(raw) + '</span>' : esc(raw);
  const tw = GRID.span(4);
  const pct = /%/.test(raw) && num != null && num >= 0 && num <= 100;
  let hero;
  if (pct) {
    // percentage → the number sits inside a progress ring that fills up to its value
    const inner = fitSize(raw.replace(/\s/g, ''), { width: 430, maxLines: 1, scale: [220, 190, 160, 136, 112], kind: ctx.kind, weight: ctx.ts.displayWeight, tracking: -0.04 });
    hero = '<div class="ring-wrap"><div class="ring" aria-hidden="true" style="--p:' + (num / 100).toFixed(3) + '"></div>' +
      el(ctx, 'div', 'mega in-ring', valHtml, { role: 'numeral', style: '--ns:' + inner.size + 'px' }) + '</div>';
  } else {
    hero = el(ctx, 'div', 'mega', valHtml, { role: 'numeral', style: '--ns:' + fit.size + 'px' });
  }
  const fg = '<div class="canvas g12 numb">' +
    '<div class="cell numb-l" style="' + cols(1, 7) + '">' + hero + '</div>' +
    '<div class="cell numb-r" style="' + cols(9, 12) + '"><div class="block">' +
      el(ctx, 'div', 'kicker', esc(s.label || ''), { role: 'kicker' }) + rule(ctx, 48) +
      titleH1(ctx, a.title, { width: tw, maxLines: 4, scale: [56, 50, 44, 40] }) +
      (a.subtitle ? para(ctx, a.subtitle, 26, { maxw: tw }) : '') +
    '</div></div></div>';
  return { bg: '<div class="plate"></div>' + AURORA_SOFT, fg: fg + folio(ctx), cls: 'numb-slide' };
};

function nodeList(a, field, max) {
  return (a.nodes[field] || []).slice(0, max).map(toNode);
}

L.timeline = (ctx) => {
  const a = ctx.a;
  // «1890 — Ағартушылық: …» → жыл бөлек белгі болады (бұрын «01» нөмір шығып, жыл мәтінге кетіп қалатын)
  const nodes = nodeList(a, 'timeline', 6).map((nd) => {
    const ym = String(nd.label || '').match(/^(\d{3,4}(?:\s*[–-]\s*\d{2,4})?)\s+[—–-]\s+(.+)$/);
    return ym ? { label: ym[1], detail: ym[2] + (nd.detail ? ': ' + nd.detail : '') } : nd;
  });
  const n = nodes.length;
  const dateSize = n <= 3 ? 64 : n === 4 ? 54 : 44;
  // қысқа детал ("2 млрд", "Іске қосу") — ұсақ жазу емес, санға ұқсап ірі тұрады (слайд бос көрінбейді)
  const shortDet = nodes.every((nd) => String(nd.detail || '').length <= 16);
  const dsz = shortDet ? (n <= 4 ? 44 : 38) : n <= 4 ? 30 : 28;
  // Күн/жыл белгісі тек БАРЛЫҚ нүктеде қысқа (<=14 таңба) болса; әйтпесе нөмір + толық мәтін (қабаттасып кетпеу үшін)
  const allDates = nodes.length > 0 && nodes.every((nd) => nd.label && nd.detail && nd.label.length <= 14);
  const items = nodes.map((nd, i) => {
    const date = allDates ? nd.label : pad2(i + 1);
    const full = nd.detail ? nd.label + ' — ' + nd.detail : nd.label;
    const detail = allDates ? truncate(nd.detail, n > 4 ? 130 : 170) : truncate(full, n > 4 ? 130 : 170);
    return '<li class="tl-n drop" data-role="tl"><div class="tl-date" style="--ds:' + dateSize + 'px">' + esc(date) + '</div>' +
      '<div class="tl-mark"></div><div class="tl-txt" style="--bs:' + dsz + 'px">' + esc(detail) + '</div></li>';
  }).join('');
  const fg = '<div class="canvas tl-canvas"><div class="tl-head g12"><div class="block" style="' + cols(1, 8) + '">' +
    kicker(ctx, sectionLabel(ctx)) +
    titleH1(ctx, a.title, { width: GRID.span(8), maxLines: 2, scale: [84, 74, 66, 58, 52] }) + '</div>' +
    '<div class="cell" style="' + cols(9, 12) + ';align-self:end">' + (a.subtitle ? para(ctx, a.subtitle, 26, { maxw: GRID.span(4) }) : '') + '</div></div>' +
    el(ctx, 'ol', 'tl n' + n, items, { role: 'timeline' }) + '</div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

L.process = (ctx) => {
  const a = ctx.a;
  const nodes = nodeList(a, 'steps', 6);
  const n = nodes.length;
  const grid = n <= 4 ? n : 3;
  const labS = n <= 3 ? 42 : n === 4 ? 36 : 32;
  const detS = n <= 4 ? 28 : 25;
  // Тек сөйлем (жапсырмасыз) түйін: қалың «тақырып» ұясына сыймайды → толық сөйлем оқылатын өлшеммен, кесілмей
  const sentS = n <= 3 ? 32 : n === 4 ? 29 : 26;
  const items = nodes.map((nd, i) => {
    const sentence = !nd.detail && nd.label.length > 40;
    return '<li class="st drop" data-role="step"><div class="st-mark"><span class="st-n">' + num(ctx, i + 1) + '</span>' +
      (i < n - 1 && n <= 4 ? '<i class="st-arrow"></i>' : '') + '</div>' +
      (sentence
        ? '<div class="st-d st-s" style="--rd:' + sentS + 'px">' + esc(truncate(nd.label, 240)) + '</div>'
        : '<div class="st-l" style="--rl:' + labS + 'px">' + esc(truncate(nd.label, 64)) + '</div>' +
          (nd.detail ? '<div class="st-d" style="--rd:' + detS + 'px">' + esc(truncate(nd.detail, 200)) + '</div>' : '')) + '</li>';
  }).join('');
  const fg = '<div class="canvas proc-canvas"><div class="proc-head g12"><div class="block" style="' + cols(1, 8) + '">' +
    kicker(ctx, sectionLabel(ctx)) +
    titleH1(ctx, a.title, { width: GRID.span(8), maxLines: 2, scale: [84, 74, 66, 58, 52] }) + '</div>' +
    '<div class="cell" style="' + cols(9, 12) + ';align-self:end">' + (a.subtitle ? para(ctx, a.subtitle, 26, { maxw: GRID.span(4) }) : '') + '</div></div>' +
    el(ctx, 'ol', 'steps g' + grid + (n > 4 ? ' wrap' : ''), items, { role: 'steps' }) + '</div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

L.hierarchy = (ctx) => {
  const a = ctx.a;
  const nodes = nodeList(a, 'hierarchy', 6);
  const n = nodes.length;
  const kids = nodes.map((nd, i) => {
    const sentence = !nd.detail && nd.label.length > 40; // тек сөйлем → кесілмей, оқылатын өлшеммен
    return '<li class="hn drop" data-role="node"><span class="hn-n">' + num(ctx, i + 1) + '</span>' +
      (sentence
        ? '<div class="hn-d hn-s" style="--rd:' + (n <= 3 ? 30 : n === 4 ? 28 : 25) + 'px">' + esc(truncate(nd.label, 220)) + '</div>'
        : '<div class="hn-l" style="--rl:' + (n <= 3 ? 38 : n === 4 ? 34 : 30) + 'px">' + esc(truncate(nd.label, 56)) + '</div>' +
          (nd.detail ? '<div class="hn-d" style="--rd:' + (n <= 3 ? 28 : n === 4 ? 26 : 23) + 'px">' + esc(truncate(nd.detail, 170)) + '</div>' : '')) + '</li>';
  }).join('');
  const fg = '<div class="canvas hier"><div class="block hier-root">' +
    kicker(ctx, sectionLabel(ctx)) +
    titleH1(ctx, a.title, { width: GRID.span(9), maxLines: 2, scale: [80, 70, 62, 54, 48], cls: 'center' }) +
    (a.subtitle ? lead(ctx, a.subtitle, 30, { maxw: GRID.span(8), cls: 'center' }) : '') +
    '</div>' + el(ctx, 'ul', 'tree n' + n, kids, { role: 'tree' }) + '</div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

L.table = (ctx) => {
  const a = ctx.a; const t = a.table;
  const headers = (t.headers || []).slice(0, 5);
  const rows = (t.rows || []).slice(0, 7).map((r) => (Array.isArray(r) ? r : [r]));
  const ncols = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  const fs = rows.length <= 4 ? 34 : rows.length <= 5 ? 30 : 26;
  const fsz = ncols >= 4 ? fs - 2 : fs;
  const thead = headers.length ? '<thead><tr>' + headers.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead>' : '';
  const tbody = '<tbody>' + rows.map((r) => '<tr class="drop">' + r.slice(0, 5).map((c, i) => '<td' + (i === 0 ? ' class="first"' : '') + '>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody>';
  const fg = '<div class="canvas tbl"><div class="tbl-head g12"><div class="block" style="' + cols(1, 8) + '">' +
    kicker(ctx, sectionLabel(ctx)) +
    titleH1(ctx, a.title, { width: GRID.span(8), maxLines: 2, scale: [80, 70, 62, 54, 48] }) + '</div>' +
    '<div class="cell" style="' + cols(9, 12) + ';align-self:end">' + (a.subtitle ? para(ctx, a.subtitle, 26, { maxw: GRID.span(4) }) : '') + '</div></div>' +
    el(ctx, 'div', 'table-wrap', '<table class="data-table" style="--ts2:' + fsz + 'px">' + thead + tbody + '</table>', { role: 'table' }) + '</div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

L.diagram = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const tw = GRID.span(4);
  const fig = '<figure class="figure rv" data-role="figure" style="--i:9"><img alt="' + esc(a.title) + '" src="' + a.slideRef.visualSvg + '" decoding="async"></figure>';
  const fg = '<div class="canvas g12 diag">' +
    '<div class="cell diag-l" style="' + cols(1, 4) + '"><div class="block">' +
      kicker(ctx, sectionLabel(ctx)) +
      titleH1(ctx, a.title, { width: tw, maxLines: 5, scale: [64, 58, 52, 46, 42] }) +
      (a.subtitle ? lead(ctx, a.subtitle, 28, { maxw: tw }) : '') +
      notes(ctx, a.bullets.slice(0, 2), 24) +
    '</div></div>' +
    '<div class="cell diag-r" style="' + cols(5, 12) + '">' + fig + '</div></div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

/**
 * Infographic slide. "side": message on the left (4 cols), graphic on the right (7 cols);
 * "stack": heading row on top, graphic across the full width.
 */
L.infographic = (ctx) => {
  const a = ctx.a; const d = a.infographic; const p = ctx.palette;
  const spec = IG.KINDS[d.kind];
  const support = a.subtitle || a.body;
  const source = d.source ? '<div class="ig-source" data-role="meta">' + esc(d.source) + '</div>' : '';
  let fg;
  if (spec.layout === 'side') {
    const W = GRID.span(7); const H = 720;
    fg = '<div class="canvas g12 igs">' +
      '<div class="cell igs-l" style="' + cols(1, 4) + '"><div class="block">' +
        kicker(ctx, sectionLabel(ctx)) + rule(ctx, 48) +
        titleH1(ctx, a.title, { width: GRID.span(4), maxLines: 4, scale: [72, 64, 56, 50, 44] }) +
        (support ? para(ctx, support, 30, { maxw: GRID.span(4) }) : '') +
      '</div></div>' +
      '<div class="cell igs-r" style="' + cols(6, 12) + '">' + el(ctx, 'div', 'ig-wrap', IG.renderInfographic(d, W, H, p) + source, { role: 'figure-wrap' }) + '</div></div>';
  } else {
    const W = GRID.contentW; const H = 540;
    fg = '<div class="canvas igk"><div class="igk-head g12"><div class="block" style="' + cols(1, 8) + '">' +
      kicker(ctx, sectionLabel(ctx)) +
      titleH1(ctx, a.title, { width: GRID.span(8), maxLines: 2, scale: [80, 70, 62, 54, 48] }) + '</div>' +
      '<div class="cell" style="' + cols(9, 12) + ';align-self:end">' + (support ? para(ctx, support, 30, { maxw: GRID.span(4) }) : '') + '</div></div>' +
      el(ctx, 'div', 'ig-wrap', IG.renderInfographic(d, W, H, p) + source, { role: 'figure-wrap' }) + '</div>';
  }
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: 'ig-slide' };
};

L.quote = (ctx) => {
  const a = ctx.a;
  const text = a.subtitle || a.body || a.title;
  const who = a.subtitle || a.body ? a.title : '';
  const fit = fitSize(text, { width: GRID.span(9), maxLines: 5, scale: [80, 70, 62, 56, 50, 44], kind: ctx.kind, weight: ctx.ts.titleWeight, tracking: -0.015 });
  const fg = '<div class="canvas quote"><div class="block quote-block">' +
    el(ctx, 'div', 'qmark', '“', { role: 'mark' }) +
    el(ctx, 'blockquote', 'qtext', esc(text), { role: 'title', style: '--ts:' + fit.size + 'px' }) +
    (who ? '<div class="qwho rv" style="--i:4">' + '<i class="qrule"></i><span data-role="lead">' + esc(who) + '</span></div>' : '') +
    '</div></div>';
  return { bg: '<div class="plate"></div>' + AURORA_SOFT + ghost('ghost-quote', '”'), fg: fg + folio(ctx), cls: 'quote-slide' };
};

/** Қорытынды — «бөлінген»: фото бір жақта (толық биіктік), тақырып пен түйіндер екінші жақта (журнал, академия, ателье) */
function closingSplit(ctx) {
  const a = ctx.a;
  const items = a.bullets.slice(0, 4);
  const lw = GRID.span(6);
  const bg = '<div class="plate plate-section"></div>' + photoBleed(ctx, 'left', 5);
  const fg = '<div class="canvas g12 close close-split">' +
    '<div class="cell close-r" style="' + cols(7, 12) + '"><div class="block">' +
      rule(ctx, 56) +
      titleH1(ctx, a.title, { role: 'display', width: lw, maxLines: 2, scale: [96, 84, 74, 64, 56], hl: true }) +
      (a.subtitle ? lead(ctx, a.subtitle, 30, { maxw: lw }) : '') +
      (items.length ? listRows(ctx, items, { compact: items.length > 3, labelSize: 30, detailSize: 24 }) : para(ctx, a.body || '', 30, { maxw: lw })) +
    '</div></div></div>';
  return { bg, fg: fg + folio(ctx), cls: 'closing-slide' };
}

L.closing = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  if (ctx.sys && ctx.sys.closing === 'split' && a.hasPhoto && I.sharpEnough(a.img, 900)) return closingSplit(ctx);
  const hasP = a.hasPhoto && I.bleedOK(a.img, 1920, a.imgAI); // бұлыңғыр/портрет сурет бүкіл фонға созылмайды
  let bg = hasP
    ? '<div class="full">' + I.imgTag(a.photo, a.img, p, { focus: a.focus }) + '</div><div class="scrim" style="background:' + I.scrim('flat', p) + '"></div>'
    : '<div class="plate plate-section"></div>' + AURORA;
  if (!hasP && ctx.sys && ctx.sys.doodles) { // фотосыз қорытынды — тақырыпқа сай екінші иллюстрация
    const D = require('./doodles');
    const uri = D.doodleUri(D.pickDoodle(ctx.deckTitle + ' ' + a.title, 1), p.accent, p.text);
    if (uri) bg += '<img class="doodle doodle-close" alt="" src="' + uri + '">';
  }
  const items = a.bullets.slice(0, 4);
  const lw = GRID.span(5);
  const fg = '<div class="canvas g12 close">' +
    '<div class="cell close-l" style="' + cols(1, 5) + '"><div class="block">' +
      rule(ctx, 56) +
      titleH1(ctx, a.title, { role: 'display', width: lw, maxLines: 3, scale: [112, 96, 84, 72, 62, 54], hl: true }) +
      (a.subtitle ? lead(ctx, a.subtitle, 32, { maxw: lw }) : '') +
    '</div></div>' +
    '<div class="cell close-r" style="' + cols(7, 12) + '">' +
      (items.length ? listRows(ctx, items, { large: true }) : para(ctx, a.body || '', 32, { maxw: GRID.span(6) })) +
    '</div></div>';
  return { bg, fg: fg + folio(ctx), cls: 'closing-slide' };
};

L.references = (ctx) => {
  const a = ctx.a;
  const lines = (a.bullets.length ? a.bullets : String(a.body || '').split(/\n+/)).filter(Boolean).slice(0, 14);
  const lw = GRID.span(4);
  const fg = '<div class="canvas g12 refs">' +
    '<div class="cell" style="' + cols(1, 4) + '"><div class="block">' + rule(ctx, 48) +
      titleH1(ctx, a.title, { width: lw, maxLines: 3, scale: [68, 60, 54, 48, 44] }) + '</div></div>' +
    '<div class="cell" style="' + cols(6, 12) + '">' + el(ctx, 'ol', 'refs-list' + (lines.length > 6 ? ' two' : ''),
      lines.map((t, i) => '<li class="drop" data-role="ref" style="--bs:' + (lines.length > 8 ? 22 : 24) + 'px"><span class="ref-n">' + (i + 1) + '</span><span>' + esc(t) + '</span></li>').join(''), { role: 'list' }) + '</div></div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

module.exports = { L, makeCtx, esc };
