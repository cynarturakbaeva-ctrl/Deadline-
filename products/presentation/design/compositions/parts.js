'use strict';
/**
 * КОМПОЗИЦИЯ БӨЛШЕКТЕРІ — «Канва» деңгейіндегі слайдтар құралатын қайталанбалы әшекей элементтері.
 * Барлығы фон қабатына түседі (data-role жоқ → QA өлшемейді, PPTX-те фон суретіне кіреді, мәтін емес).
 * Мәтін бұл жерде ЖОҚ: мағыналы жазу тек композицияның өзінде, өңделетін мәтін ретінде.
 *
 * Координаттар — слайдтың 1920×1080 px кеңістігінде. Түстер палитрадан (CSS айнымалылары не hex).
 */
const T = require('../tokens');
const D = require('../decor');

const px = (v) => Math.round(v) + 'px';

/**
 * Слайдтың ішкі нұсқасы (compose() әр слайд алдында қояды): бір композиция әр жолы басқаша көрінеді —
 * фон текстурасы, жақтау пішіні, қисаю бағыты, билет тістері; noDecor — визуал тексеріс «әшекей артық» десе.
 */
const DEFAULT_V = { texture: 'grain', frame: 'arch', tilt: 1, teeth: 16, noDecor: false };
let V = DEFAULT_V;
function setVariant(v) { V = Object.assign({}, DEFAULT_V, v || {}); }
const pos = (x, y, w, h) => 'left:' + px(x) + ';top:' + px(y) + (w != null ? ';width:' + px(w) : '') + (h != null ? ';height:' + px(h) : '');
const div = (style, inner = '', cls = '') => '<div class="cx-part' + (cls ? ' ' + cls : '') + '" aria-hidden="true" style="position:absolute;' + style + '">' + inner + '</div>';

/** Тұқымға тәуелді кездейсоқ сан (бір слайд әр рендерде бірдей, әр слайд әртүрлі) */
function rng(seed) {
  let x = (Number(seed) || 1) * 9301 + 49297;
  return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
}

/** Жыртық қағаз шеті: clip-path polygon (edge: top | bottom), depth — % биіктік */
function torn(seed, edge = 'top', depth = 12, teeth = 18) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i <= teeth; i++) {
    const x = (i / teeth) * 100;
    const d = (0.25 + r() * 0.75) * depth;
    pts.push(x.toFixed(1) + '% ' + (edge === 'top' ? d : 100 - d).toFixed(1) + '%');
  }
  return edge === 'top'
    ? 'polygon(' + pts.join(',') + ',100% 100%,0 100%)'
    : 'polygon(0 0,100% 0,' + pts.reverse().join(',') + ')';
}
/** Билет: төменгі жиегі тісті */
function ticket(teeth = 14, depth = 5) {
  teeth = V.teeth || teeth;
  const pts = [];
  for (let i = teeth; i >= 0; i--) pts.push(((i / teeth) * 100).toFixed(1) + '% ' + (i % 2 ? 100 - depth : 100) + '%');
  return 'polygon(0 0,100% 0,' + pts.join(',') + ')';
}

/** Күн шұғыласы: орталықтан тараған жіңішке сәулелер (дақ емес, сызық) */
function sunburst(cx, cy, r, color, o = {}) {
  const n = o.rays || 26; const from = o.from == null ? 180 : o.from; const to = o.to == null ? 360 : o.to;
  let lines = '';
  for (let i = 0; i <= n; i++) {
    const t = ((from + ((to - from) * i) / n) * Math.PI) / 180;
    const r0 = r * (o.inner || 0.18);
    lines += '<line x1="' + (r + Math.cos(t) * r0).toFixed(1) + '" y1="' + (r + Math.sin(t) * r0).toFixed(1) + '" x2="' + (r + Math.cos(t) * r).toFixed(1) + '" y2="' + (r + Math.sin(t) * r).toFixed(1) + '"/>';
  }
  return div(pos(cx - r, cy - r, r * 2, r * 2) + ';opacity:' + (o.opacity || 0.5),
    '<svg viewBox="0 0 ' + r * 2 + ' ' + r * 2 + '" width="100%" height="100%"><g stroke="' + color + '" stroke-width="' + (o.stroke || 2.4) + '" stroke-linecap="round">' + lines + '</g></svg>');
}

