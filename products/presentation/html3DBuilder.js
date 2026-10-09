'use strict';
/**
 * DeadLine presentation builder — thin orchestrator over the design system.
 *
 *   CONTENT   (slide JSON)            → design/analyze.js   content analysis, slide type, deck plan
 *   LAYOUT    (12-col grid)           → design/layouts.js   one composition per slide type
 *   STYLE     (tokens → CSS)          → design/tokens.js + design/style.js + design/typography.js
 *   ASSETS    (photos, fonts, SVG)    → design/imagery.js + pipeline/assets
 *   RENDERING (HTML + runtime + QA)   → this file, design/runtime.js, design/qa.js
 *
 * The public API is unchanged: build3DPresentationHTML(slides, title[, opts]).
 * If the new engine throws for any reason the legacy builder is used, so a deck is never lost.
 */
const T = require('./design/tokens');
const A = require('./design/analyze');
const { L, makeCtx, esc } = require('./design/layouts');
const { css, paletteVars } = require('./design/style');
const { QA_SCRIPT, reviewDeckPlan } = require('./design/qa');
const RUNTIME = require('./design/runtime');
const { refIndexFor } = require('../../design-dna/skin');

const safeColor = T.safeColor;
const isVisualSvg = A.isVisualSvg;
const parseStatNumber = A.parseStatNumber;

// ── palette ────────────────────────────────────────────────────────────────
function pickPalette(mood, accent, style) {
  const p = T.buildPalette(mood, accent, style);
  // legacy field names are kept for callers that still read them
  return Object.assign({}, p, { muted: T.rgba(p.text, 0.62), surface: T.rgba(p.text, 0.06), wash: 'transparent' });
}
/** Single source of truth for SVG visuals (visual.js) — same palette as the deck. */
function slideSvgPalette(slide) {
  const c = (slide && slide.composition) || {};
  const p = T.buildPalette(c.mood || 'dark', c.accentColor, '');
  return {
    bg: p.bg, panel: T.mixHex(p.bg, p.text, 0.06), text: p.text, muted: T.mixHex(p.text, p.bg, 0.42),
    line: T.mixHex(p.bg, p.text, 0.22), accent: p.accent, accentSoft: T.mixHex(p.bg, p.accent, 0.28),
  };
}

/** One palette for the whole deck: dominant mood, cover accent (coherent, never per-object). */
function deckPalette(slides, style) {
  const moods = {}; const accents = {};
  slides.forEach((s, i) => {
    const c = (s && s.composition) || {};
    if (c.mood) moods[String(c.mood).toLowerCase()] = (moods[String(c.mood).toLowerCase()] || 0) + (i === 0 ? 2 : 1);
    const a = safeColor(c.accentColor, null);
    if (a) accents[a] = (accents[a] || 0) + (i === 0 ? 2 : 1);
  });
  const top = (o) => Object.keys(o).sort((x, y) => o[y] - o[x])[0];
  return T.buildPalette(top(moods) || 'dark', top(accents) || null, style);
}

function chooseLayout(slide, index, total) {
  const a = A.analyzeSlide(slide, index || 0, total || 99);
  return A.LAYOUT_FOR[A.classify(a)] || 'statement';
}
function chooseCam(index) { return ['through', 'jump', 'rise', 'punch', 'soft', 'jump'][index % 6]; }

/** Background decoration — only on plain (photo-less) slides, so photos stay clean. Position rotates per slide. */
function decoFor(bg, palette, index) {
  if (!palette.deco || palette.deco === 'none') return '';
  if (String(bg || '').indexOf('class="plate') === -1 || String(bg || '').indexOf('class="bleed') !== -1) return '';
  return '<div class="deco deco-' + palette.deco + ' dp-' + (index % 4) + '"></div>';
}

