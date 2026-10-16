'use strict';
/**
 * КОМПОЗИЦИЯЛАР — «Канва» деңгейіндегі құрастырылған слайдтар кітапханасы.
 *
 * Бұрынғы макеттер (layouts.js) — мәтін торы: тақырып + қатарлар. Мұнда әр слайд — композиция:
 * арка-терезе, полароид, жыртық қағаз, билет, мөр, күн шұғыласы, ірі көмескі сан, гравюра/белгіше.
 *
 * Әр композиция: { id, kind, fits(a, shape, sys), render(ctx, shape, env) → {bg, fg, cls} }
 *   kind — мазмұн пішіні: cover | concepts | timeline | quote | photoList
 *   fits — мазмұн сыя ма (пункт саны, мәтін ұзындығы, фото бар/жоқ, жүйе)
 * Таңдау (pick): пішінге сай үміткерлер → колодада қолданылмағаны → студенттің соңғы колодаларында
 * болмағаны → тұқым бойынша біреуі. Ешқайсысы сай келмесе — null (бұрынғы макет қолданылады).
 *
 * Мәтін әрқашан нағыз мәтін (data-role, PPTX-те өңделеді); әшекей — фон қабатында (parts.js).
 */
const P = require('./parts');
const { splitLabelDetail } = require('../analyze');
const { H, esc } = require('../layouts');
const I = require('../imagery');
const { GRID } = require('../tokens');

const MX = GRID.marginX; const MT = GRID.marginTop; const MB = GRID.marginBottom; const W = GRID.W; const HH = GRID.H;

/** Абсолют орналасқан мәтін блогы (QA өлшейді) */
function t(role, x, y, w, inner, style = '') {
  return '<div class="cx-t" data-role="' + role + '" style="position:absolute;left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;width:' + Math.round(w) + 'px;' + style + '">' + inner + '</div>';
}
/** Төменнен бекітілген мәтін блогы */
function tb(role, x, bottom, w, inner, style = '') {
  return '<div class="cx-t" data-role="' + role + '" style="position:absolute;left:' + Math.round(x) + 'px;bottom:' + Math.round(bottom) + 'px;width:' + Math.round(w) + 'px;' + style + '">' + inner + '</div>';
}
const fs = (n) => 'font-size:calc(' + n + 'px*var(--fs,1))';
const disp = 'font-family:var(--f-display);font-weight:var(--dw,400);letter-spacing:-.01em';
const wrap = (x, y, w, inner) => '<div style="position:absolute;left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;width:' + Math.round(w) + 'px">' + inner + '</div>';
const wrapB = (x, bottom, w, inner) => '<div style="position:absolute;left:' + Math.round(x) + 'px;bottom:' + Math.round(bottom) + 'px;width:' + Math.round(w) + 'px">' + inner + '</div>';

/** Мазмұн пішіні */
function shapeOf(a) {
  if (a.index === 0) return { kind: 'cover' };
  if (a.isQuoteSlide) return { kind: 'quote' };
  if (a.infographic || a.hasTable || a.hasVisual || a.stats.length || a.isReferences) return null;
  const items = a.bullets.map(splitLabelDetail).filter((m) => m.label);
  const dated = items.filter((m) => /^\d{3,4}(\s*[–-]\s*\d{2,4})?$/.test(m.label) || /^\d{3,4}\b/.test(m.label));
  if (items.length >= 3 && items.length <= 4 && dated.length === items.length) {
    return { kind: 'timeline', items: items.map((m) => {
      const ym = m.label.match(/^(\d{3,4}(?:\s*[–-]\s*\d{2,4})?)\s*(.*)$/);
      return { date: ym ? ym[1] : m.label, label: ym && ym[2] ? ym[2].replace(/^[—–:-]\s*/, '') : '', detail: m.detail };
    }) };
  }
  if (!items.length) {
    const text = String(a.body || a.subtitle || '').trim();
    return text.length <= 260 && a.title ? { kind: 'statement', text } : null;
  }
  if (a.body) return null;
  const short = items.every((m) => m.label.length <= 34 && (m.detail || '').length <= 110);
  if (a.hasPhoto && items.length >= 3 && items.length <= 5 && items.every((m) => (m.label + ' ' + (m.detail || '')).length <= 130)) return { kind: 'photoList', items };
  if (items.length >= 2 && items.length <= 5 && short && items.filter((m) => m.detail).length >= items.length - 1) return { kind: 'concepts', items };
  return null;
}