/** Арка (терезе) — ішінде фото не сурет; outline — ығыстырылған жұқа доға-сызық */
function arch(x, y, w, h, inner, o = {}) {
  // жақтау пішіні нұсқаға қарай: арка | дөңгелек бұрыш | капсула | қиық бұрыш
  const f = o.frame || V.frame;
  let shape = 'border-radius:' + px(w / 2) + ' ' + px(w / 2) + ' ' + (o.foot || 0) + 'px ' + (o.foot || 0) + 'px';
  if (f === 'rounded') shape = 'border-radius:' + px(Math.min(48, w * 0.12));
  else if (f === 'pill' && h >= w) shape = 'border-radius:' + px(w / 2);
  else if (f === 'notch') { const c = Math.round(Math.min(w, h) * 0.16); shape = 'clip-path:polygon(' + c + 'px 0,calc(100% - ' + c + 'px) 0,100% ' + c + 'px,100% calc(100% - ' + c + 'px),calc(100% - ' + c + 'px) 100%,' + c + 'px 100%,0 calc(100% - ' + c + 'px),0 ' + c + 'px)'; }
  let out = '';
  if (o.outline && f !== 'notch') out += div(pos(x + (o.dx || 22), y - (o.dy || 22), w, h) + ';border:2px solid ' + o.outline + ';' + shape);
  out += div(pos(x, y, w, h) + ';' + shape + ';overflow:hidden;background:' + (o.fill || 'transparent') + (o.shadow && f !== 'notch' ? ';box-shadow:0 40px 70px -40px rgba(30,20,10,.55)' : ''), inner);
  return out;
}

/** Полароид: ақ жиекті фото, сәл қисайған; таспа жапсырылған (жазу полароидтың ішінде емес — бұрылған мәтін PPTX-ке шықпайды) */
function polaroid(x, y, w, h, imgHtml, o = {}) {
  const pad = Math.round(w * 0.055);
  const inner = '<div style="position:absolute;left:' + pad + 'px;top:' + pad + 'px;right:' + pad + 'px;bottom:' + Math.round(pad * 3.2) + 'px;overflow:hidden">' + imgHtml + '</div>';
  return div(pos(x, y, w, h) + ';background:#fbf8f1;transform:rotate(' + (o.rot || -4) * V.tilt + 'deg);box-shadow:0 26px 46px -24px rgba(0,0,0,.55)', inner, 'cx-polaroid') +
    (o.tape === false ? '' : tape(x + w / 2 - 70, y - 18, 140, ((o.rot || -4) + 7) * V.tilt, o.tapeColor));
}
function tape(x, y, w, rot, color) {
  return div(pos(x, y, w, 40) + ';background:' + (color || 'rgba(217,170,80,.62)') + ';transform:rotate(' + rot + 'deg);box-shadow:0 2px 4px rgba(0,0,0,.08)');
}

/** Мөр: екі шеңбер + айнала ромб-нүктелер (мәтінсіз), ішіне композиция мәтін қояды */
function seal(cx, cy, r, fill, ink) {
  let dots = '';
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2; const rr = r * 0.82;
    dots += '<rect x="' + (r + Math.cos(t) * rr - 3).toFixed(1) + '" y="' + (r + Math.sin(t) * rr - 3).toFixed(1) + '" width="6" height="6" transform="rotate(45 ' + (r + Math.cos(t) * rr).toFixed(1) + ' ' + (r + Math.sin(t) * rr).toFixed(1) + ')"/>';
  }
  return div(pos(cx - r, cy - r, r * 2, r * 2) + ';border-radius:50%;background:' + fill + ';box-shadow:0 0 0 14px var(--bg),0 26px 40px -16px rgba(0,0,0,.35)',
    '<svg viewBox="0 0 ' + r * 2 + ' ' + r * 2 + '" width="100%" height="100%"><g fill="' + ink + '" opacity=".75">' + dots + '</g><circle cx="' + r + '" cy="' + r + '" r="' + (r * 0.7).toFixed(1) + '" fill="none" stroke="' + ink + '" stroke-width="1.5" opacity=".6"/></svg>');
}

/** Ірі көмескі сан/әріп (фонда) */
function ghost(x, y, text, size, color, o = {}) {
  return div(pos(x, y, o.w) + (o.w ? ';text-align:right' : '') + ';font-family:var(--f-display);font-size:' + size + 'px;line-height:1;letter-spacing:-.04em;color:' + color +
    (o.italic ? ';font-style:italic' : '') + ';white-space:nowrap;font-weight:' + (o.weight || 400), String(text).replace(/</g, '&lt;'));
}

