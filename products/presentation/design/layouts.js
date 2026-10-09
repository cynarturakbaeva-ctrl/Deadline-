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

const esc = (v) => (v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
const pad2 = (n) => String(n).padStart(2, '0');
const NUMERAL_HERO = [340, 290, 240, 200, 160, 128];

// ── shared building blocks ────────────────────────────────────────────────
function makeCtx(a, plan, palette, ts, deckTitle) {
  const serif = /DisplayFace|serif/i.test(ts.display) && !/sans/i.test(ts.display.split(',')[0]);
  let i = 0;
  return {
    a, plan, palette, ts, deckTitle, serif,
    rv() { i += 1; return 'class="rv" style="--i:' + i + '"'; },
    rvAttr() { i += 1; return { cls: 'rv', style: '--i:' + i }; },
    kind: serif ? 'serif' : 'sans',
  };
}

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
  return el(ctx, 'h1', 'title' + (role === 'display' ? ' t-display' : '') + (o.cls ? ' ' + o.cls : ''), esc(text), {
    role: 'title', style: '--ts:' + fit.size + 'px;' + (o.style || ''),
  });
}
const rule = (ctx, w) => el(ctx, 'div', 'rule', '', { style: 'width:' + (w || 56) + 'px' });
const kicker = (ctx, text) => (text ? el(ctx, 'div', 'kicker', esc(text), { role: 'kicker' }) : '');
const lead = (ctx, text, size, o = {}) => (text ? el(ctx, 'p', 'lead' + (o.cls ? ' ' + o.cls : ''), esc(text), { role: 'lead', style: '--ls:' + (size || TYPE_SCALE.lead) + 'px' + (o.maxw ? ';max-width:' + o.maxw + 'px' : '') }) : '');
const para = (ctx, text, size, o = {}) => (text ? el(ctx, 'p', 'para' + (o.cls ? ' ' + o.cls : ''), esc(text), { role: 'text', style: '--bs:' + size + 'px' + (o.maxw ? ';max-width:' + o.maxw + 'px' : '') }) : '');

function folio(ctx) {
  const a = ctx.a;
  return '<div class="folio" data-role="folio"><span class="folio-l">' + esc(truncate(ctx.deckTitle, 46)) + '</span>' +
    '<span class="folio-r"><b>' + pad2(a.index + 1) + '</b><span class="of"> / ' + pad2(a.total) + '</span></span></div>';
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
    return '<li class="row drop" data-role="row"><span class="row-n">' + pad2(k + 1) + '</span><div class="row-b">' +
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

L.cover = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const rc = ctx.plan && ctx.plan.refCover;
  const bleedOK = !rc && a.hasPhoto && I.sharpEnough(a.img, 1400);
  let bg = '<div class="plate plate-cover"></div>';
  let fgCls = 'cover-plain';
  if (rc) {
    bg += '<div class="ref-cover-photo' + (rc.shape === 'circle' ? ' is-circle' : '') + '" style="left:' + rc.x + 'px;top:' + rc.y + 'px;width:' + rc.w + 'px;height:' + rc.h + 'px">' + I.imgTag(a.photo, a.img, p, { focus: a.focus }) + '</div>';
  }
  if (a.hasPhoto && bleedOK) {
    bg = '<div class="full">' + I.imgTag(a.photo, a.img, p, { focus: a.focus }) + '</div>' +
      '<div class="scrim" style="background:' + I.scrim('left', p) + '"></div>' +
      '<div class="scrim" style="background:' + I.scrim('bottom', p) + '"></div>';
    fgCls = 'cover-photo';
  }
  const w = GRID.span(10);
  const meta = a.bullets.map(splitLabelDetail);
  const labeled = meta.length && meta.every((m) => m.detail);
  const metaHtml = meta.length
    ? el(ctx, 'div', 'meta-row', (labeled
      ? meta.slice(0, 4).map((m) => '<div class="meta-i" data-role="meta"><span class="meta-k">' + esc(m.label) + '</span><span class="meta-v">' + esc(m.detail) + '</span></div>').join('')
      : '<div class="meta-i" data-role="meta"><span class="meta-v">' + esc(a.bullets.slice(0, 3).join('  ·  ')) + '</span></div>'), { role: 'meta-row' })
    : '';
  const fg = '<div class="canvas cover">' +
    '<div class="cover-top">' + (sectionLabel(ctx) ? rule(ctx, 56) + kicker(ctx, sectionLabel(ctx)) : '') + '</div>' +
    '<div class="block cover-block">' +
      titleH1(ctx, a.title, { role: 'display', width: w, maxLines: 3 }) +
      lead(ctx, a.subtitle && !labeled ? a.subtitle : (labeled ? '' : a.subtitle), 38, { maxw: GRID.span(7) }) +
      (a.body && !a.subtitle ? para(ctx, a.body, 28, { maxw: GRID.span(7) }) : '') +
      metaHtml +
    '</div></div>';
  return { bg, fg: fg + folio(ctx), cls: fgCls };
};