const COMPS = [];
const def = (c) => COMPS.push(c);

// ─────────────────────────────── МҰҚАБАЛАР ───────────────────────────────

/** Арка ішінде фото, артында күн шұғыласы, жоғарыда ою; автор — жыртық қағаз жолақта */
def({
  id: 'cover-arch', kind: 'cover',
  fits: (a) => a.hasPhoto,
  render(ctx, sh, env) {
    const a = ctx.a; const p = ctx.palette;
    const img = I.imgTag(a.photo, a.img, p, { focus: a.focus });
    const { metaHtml } = H.coverParts(ctx);
    const bg = '<div class="plate plate-cover"></div>' + P.grain(P.mix(p.bg, p.text, 0.08)) +
      P.sunburst(1470, 470, 560, p.accent2 || p.accent, { opacity: 0.35, rays: 30 }) +
      P.arch(1190, 130, 560, 820, img, { outline: p.accent, dx: 30, dy: 30, shadow: true }) +
      P.panel(1060, 1000, 860, 80, p.accent) +
      P.panel(0, 830, 980, 250, P.mix(p.bg, p.text, 0.09), 'clip-path:' + P.torn(a.index + 3, 'top', 14)) +
      P.tape(840, 826, 150, -7, P.mix(p.bg, p.accent2 || p.accent, 0.55));
    const orn = ctx.sys && ctx.sys.decor ? P.horn(MX, 150, 110, p.accent) : '';
    const fg = wrap(MX, ctx.sys && ctx.sys.decor ? 260 : 200, 960,
      H.kicker(ctx, H.sectionLabel(ctx)) +
      H.titleH1(ctx, a.title, { role: 'display', width: 960, maxLines: 4, scale: [104, 92, 80, 70, 62], hl: true }) +
      H.lead(ctx, a.subtitle, 34, { maxw: 820 })) +
      wrapB(MX, 110, 820, metaHtml);
    return { bg: bg + orn, fg: fg + H.folio(ctx), cls: 'cx-slide cx-cover' };
  },
});

/** Қисайған полароид + таспа, жанында ірі тақырып; фон — жартылай түсті панель */
def({
  id: 'cover-polaroid', kind: 'cover',
  fits: (a) => a.hasPhoto,
  render(ctx) {
    const a = ctx.a; const p = ctx.palette;
    const img = I.imgTag(a.photo, a.img, p, { focus: a.focus });
    const { metaHtml } = H.coverParts(ctx);
    const bg = '<div class="plate plate-cover"></div>' +
      P.panel(1160, 0, 760, 1080, P.mix(p.bg, p.accent, 0.16)) + P.grain(P.mix(p.bg, p.text, 0.07), 11) +
      P.polaroid(1040, 170, 700, 740, img, { rot: 4, tapeColor: P.mix(p.bg, p.accent2 || p.accent, 0.6) });
    const fg = wrap(MX, 230, 860,
      (H.sectionLabel(ctx) ? '<div class="cx-pill" data-role="kicker" style="display:inline-block;padding:10px 22px;border-radius:999px;border:2px solid var(--text);' + fs(20) + ';font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin-bottom:34px">' + esc(String(H.sectionLabel(ctx)).slice(0, 60)) + '</div>' : '') +
      H.titleH1(ctx, a.title, { role: 'display', width: 860, maxLines: 4, scale: [100, 88, 78, 68, 60], hl: true }) +
      H.lead(ctx, a.subtitle, 32, { maxw: 760 })) +
      wrapB(MX, 120, 820, metaHtml);
    return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide cx-cover' };
  },
});