function skinShapes(skin, layoutName, index, total) {
  if (!skin || !skin.shapes || !skin.shapes.length) return '';
  if (layoutName === 'fullImage') return '';
  const exact = skin.slideCount === total; // референспен слайд саны тең болса, әр слайдтағы бар-жоғы дәл көшіріледі
  return skin.shapes.filter((s) => (exact && s.present ? s.present.includes(index) : index !== 0))
    .map((s) => '<div class="ref-el ref-' + s.type + '" style="left:' + s.x + 'px;top:' + s.y + 'px;width:' + s.w + 'px;height:' + s.h + 'px;background:' + (T.safeColor(s.color, '#888888')) + '"></div>').join('');
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const px1 = (v, d) => Math.round(v * d);

/** Референс слайдының безендіруі: фон + декор элементтері (HTML) және мазмұн жиектері (CSS айнымалылар) */
function decorHtml(skin, ref, layoutName, index, mediaIds, palette) {
  const d = skin && skin.decor; const sd = d && d.slides[ref];
  if (!sd) return { html: '', vars: '' };
  let html = '';
  if (sd.bg) {
    if (sd.bg.media && mediaIds[sd.bg.media] != null) html += '<div class="ref-bg dm dm' + mediaIds[sd.bg.media] + '" style="background-size:cover;background-position:center"></div>';
    else if (sd.bg.color) html += '<div class="ref-bg" style="background:' + T.safeColor(sd.bg.color, '#ffffff') + '"></div>';
  }
  if (layoutName !== 'fullImage') {
    html += sd.items.map((it) => {
      const tf = (it.rot ? 'rotate(' + it.rot + 'deg)' : '') + (it.fh ? ' scaleX(-1)' : '') + (it.fv ? ' scaleY(-1)' : '');
      const pos = 'left:' + px1(it.x, 1920) + 'px;top:' + px1(it.y, 1080) + 'px;width:' + px1(it.w, 1920) + 'px;height:' + px1(it.h, 1080) + 'px' + (tf ? ';transform:' + tf.trim() : '');
      const col = (f) => (f ? T.safeColor(f.c, '#888888') : 'none');
      if (it.t === 'img') {
        if (mediaIds[it.media] == null) return '';
        const c = it.crop; let bs = '100% 100%'; let bp = '0 0';
        if (c && (c.l || c.r || c.t || c.b)) {
          const kw = 1 - c.l - c.r; const kh = 1 - c.t - c.b;
          if (kw > 0.05 && kh > 0.05) {
            bs = (100 / kw).toFixed(2) + '% ' + (100 / kh).toFixed(2) + '%';
            bp = ((c.l + c.r) > 0 ? (c.l / (c.l + c.r)) * 100 : 0).toFixed(2) + '% ' + ((c.t + c.b) > 0 ? (c.t / (c.t + c.b)) * 100 : 0).toFixed(2) + '%';
          }
        }
        return '<div class="ref-dec dm dm' + mediaIds[it.media] + '" style="' + pos + ';background-size:' + bs + ';background-position:' + bp + (it.prst === 'ellipse' ? ';border-radius:50%' : '') + '"></div>';
      }
      if (it.t === 'path') {
        return '<svg class="ref-dec" viewBox="0 0 ' + it.vw + ' ' + it.vh + '" preserveAspectRatio="none" style="' + pos + '"><path d="' + String(it.d).replace(/[^MLCQZ0-9 .\-]/g, '') + '" fill="' + col(it.fill) + '"' + (it.fill && it.fill.a < 1 ? ' fill-opacity="' + it.fill.a + '"' : '') + (it.stroke ? ' stroke="' + col(it.stroke) + '" stroke-width="' + (it.sw || 1) + '" vector-effect="non-scaling-stroke"' : '') + '/></svg>';
      }
      const br = it.prst === 'ellipse' ? ';border-radius:50%' : /^round/i.test(it.prst) ? ';border-radius:14px' : '';
      if (it.prst === 'line') {
        const c = it.stroke || it.fill;
        return '<div class="ref-dec" style="' + pos + ';' + (it.h < it.w ? 'height:' + Math.max(2, it.sw || 2) + 'px' : 'width:' + Math.max(2, it.sw || 2) + 'px') + ';background:' + col(c) + '"></div>';
      }
      return '<div class="ref-dec" style="' + pos + br + (it.fill ? ';background:' + col(it.fill) + (it.fill.a < 1 ? ';opacity:' + it.fill.a : '') : '') + (it.stroke ? ';border:' + (it.sw || 1) + 'px solid ' + col(it.stroke) : '') + '"></div>';
    }).join('');
  }
  // мазмұн аумағы (cover-де тек мәтін; фотоны бөлек орналастырамыз)
  const box = index === 0 ? (sd.tbox || sd.box) : sd.box;
  let vars = '';
  if (box && layoutName !== 'fullImage') {
    let l = clamp(box.x * 1920, 72, 900); let r = clamp((1 - box.x - box.w) * 1920, 72, 900);
    const t = clamp(box.y * 1080, 56, 320); const b = clamp((1 - box.y - box.h) * 1080, 56, 320);
    const minW = index === 0 ? 760 : 1000;
    if (1920 - l - r < minW) { const k = (1920 - minW) / (l + r); l *= k; r *= k; }
    vars = '--cl:' + Math.round(l) + 'px;--cr:' + Math.round(r) + 'px;--ct:' + Math.round(t) + 'px;--cb:' + Math.round(b) + 'px;';
  }
  if (sd.pics && sd.pics[0] && sd.pics[0].w > 0.08) vars += '--cw:' + Math.round(Math.min(sd.pics[0].w, sd.pics[0].h * 1920 / 1080 * 1.2) * 1920) + 'px;';
  // мәтін түсі: референс слайдында мәтін глобалдан басқа (мыс. қара панельде ақ) болса — сол слайдқа көшіреміз
  if (sd.ink && palette && layoutName !== 'fullImage') {
    const ink = T.safeColor(sd.ink, null);
    if (ink && Math.abs(relLum(ink) - relLum(palette.text)) > 0.4) {
      const mix = (p) => 'color-mix(in srgb,' + ink + ' ' + p + '%,transparent)';
      vars += '--text:' + ink + ';--muted:' + mix(66) + ';--text2:' + mix(74) + ';--text3:' + mix(52) + ';--line:' + mix(30) + ';--line-soft:' + mix(16) + ';--surface:' + mix(8) + ';';
    }
  }
  return { html, vars };
}
function relLum(h) {
  const m = String(h || '').replace('#', ''); if (m.length < 6) return 0.5;
  const c = [0, 2, 4].map((i) => { const v = parseInt(m.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function mediaTable(skin) {
  const ids = {}; let css = '';
  const d = skin && skin.decor; if (!d) return { ids, css };
  Object.keys(d.media).forEach((k, i) => { ids[k] = i; css += '.dm' + i + '{background-image:url(' + d.media[k].uri + ')}'; });
  return { ids, css };
}

const STACK_OF = { points: 'stackPoints', editorial: 'stackPoints', split: 'stackSplit', closing: 'stackPoints', references: 'stackRefs' };

function renderSlide(slide, index, plan, ctxDeck) {
  const { palette, ts, deckTitle } = ctxDeck;
  let layoutName = plan.layout;
  if (ctxDeck.skin && ctxDeck.skin.titleTop && STACK_OF[layoutName] && index > 0) layoutName = STACK_OF[layoutName];
  const a = plan.a; a.slideRef = slide;
  if (ctxDeck.skin && ctxDeck.skin.decor && index === 0 && ctxDeck.skin.coverPic && a.hasPhoto) {
    const cp = ctxDeck.skin.coverPic;
    plan.refCover = { shape: cp.shape, x: px1(cp.x, 1920), y: px1(cp.y, 1080), w: px1(cp.w, 1920), h: px1(cp.h, 1080) };
  }
  if (ctxDeck.skin && ctxDeck.skin.photoShape === 'circle' && layoutName === 'imageFocus') layoutName = 'split';
  let out;
  try {
    out = (L[layoutName] || L.statement)(makeCtx(a, plan, palette, ts, deckTitle));
  } catch (err) {
    console.warn('[Design] layout "' + layoutName + '" failed on slide ' + (index + 1) + ': ' + err.message + ' → statement');
    layoutName = 'statement';
    out = L.statement(makeCtx(a, plan, palette, ts, deckTitle));
  }
  const cam = chooseCam(index);
  const accent = palette.accent;
  const sk = ctxDeck.skin;
  const dec = sk && sk.decor ? decorHtml(sk, refIndexFor(sk, index, ctxDeck.total, ctxDeck.roles), layoutName, index, ctxDeck.mediaIds, palette) : { html: '', vars: '' };
  return '<article class="slide L-' + layoutName + ' ' + (out.cls || '') + ' cam-' + cam + (index === 0 ? ' is-active' : '') +
    '" data-index="' + index + '" data-layout="' + layoutName + '" data-type="' + plan.type + '" data-cam="' + cam + '" data-accent="' + accent +
    '" style="' + paletteVars(palette) + dec.vars + '"><div class="layer layer-bg" data-depth="0.12">' + (out.bg || '') + decoFor(out.bg, palette, index) + (sk && sk.decor ? dec.html : skinShapes(ctxDeck.skin, layoutName, index, ctxDeck.total)) +
    '</div><div class="layer layer-mid" data-depth="0.4">' + out.fg + '</div></article>';
}

function skinStage(skin, palette) {
  if (!skin) return '';
  const cls = ['ref-skin'];
  if (skin.flat) cls.push('ref-flat');
  if (skin.decor) cls.push('ref-decor');
  if (skin.photoShape === 'circle') cls.push('ref-circle');
  if (skin.titleAlign === 'center') cls.push('ref-title-center');
  if (skin.bodyAlign === 'justify') cls.push('ref-body-justify');
  if (skin.folio === 'none') cls.push('ref-folio-none');
  else if (/^num-/.test(skin.folio || '')) cls.push('ref-folio-num', 'ref-folio-' + skin.folio.slice(4));
  const vars = [];
  if (skin.bottomBar) vars.push('--ref-bb:' + skin.bottomBar + 'px');
  if (skin.cardFill) {
    const fill = T.safeColor(skin.cardFill, null);
    if (fill) {
      cls.push('ref-cards');
      const ink = T.contrast('#111111', fill) >= T.contrast('#ffffff', fill) ? '#161616' : '#ffffff';
      vars.push('--card-fill:' + fill, '--card-ink:' + ink);
      if (skin.cardH) vars.push('--card-h:' + Math.min(560, Math.max(180, skin.cardH)) + 'px');
    }
  }
  return ' class="' + cls.join(' ') + '"' + (vars.length ? ' style="' + vars.join(';') + '"' : '');
}

function build3DPresentationHTML(slides, presentationTitle, opts) {
  try {
    return buildNew(slides, presentationTitle, opts || {});
  } catch (err) {
    console.warn('[Design] engine failed, using legacy builder:', err && err.stack ? err.stack : err);
    return require('./html3DBuilder.legacy').build3DPresentationHTML(slides, presentationTitle);
  }
}

function buildNew(slides, presentationTitle, opts) {
  const list = Array.isArray(slides) ? slides : [];
  const palette = deckPalette(list, opts.style);
  const ts = T.typeStyleFor(palette);
  const deckTitle = presentationTitle || (list[0] && list[0].title) || 'Presentation';
  const plan = A.planDeck(list);
  const warnings = reviewDeckPlan(plan);
  if (warnings.length) console.warn('[Design] deck review: ' + warnings.join(' | '));
  if (process.env.DESIGN_DEBUG) console.log('[Design] plan: ' + plan.map((p, i) => (i + 1) + ':' + p.layout).join(' '));
  const skin = opts.skin || null;
  const mt = mediaTable(skin);
  const ctxDeck = { palette, ts, deckTitle, skin, total: list.length, mediaIds: mt.ids, roles: opts.refRoles || null };
  const slidesHTML = list.map((s, i) => renderSlide(s, i, plan[i], ctxDeck)).join('');
  const total = String(Math.max(list.length, 1)).padStart(2, '0');
  return '<!DOCTYPE html><html lang="kk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="theme-color" content="' + palette.bg + '"><title>' + esc(deckTitle) + '</title><style>' + css(palette, ts) + mt.css + '</style></head><body>' +
    '<div id="frame"><div id="stage"' + skinStage(skin, palette) + '>' + slidesHTML +
    '<div id="topbar" hidden><span id="cur">01</span><span id="total">' + total + '</span></div>' +
    '<div id="dots"></div><div id="controls"><button class="ctrl" id="prev" type="button">‹</button><button class="ctrl" id="next" type="button">›</button><button class="ctrl" id="full" type="button">⛶</button></div>' +
    '<div id="hint">← → · swipe · wheel</div><div id="progress"></div></div></div>' +
    '<script>' + RUNTIME + '</script><script>' + QA_SCRIPT + '</script></body></html>';
}

module.exports = { build3DPresentationHTML, slideSvgPalette, isVisualSvg, pickPalette, safeColor, chooseLayout, parseStatNumber };