L.section = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const num = ctx.plan.section ? pad2(ctx.plan.section) : pad2(a.index);
  const hasP = a.hasPhoto && I.sharpEnough(a.img, 900);
  const bg = '<div class="plate plate-section"></div>' + (hasP ? photoBleed(ctx, 'right', 5) : '');
  const textW = hasP ? GRID.span(6) : GRID.span(9);
  const fg = '<div class="canvas sect">' +
    el(ctx, 'div', 'numeral-xl', num, { role: 'numeral' }) +
    '<div class="block sect-block">' + rule(ctx, 56) +
      titleH1(ctx, a.title, { role: 'display', width: textW, maxLines: 3, scale: [120, 104, 92, 80, 68] }) +
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
    titleH1(ctx, a.title, { role: long ? 'title' : 'display', width: w, maxLines: long ? 4 : 3, scale: long ? [92, 80, 70, 62] : [128, 112, 98, 86, 76] }) +
    (support ? rule(ctx, 56) : '') +
    (a.subtitle ? lead(ctx, a.subtitle, 38, { maxw: GRID.span(7) }) : '') +
    (a.body ? para(ctx, a.body, bodySize(a.bodyWords), { maxw: GRID.span(7) }) : '') +
    '</div></div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
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
      (hasBul ? listRows(ctx, a.bullets.slice(0, 4), { compact: true, labelSize: 30, detailSize: 24 }) : '') +
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
    titleH1(ctx, a.title, { role: 'display', width: w, maxLines: 3, scale: [112, 98, 86, 74, 64] }) +
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
        (hasBul ? listRows(ctx, a.bullets.slice(0, 4), { compact: true, labelSize: 30, detailSize: 24 }) : '') +
      '</div></div></div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