/** Фотосыз мұқаба: жұқа қос жиектеме, ірі көмескі бас әріп, мағынасына сай ірі гравюра/белгіше */
def({
  id: 'cover-type', kind: 'cover',
  fits: (a) => !a.hasPhoto,
  render(ctx, sh, env) {
    const a = ctx.a; const p = ctx.palette;
    const v = P.visualFor(ctx.deckTitle + ' ' + a.title, ctx.sys, p, env.used, a.index + 1, { stroke: 0.8 });
    const { metaHtml } = H.coverParts(ctx);
    const first = (String(a.title).trim()[0] || '').toUpperCase();
    const bg = '<div class="plate plate-cover"></div>' + P.grain(P.mix(p.bg, p.text, 0.07)) +
      P.div('left:48px;top:48px;right:48px;bottom:48px;border:2px solid ' + P.mix(p.bg, p.text, 0.3) + ';outline:2px solid ' + P.mix(p.bg, p.text, 0.3) + ';outline-offset:-16px') +
      P.ghost(1180, 40, first, 900, P.mix(p.bg, p.accent, 0.12), { italic: true }) +
      (v ? P.visualImg(v, 1180, 380, 560, 560, { opacity: v.kind === 'icon' ? 0.9 : 0.85 }) : '');
    const fg = wrap(MX + 40, 250, 1040,
      H.kicker(ctx, H.sectionLabel(ctx)) +
      H.titleH1(ctx, a.title, { role: 'display', width: 1040, maxLines: 4, scale: [112, 98, 86, 74, 64], hl: true }) +
      H.lead(ctx, a.subtitle, 34, { maxw: 900 })) +
      wrapB(MX + 40, 130, 900, metaHtml);
    return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide cx-cover' };
  },
});

// ─────────────────────────────── ҰҒЫМДАР ───────────────────────────────

/** Арка-терезелер: әр ұғымға өз гравюрасы/белгішесі; астында термин мен факт */
def({
  id: 'concepts-arches', kind: 'concepts',
  fits: (a, sh) => sh.items.length >= 3 && sh.items.length <= 4 && sh.items.every((m) => m.label.length <= 22 && (m.detail || '').length <= 70),
  render(ctx, sh, env) {
    const a = ctx.a; const p = ctx.palette; const n = sh.items.length;
    const gap = n === 3 ? 56 : 40; const x0 = MX; const span = W - 2 * MX;
    const w = (span - gap * (n - 1)) / n; const y = 320; const h = n === 3 ? 470 : 430;
    const fills = [P.mix(p.bg, p.text, 0.08), p.accent, P.mix(p.bg, p.accent2 || p.accent, 0.3), P.mix(p.bg, p.text, 0.14)];
    let bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.06));
    let fg = wrap(MX, MT, 1300, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: 1300, maxLines: 2, scale: [80, 70, 62, 54, 48], hl: true }));
    const vis = P.visualsForAll(sh.items.map((m) => m.label + ' ' + (m.detail || '')), ctx.sys, p, env.used, a.index * 7,
      (i) => ({ color: i % fills.length === 1 ? p.accentInk : p.accent, stroke: 0.9 }));
    sh.items.forEach((m, i) => {
      const x = x0 + i * (w + gap); const yy = y + (n === 3 && i === 1 ? -30 : 0);
      const fill = fills[i % fills.length]; const dark = i % fills.length === 1;
      const v = vis[i];
      const inner = v ? P.visualImg(v, w * 0.14, h * 0.16, w * 0.72, h * 0.72, { filter: dark ? 'grayscale(1) contrast(1.4)' : 'sepia(.55) contrast(.95)' }) : '';
      bg += P.arch(x, yy, w, h, inner, { fill });
      bg += v ? P.ghost(x + 26, yy + h - 110, H.num(ctx, i + 1), 60, dark ? p.accentInk : p.accent, { italic: true })
        : P.div(P.pos(x, yy + h * 0.2, w, h * 0.8) + ';display:flex;align-items:center;justify-content:center;font-family:var(--f-display);font-style:italic;font-size:' + Math.round(Math.min(w * 0.62, 260)) + 'px;line-height:1;color:' + (dark ? p.accentInk : p.accent), esc(H.num(ctx, i + 1)));
      fg += t('concept', x, yy + h + 26, w,
        '<div style="' + disp + ';' + fs(n === 3 ? 46 : 40) + ';line-height:1.08;color:var(--text)">' + esc(m.label) + '</div>' +
        (m.detail ? '<div style="margin-top:10px;' + fs(n === 3 ? 27 : 25) + ';line-height:1.4;color:var(--text2)">' + esc(m.detail) + '</div>' : ''),
        'border-top:2px solid ' + P.mix(p.bg, p.text, 0.2) + ';padding-top:18px');
    });
    return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
  },
});