/** Қошқар мүйіз оюы (inline SVG, түсі палитрадан) */
function horn(x, y, w, color) {
  const p = 'M120 150 C120 112 118 92 100 76 C80 58 46 62 42 90 C39 112 66 120 74 104 C80 92 66 84 60 92';
  return div(pos(x, y, w, w * 0.7),
    '<svg viewBox="20 40 200 140" width="100%" height="100%" fill="none" stroke="' + color + '" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="' + p + '"/><path d="' + p + '" transform="matrix(-1 0 0 1 240 0)"/><path d="M120 150 L120 172"/><path d="M120 46 l9 11 -9 11 -9 -11z" fill="' + color + '"/></svg>');
}
/** Ромб түйін */
function diamond(cx, cy, s, color, ring) {
  return div(pos(cx - s / 2, cy - s / 2, s, s) + ';background:' + color + ';transform:rotate(45deg)' + (ring ? ';box-shadow:0 0 0 10px ' + ring : ''));
}
/** Үзік толқын сызық (уақыт/жол) */
function wave(x, y, w, h, color, seed = 1) {
  const r = rng(seed); const n = 4; let d = 'M0 ' + (h / 2).toFixed(0);
  for (let i = 1; i <= n; i++) {
    const x1 = (w * (i - 0.5)) / n; const x2 = (w * i) / n;
    d += ' Q' + x1.toFixed(0) + ' ' + (h * (i % 2 ? 0.1 + r() * 0.15 : 0.75 + r() * 0.15)).toFixed(0) + ' ' + x2.toFixed(0) + ' ' + (h / 2).toFixed(0);
  }
  return div(pos(x, y, w, h), '<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="100%" preserveAspectRatio="none"><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round"/></svg>');
}
/** Нүктелі қағаз түйіршігі (бүкіл фон) */
function grain(color, step = 9) {
  switch (V.texture) {
    case 'plain': return '';
    case 'lines': return div('inset:0;background-image:repeating-linear-gradient(0deg,' + color + ' 0 1.5px,transparent 1.5px 44px)');
    case 'grid': return div('inset:0;background-image:linear-gradient(' + color + ' 1px,transparent 1px),linear-gradient(90deg,' + color + ' 1px,transparent 1px);background-size:48px 48px');
    case 'hatch': return div('inset:0;background-image:repeating-linear-gradient(45deg,' + color + ' 0 1px,transparent 1px 18px)');
    default: return div('inset:0;background-image:radial-gradient(' + color + ' 1.3px,transparent 1.6px);background-size:' + step + 'px ' + step + 'px');
  }
}
/** Түсті панель (геометриялық блок — композицияның «жартысы») */
function panel(x, y, w, h, fill, extra = '') { return div(pos(x, y, w, h) + ';background:' + fill + (extra ? ';' + extra : '')); }

/** Гравюра (Мұра) не белгіше (басқалары): слайд мәтініне сай; табылмаса '' */
function visualFor(text, sys, palette, used, seed, o = {}) {
  if (V.noDecor) return null;
  if (sys && sys.decor) {
    const h = D.pickDecor(text, used, seed);
    if (h) return { kind: 'engraving', uri: D.decorUri(h.file), tag: h.tag };
    return null; // Мұра: тек гравюра (белгішемен араласпайды)
  }
  const ic = D.pickIconDecor(text, used, 1)[0];
  if (ic) return { kind: 'icon', uri: D.iconUri(ic.name, o.color || palette.accent, o.stroke || 1.1), name: ic.name };
  return null;
}
/** Визуалды бокс ішіне сыйғызу */
function visualImg(v, x, y, w, h, o = {}) {
  if (!v || !v.uri) return '';
  // қараңғы фонда гравюра «ақ сызба» болады (инверсия + screen), ашықта — қағазға басылғандай (multiply)
  const f = v.kind !== 'engraving' ? '' : o.dark
    ? 'mix-blend-mode:screen;filter:grayscale(1) invert(1) contrast(1.2);'
    : 'mix-blend-mode:multiply;filter:' + (o.filter || 'sepia(.55) contrast(.95)') + ';';
  return div(pos(x, y, w, h), '<img alt="" src="' + v.uri + '" style="width:100%;height:100%;object-fit:contain;' + f + (o.opacity ? 'opacity:' + o.opacity : '') + '">');
}

const mix = T.mixHex;
/** Бір топтағы элементтерге визуал: бәріне табылса ғана (біреуінде бар, біреуінде жоқ — ала-құла көрінеді) */
function visualsForAll(texts, sys, palette, used, seed, o = {}) {
  const probe = new Set(used || []);
  const vs = texts.map((tx, i) => visualFor(tx, sys, palette, probe, seed + i, typeof o === 'function' ? o(i) : o));
  if (vs.some((v) => !v)) return texts.map(() => null);
  vs.forEach((v, i) => { if (used) { probe.forEach((k) => used.add(k)); } });
  return vs;
}

const CSS = '.cx-part img.ph{width:100%;height:100%;object-fit:cover;display:block}.cx-slide .title{margin:0}.cx-slide .lead.cx-center{margin-inline:auto;text-align:center}' +
  // қараңғы/түсті жолақ үстіндегі мәтін: жүйенің кілт-сөз бояуы (градиент, түс) жолақпен араласып кетпесін
  '#stage .cx-on-dark .title,#stage .cx-on-dark .title .w,#stage .cx-on-dark .title .hl,#stage .cx-on-dark .lead,#stage .cx-on-dark .kicker,#stage .cx-on-dark .meta-k,#stage .cx-on-dark .meta-v,#stage .cx-on-dark .cover-org' +
  '{color:var(--cx-ink)!important;-webkit-text-fill-color:var(--cx-ink)!important;background:none!important}#stage .cx-on-dark .meta-k{opacity:.7}';
module.exports = { setVariant, CSS, visualsForAll, rng, torn, ticket, sunburst, arch, polaroid, tape, seal, ghost, horn, diamond, wave, grain, panel, visualFor, visualImg, div, pos, px, mix };