L.imageFocus = (ctx) => {
  const a = ctx.a;
  const flip = ctx.plan.flip;
  const tw = GRID.span(4);
  const sharp = I.sharpEnough(a.img, 1100);
  const bg = '<div class="plate"></div>' + (sharp ? photoBleed(ctx, flip ? 'right' : 'left', 8) : '');
  const txt = flip ? [1, 4] : [9, 12];
  const support = a.subtitle || a.body;
  const fg = '<div class="canvas g12 focus">' +
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
  const twoCol = a.bodyWords > 90;
  const size = twoCol ? 26 : a.bodyWords <= 48 ? 36 : a.bodyWords <= 75 ? 32 : 28;
  const small = a.hasPhoto && I.sharpEnough(a.img, 700)
    ? '<div class="cell-photo">' + I.framedPhoto(a.photo, a.img, p, { ratio: '4 / 3', focus: a.focus }) + '</div>' : '';
  const fg = '<div class="canvas g12 edit">' +
    '<div class="cell edit-l" style="' + cols(...L_) + '"><div class="block">' +
      kicker(ctx, sectionLabel(ctx)) +
      titleH1(ctx, a.title, { width: lw, maxLines: 5, scale: [72, 64, 56, 50, 44] }) +
      (a.subtitle ? lead(ctx, a.subtitle, 30, { maxw: lw }) : '') + small +
    '</div></div>' +
    '<div class="cell edit-r" style="' + cols(...R_) + '">' +
      (a.body ? el(ctx, 'div', 'prose' + (twoCol ? ' two' : ''), a.body.split(/\n+/).map((t) => '<p style="--bs:' + size + 'px">' + esc(t) + '</p>').join(''), { role: 'text' }) : '') +
      notes(ctx, a.bullets.slice(0, 2), 26) +
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
    '<div class="cell pts-l" style="' + cols(...Lr) + '"><div class="block">' +
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
  const cards = parsed.map((m, k) => '<li class="concept drop" data-role="concept"><span class="concept-n">' + pad2(k + 1) + '</span>' +
    '<div class="concept-l" style="--rl:' + (n <= 3 ? 38 : n === 4 ? 32 : 30) + 'px">' + esc(m.label) + '</div>' +
    (m.detail ? '<div class="concept-d" style="--rd:' + (n <= 3 ? 27 : n === 4 ? 24 : 23) + 'px">' + esc(m.detail) + '</div>' : '') + '</li>').join('');
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
  const base = n === 2 ? [176, 150, 124, 100] : n === 3 ? [144, 124, 104, 88] : [112, 96, 84, 72];
  const colW = (GRID.contentW - GRID.gutter * (n - 1)) / n - 12;
  const widest = items.reduce((m, s) => (String(s.value).length > m.length ? String(s.value) : m), '0');
  const fit = fitSize(widest.replace(/\s/g, '\u00a0'), { width: colW, maxLines: 1, scale: base, kind: ctx.kind, weight: ctx.ts.displayWeight, tracking: 0.02 });
  const cells = items.map((s) => {
    const raw = String(s.value);
    const m = raw.match(/^([^\d-]*)(-?[\d][\d\s.,]*)(.*)$/);
    const num = m ? parseStatNumber(m[2]) : null;
    let valHtml;
    if (m && num != null && isFinite(num)) {
      const numTxt = m[2].trim();
      valHtml = (m[1] ? '<span class="sfx">' + esc(m[1]) + '</span>' : '') +
        '<span data-count="' + num + '" data-raw="' + esc(numTxt) + '">' + esc(numTxt) + '</span>' +
        (m[3] ? '<span class="sfx">' + esc(m[3].trim()) + '</span>' : '');
    } else valHtml = esc(raw);
    return '<li class="stat" data-role="stat"><div class="stat-v" style="--ns:' + fit.size + 'px">' + valHtml + '</div>' +
      '<div class="stat-l">' + esc(s.label || '') + '</div></li>';
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
  const fg = '<div class="canvas g12 numb">' +
    '<div class="cell numb-l" style="' + cols(1, 7) + '">' + el(ctx, 'div', 'mega', valHtml, { role: 'numeral', style: '--ns:' + fit.size + 'px' }) + '</div>' +
    '<div class="cell numb-r" style="' + cols(9, 12) + '"><div class="block">' +
      el(ctx, 'div', 'kicker', esc(s.label || ''), { role: 'kicker' }) + rule(ctx, 48) +
      titleH1(ctx, a.title, { width: tw, maxLines: 4, scale: [56, 50, 44, 40] }) +
      (a.subtitle ? para(ctx, a.subtitle, 26, { maxw: tw }) : '') +
    '</div></div></div>';
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

function nodeList(a, field, max) {
  return (a.nodes[field] || []).slice(0, max).map(toNode);
}

L.timeline = (ctx) => {
  const a = ctx.a;
  const nodes = nodeList(a, 'timeline', 6);
  const n = nodes.length;
  const dateSize = n <= 3 ? 64 : n === 4 ? 54 : 44;
  const dsz = n <= 4 ? 30 : 26;
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
  const items = nodes.map((nd, i) => '<li class="st drop" data-role="step"><div class="st-mark"><span class="st-n">' + pad2(i + 1) + '</span>' +
    (i < n - 1 && n <= 4 ? '<i class="st-arrow"></i>' : '') + '</div>' +
    '<div class="st-l" style="--rl:' + labS + 'px">' + esc(truncate(nd.label, 64)) + '</div>' +
    (nd.detail ? '<div class="st-d" style="--rd:' + detS + 'px">' + esc(truncate(nd.detail, 170)) + '</div>' : '') + '</li>').join('');
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
  const kids = nodes.map((nd, i) => '<li class="hn drop" data-role="node"><span class="hn-n">' + pad2(i + 1) + '</span>' +
    '<div class="hn-l" style="--rl:' + (n <= 3 ? 32 : 28) + 'px">' + esc(truncate(nd.label, 56)) + '</div>' +
    (nd.detail ? '<div class="hn-d" style="--rd:' + (n <= 4 ? 24 : 22) + 'px">' + esc(truncate(nd.detail, 130)) + '</div>' : '') + '</li>').join('');
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
  return { bg: '<div class="plate"></div>', fg: fg + folio(ctx), cls: '' };
};

L.closing = (ctx) => {
  const a = ctx.a; const p = ctx.palette;
  const hasP = a.hasPhoto;
  const bg = hasP
    ? '<div class="full">' + I.imgTag(a.photo, a.img, p, { focus: a.focus }) + '</div><div class="scrim" style="background:' + I.scrim('flat', p) + '"></div>'
    : '<div class="plate plate-section"></div>';
  const items = a.bullets.slice(0, 4);
  const lw = GRID.span(5);
  const fg = '<div class="canvas g12 close">' +
    '<div class="cell close-l" style="' + cols(1, 5) + '"><div class="block">' +
      rule(ctx, 56) +
      titleH1(ctx, a.title, { role: 'display', width: lw, maxLines: 3, scale: [112, 96, 84, 72, 62, 54] }) +
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