/** Бенто: бірінші ұғым — ірі түсті карточка, қалғаны — белгішелі шағын карточкалар */
def({
  id: 'concepts-bento', kind: 'concepts',
  fits: (a, sh) => sh.items.length >= 3 && sh.items.length <= 5 && sh.items.every((m) => m.label.length <= 30 && (m.detail || '').length <= 90),
  render(ctx, sh, env) {
    const a = ctx.a; const p = ctx.palette; const items = sh.items; const n = items.length;
    const titleW = 560; const gx = MX + titleW + 56; const gw = W - MX - gx; const gy = MT; const gh = HH - MT - MB; const gap = 24;
    const bigW = Math.round(gw * 0.38); const rest = items.slice(1); const cols = rest.length <= 2 ? 1 : 2; const rows = Math.ceil(rest.length / cols);
    const cw = (gw - bigW - gap - gap * (cols - 1)) / cols; const ch = (gh - gap * (rows - 1)) / rows;
    const card = P.mix(p.bg, '#ffffff', p.isLight ? 0.7 : 0.08);
    let bg = '<div class="plate"></div>' + P.panel(gx, gy, bigW, gh, p.accent, 'border-radius:32px');
    const v0 = P.visualFor(items[0].label + ' ' + (items[0].detail || ''), ctx.sys, p, env.used, a.index * 5, { color: p.accentInk, stroke: 0.8 });
    if (v0) bg += P.visualImg(v0, gx + bigW - 330, gy + 30, 300, 300, { opacity: 0.9, filter: 'grayscale(1) contrast(1.4)' });
    let fg = wrap(MX, MT + 10, titleW, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: titleW, maxLines: 5, scale: [72, 64, 56, 50, 44], hl: true }) + H.lead(ctx, a.subtitle, 28, { maxw: titleW }));
    fg += tb('concept', gx + 40, MB + 40, bigW - 80,
      '<div style="' + fs(20) + ';font-weight:700;letter-spacing:.14em;opacity:.75">' + esc(H.num(ctx, 1)) + '</div>' +
      '<div style="margin-top:12px;' + disp + ';' + fs(50) + ';line-height:1.05">' + esc(items[0].label) + '</div>' +
      (items[0].detail ? '<div style="margin-top:14px;' + fs(26) + ';line-height:1.4;opacity:.9">' + esc(items[0].detail) + '</div>' : ''), 'color:' + p.accentInk);
    rest.forEach((m, k) => {
      const c = k % cols; const r = Math.floor(k / cols);
      const wide = cols === 2 && rest.length === 3 && k === 2;
      const x = gx + bigW + gap + c * (cw + gap); const y = gy + r * (ch + gap); const w = wide ? cw * 2 + gap : cw;
      bg += P.panel(x, y, w, ch, card, 'border-radius:28px;box-shadow:0 1px 0 ' + P.mix(p.bg, p.text, 0.1));
      const v = P.visualFor(m.label + ' ' + (m.detail || ''), ctx.sys, p, env.used, a.index * 5 + k + 1, { stroke: 1.5 });
      const cs = v && v.kind === 'engraving' ? 130 : 84; // гравюра ұсақ шеңберде көрінбейді
      bg += P.div(P.pos(x + 32, y + 30, cs, cs) + ';border-radius:50%;background:' + P.mix(p.bg, p.accent, 0.16));
      if (v) bg += P.visualImg(v, x + 32 + cs * 0.17, y + 30 + cs * 0.17, cs * 0.66, cs * 0.66);
      else bg += P.ghost(x + 56, y + 40, String(k + 2), 54, p.accent, { weight: 700 });
      fg += tb('concept', x + 32, HH - (y + ch) + 28, w - 64,
        '<div style="' + disp + ';' + fs(rows > 1 ? 38 : 46) + ';line-height:1.08;color:var(--text)">' + esc(m.label) + '</div>' +
        (m.detail ? '<div style="margin-top:10px;' + fs(rows > 1 ? 25 : 28) + ';line-height:1.4;color:var(--text2)">' + esc(m.detail) + '</div>' : ''));
    });
    return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
  },
});

/** Билеттер: толқын жол бойында ромб түйіндер, баспалдақ тәрізді жыртық шетті карточкалар */
function ticketsRender(ctx, sh, env, dates) {
  const a = ctx.a; const p = ctx.palette; const items = sh.items; const n = items.length;
  const gap = 44; const span = W - 2 * MX; const w = (span - gap * (n - 1)) / n;
  const fills = [P.mix(p.bg, '#ffffff', p.isLight ? 0.6 : 0.06), p.accent, P.mix(p.text, p.bg, 0.12)];
  const inks = ['var(--text)', p.accentInk, p.bg];
  const offs = n === 3 ? [20, 90, 0] : [20, 90, 0, 70];
  let bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.06)) + P.wave(0, 380, W, 120, p.accent, a.index + 2);
  let fg = wrap(MX, MT, 1300, H.kicker(ctx, H.sectionLabel(ctx)) + H.titleH1(ctx, a.title, { width: 1240, maxLines: 2, scale: [80, 70, 62, 54, 48], hl: true }));
  const vis = P.visualsForAll(items.map((m) => (m.label || '') + ' ' + (m.detail || '')), ctx.sys, p, env.used, a.index * 3 + 1,
    (i) => ({ color: i % 3 === 0 ? p.accent : (i % 3 === 1 ? p.accentInk : p.bg), stroke: 1 }));
  const th = vis.some(Boolean) ? 470 : 420;
  items.forEach((m, i) => {
    const x = MX + i * (w + gap); const y = 410 + offs[i];
    const fill = fills[i % 3]; const ink = inks[i % 3];
    bg += P.diamond(x + 34, y - 30, 26, i % 3 === 1 ? p.accent : P.mix(p.text, p.bg, 0.2), p.bg);
    bg += P.panel(x, y, w, th, fill, 'clip-path:' + P.ticket(16, 4) + (i % 3 === 0 ? ';box-shadow:0 20px 30px -24px rgba(0,0,0,.4)' : ''));
    if (!vis[i]) bg += P.ghost(x, y + th - (n === 3 ? 170 : 140), H.num(ctx, i + 1), n === 3 ? 150 : 120, i % 3 === 0 ? P.mix(p.bg, p.accent, 0.3) : P.mix(fill, ink === 'var(--text)' ? p.text : (i % 3 === 1 ? p.accentInk : p.bg), 0.25), { italic: true, w: w - 36 });
    if (vis[i]) bg += P.visualImg(vis[i], x + w - 250, y + th - 260, 220, 220, { opacity: i % 3 === 2 ? 0.75 : 0.9, dark: i % 3 === 2, filter: i % 3 === 0 ? 'sepia(.55) contrast(.95)' : 'grayscale(1) contrast(1.3)' });
    const big = dates ? m.date : m.label;
    const small = dates ? m.label : '';
    fg += t('concept', x + 36, y + 38, w - 72,
      '<div style="' + disp + ';' + fs(dates ? 96 : (n === 3 ? 58 : 50)) + ';line-height:1.02;color:' + ink + '">' + esc(big) + '</div>' +
      (small ? '<div style="margin-top:16px;' + fs(20) + ';font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:' + ink + ';opacity:.8">' + esc(small) + '</div>' : '') +
      (m.detail ? '<div style="margin-top:16px;' + fs(n === 3 ? 30 : 26) + ';line-height:1.42;color:' + ink + ';opacity:.9;max-width:' + Math.round(w - 72 - (vis[i] ? 150 : 0)) + 'px">' + esc(m.detail) + '</div>' : ''));
  });
  return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
}
def({
  id: 'concepts-tickets', kind: 'concepts',
  fits: (a, sh) => sh.items.length >= 3 && sh.items.length <= 4 && sh.items.every((m) => m.label.length <= 26 && (m.detail || '').length <= 90),
  render: (ctx, sh, env) => ticketsRender(ctx, sh, env, false),
});
def({
  id: 'timeline-tickets', kind: 'timeline',
  fits: (a, sh) => sh.items.every((m) => (m.label + (m.detail || '')).length <= 110),
  render: (ctx, sh, env) => ticketsRender(ctx, sh, env, true),
});

// ─────────────────────────────── ДӘЙЕКСӨЗ ───────────────────────────────

function quoteParts(a) {
  const text = a.subtitle || a.body || a.title;
  const who = a.subtitle || a.body ? a.title : '';
  return { text, who };
}
def({
  id: 'quote-photo', kind: 'quote',
  fits: (a) => a.hasPhoto && quoteParts(a).text.length <= 220,
  render(ctx) {
    const a = ctx.a; const p = ctx.palette; const { text, who } = quoteParts(a);
    const dark = '#10201f';
    const bg = '<div class="full">' + I.imgTag(a.photo, a.img, p, { focus: a.focus }) + '</div>' +
      P.div('inset:0;background:linear-gradient(90deg,' + dark + 'f2 0%,' + dark + 'cc 46%,' + dark + '1a 82%)') +
      P.ghost(MX - 10, 20, '“', 380, p.accent2 || p.accent);
    const size = text.length <= 80 ? 76 : text.length <= 140 ? 62 : 52;
    const fg = t('title', MX + 20, 330, 1000, esc(text), disp + ';font-style:italic;' + fs(size) + ';line-height:1.16;color:#f4efe6') +
      (who ? tb('lead', MX + 20, MB + 60, 900, '<span style="display:inline-block;width:70px;height:3px;background:' + (p.accent2 || p.accent) + ';vertical-align:middle;margin-right:22px"></span>' + esc(who), fs(24) + ';font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#f4efe6') : '');
    return { bg, fg: fg, cls: 'cx-slide cx-dark' };
  },
});
def({
  id: 'quote-paper', kind: 'quote',
  fits: (a) => quoteParts(a).text.length <= 240,
  render(ctx, sh, env) {
    const a = ctx.a; const p = ctx.palette; const { text, who } = quoteParts(a);
    const v = P.visualFor(text + ' ' + who, ctx.sys, p, env.used, a.index + 5, { stroke: 0.8 });
    const bg = '<div class="plate"></div>' + P.grain(P.mix(p.bg, p.text, 0.07)) +
      P.panel(1240, 0, 680, 1080, P.mix(p.bg, p.text, 0.07)) +
      (v ? P.visualImg(v, 1330, 250, 500, 560, { opacity: 0.9 }) : P.ghost(1300, 100, '”', 800, P.mix(p.bg, p.accent, 0.25))) +
      P.ghost(MX - 14, 60, '“', 300, p.accent);
    const size = text.length <= 80 ? 74 : text.length <= 150 ? 60 : 50;
    const fg = t('title', MX + 10, 330, 1000, esc(text), disp + ';font-style:italic;' + fs(size) + ';line-height:1.18;color:var(--text)') +
      (who ? tb('lead', MX + 10, MB + 60, 900, '<span style="display:inline-block;width:70px;height:3px;background:' + p.accent + ';vertical-align:middle;margin-right:22px"></span>' + esc(who), fs(24) + ';font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--text2)') : '');
    return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
  },
});

// ─────────────────────────────── ФОТО + ТІЗІМ ───────────────────────────────

/** Слайдтың жартысы — фото (жиегінен шыға), екінші жартысы — нөмірленген «термин — факт» қатарлары */
def({
  id: 'photo-half', kind: 'photoList',
  fits: (a) => a.hasPhoto,
  render(ctx, sh) {
    const a = ctx.a; const p = ctx.palette; const flip = !!(ctx.plan && ctx.plan.flip);
    const pw = 820; const px0 = flip ? W - pw : 0;
    const tx = flip ? MX : pw + 96; const tw = W - MX - tx - (flip ? pw + 96 - MX : 0);
    const bg = '<div class="plate"></div>' + P.div(P.pos(px0, 0, pw, HH) + ';overflow:hidden', I.imgTag(a.photo, a.img, p, { focus: a.focus })) +
      P.panel(flip ? W - pw - 14 : pw, 0, 14, HH, p.accent);
    const n = sh.items.length; const big = n <= 3;
    const rows = sh.items.map((m, i) => '<div data-role="row" style="display:flex;gap:28px;padding:' + (big ? 24 : 18) + 'px 0;border-top:2px solid ' + P.mix(p.bg, p.text, 0.16) + '">' +
      '<div style="flex:none;width:64px;' + disp + ';font-style:italic;' + fs(big ? 52 : 44) + ';line-height:1;color:' + p.accent + '">' + esc(H.num(ctx, i + 1)) + '</div>' +
      '<div><div style="' + disp + ';' + fs(big ? 42 : 36) + ';line-height:1.12;color:var(--text)">' + esc(m.label) + '</div>' +
      (m.detail ? '<div style="margin-top:6px;' + fs(big ? 26 : 24) + ';line-height:1.4;color:var(--text2)">' + esc(m.detail) + '</div>' : '') + '</div></div>').join('');
    const fg = '<div style="position:absolute;left:' + tx + 'px;top:' + MT + 'px;bottom:' + MB + 'px;width:' + tw + 'px;display:flex;flex-direction:column;justify-content:center">' +
      H.kicker(ctx, H.sectionLabel(ctx)) +
      H.titleH1(ctx, a.title, { width: tw, maxLines: 3, scale: [72, 64, 56, 50, 44], hl: true }) +
      H.lead(ctx, a.subtitle, 28, { maxw: tw }) +
      '<div style="margin-top:34px">' + rows + '</div></div>';
    return { bg, fg: fg + H.folio(ctx), cls: 'cx-slide' };
  },
});

require('./more')(def, { P, H, I, esc, t, tb, fs, disp, wrap, wrapB, MX, MT, MB, W, HH });

/**
 * Композиция таңдау. env: { used:Set (әшекей), comps:Set (колодада қолданылған), recent:string[], seed:number }
 * Қайтарады { id, out } не null.
 */
const hash = (s) => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; };
/** Слайдтың ішкі нұсқасы: тұқым + слайд нөмірі + композиция (+ визуал тексеріс сұраған қайта жасау) */
function variantFor(env, a, id, cx) {
  const r = P.rng((env.seed || 0) * 31 + a.index * 977 + hash(id) + (cx.seed || 0) * 7919);
  const pick = (xs) => xs[Math.floor(r() * xs.length) % xs.length];
  return {
    texture: pick(['grain', 'lines', 'grid', 'plain', 'hatch', 'grain']),
    frame: pick(['arch', 'arch', 'rounded', 'pill', 'notch']),
    tilt: r() < 0.5 ? 1 : -1,
    teeth: pick([12, 14, 16, 20]),
    num: pick(['pad', 'roman', 'plain', 'dot', 'pad']),
    mirror: r() < 0.5,
    noDecor: !!cx.noDecor,
  };
}
// Айналы нұсқасы бар композициялар (элементтердің бәрі left+width-пен орналасқан → дәл шағылысады)
const MIRROR_SAFE = new Set(['cover-arch', 'cover-polaroid', 'statement-arch', 'photo-polaroid']);
/** Айна: абсолют элементтің left-і → W − left − width (мәтін тураланымы өзгермейді) */
function mirrorHtml(html) {
  return String(html || '').replace(/style="([^"]*)"/g, (m, st) => {
    if (!/position:absolute/.test(st) || /(^|;)\s*right:/.test(st)) return m;
    const l = st.match(/(^|;)\s*left:(-?\d+(?:\.\d+)?)px/); const w = st.match(/(^|;)\s*width:(\d+(?:\.\d+)?)px/);
    if (!l || !w) return m;
    const nl = Math.round(W - Number(l[2]) - Number(w[2]));
    return 'style="' + st.replace(/(^|;)(\s*)left:-?\d+(?:\.\d+)?px/, '$1$2left:' + nl + 'px') + '"';
  });
}

function compose(ctx, env) {
  const sh = shapeOf(ctx.a);
  if (!sh) return null;
  const cx = (ctx.a.slideRef && ctx.a.slideRef.composition && ctx.a.slideRef.composition.cx) || {};
  const avoid = Array.isArray(cx.avoid) ? cx.avoid : [];
  // визуал тексерістен кейін: тексеруден өткен слайд сол композицияда қалады (pin)
  const pinned = cx.pin ? COMPS.find((c) => c.id === cx.pin && c.kind === sh.kind && safeFits(c, ctx.a, sh, ctx.sys)) : null;
  const cands = pinned ? [pinned] : COMPS.filter((c) => c.kind === sh.kind && !avoid.includes(c.id) && !(c.systems && !c.systems.includes(ctx.sys && ctx.sys.id)) && safeFits(c, ctx.a, sh, ctx.sys));
  if (!cands.length) return null;
  const fresh = pinned ? cands : cands.filter((c) => !env.comps.has(c.id));
  const pool0 = fresh.length ? fresh : (sh.kind === 'concepts' ? [] : cands);
  if (!pool0.length) return null;
  const notRecent = pinned ? pool0 : pool0.filter((c) => !(env.recent || []).includes(c.id));
  const pool = notRecent.length ? notRecent : pool0;
  const c = pool[Math.abs((env.seed || 0) + ctx.a.index * 7 + (cx.seed || 0)) % pool.length];
  const v = variantFor(env, ctx.a, c.id, cx);
  P.setVariant(v);
  try {
    // нөмірлеу стилі де нұсқаға қарай (блюпринттің [01]-і — жүйенің қолтаңбасы, өзгермейді)
    const vctx = ctx.sys && ctx.sys.num === 'bracket' ? ctx : Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, { sys: Object.assign({}, ctx.sys, { num: v.num }) });
    let out = c.render(vctx, sh, env);
    if (v.mirror && MIRROR_SAFE.has(c.id)) out = { ...out, bg: mirrorHtml(out.bg), fg: mirrorHtml(out.fg) };
    env.comps.add(c.id);
    return { id: c.id, out, variant: v };
  } catch (err) {
    console.warn('[Compose] ' + c.id + ' failed on slide ' + (ctx.a.index + 1) + ': ' + err.message);
    return null;
  } finally { P.setVariant(null); }
}
function safeFits(c, a, sh, sys) { try { return !!c.fits(a, sh, sys); } catch { return false; } }

module.exports = { compose, shapeOf, COMPS, CSS: P.CSS, mirrorHtml, variantFor };
