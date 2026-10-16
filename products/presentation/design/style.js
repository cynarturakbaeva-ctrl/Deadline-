'use strict';
/**
 * STYLE — turns tokens + palette into CSS. No layout decisions here, only how things look.
 * Everything reads from tokens.js; the same CSS serves any topic/palette.
 */
const fs = require('fs');
const path = require('path');
const T = require('./tokens');

const ASSETS = path.join(__dirname, '..', 'assets');
const cache = {};
function fontData(file, mime, fmt) {
  if (cache[file] !== undefined) return cache[file];
  try { cache[file] = { uri: 'data:' + mime + ';base64,' + fs.readFileSync(path.join(ASSETS, file)).toString('base64'), fmt }; }
  catch (e) { cache[file] = null; }
  return cache[file];
}

/**
 * The deck is delivered as an EDITABLE PPTX, so its text must use fonts every PowerPoint / Google Slides has:
 * Calibri (text) and Times New Roman (display serif). The HTML measures and draws with their metric-compatible
 * open clones (Carlito, Liberation Serif — full Kazakh Cyrillic), registered under the Office names, so line
 * breaks in the HTML are exactly the line breaks PowerPoint will produce. Only 400/700 (+ serif italic) faces exist;
 * `font-synthesis:none` makes 600–800 resolve to the real bold face, which is what PPTX "bold" renders.
 */
const FACES = [
  ['Calibri', 'Text-Regular.ttf', 400, 'normal'], ['Calibri', 'Text-Bold.ttf', 700, 'normal'],
  ['Times New Roman', 'Serif-Regular.ttf', 400, 'normal'], ['Times New Roman', 'Serif-Bold.ttf', 700, 'normal'],
  ['Times New Roman', 'Serif-Italic.ttf', 400, 'italic'],
  ['Arial', 'Arial-Regular.ttf', 400, 'normal'], ['Arial', 'Arial-Bold.ttf', 700, 'normal'], ['Arial', 'Arial-Italic.ttf', 400, 'italic'],
  ['Courier New', 'Mono-Regular.ttf', 400, 'normal'], ['Courier New', 'Mono-Bold.ttf', 700, 'normal'],
];
function fontFaces() {
  let css = '';
  for (const [family, file, weight, style] of FACES) {
    const f = fontData(file, 'font/ttf', 'truetype');
    if (f) css += "@font-face{font-family:'" + family + "';font-style:" + style + ';font-weight:' + weight + ';font-display:block;src:url(' + f.uri + ") format('truetype')}\n";
  }
  return css;
}

/** Root-level variables that do not depend on the deck palette. */
function baseVars() {
  const g = T.GRID;
  return ':root{' +
    '--mx:' + g.marginX + 'px;--mt:' + g.marginTop + 'px;--mb:' + g.marginBottom + 'px;--gut:' + g.gutter + 'px;' +
    Object.keys(T.SPACE).map((k) => '--s' + k + ':' + T.SPACE[k] + 'px').join(';') + ';' +
    '--r-sm:' + T.RADIUS.sm + 'px;--r-md:' + T.RADIUS.md + 'px;--r-lg:' + T.RADIUS.lg + 'px;' +
    '--sh-sm:' + T.SHADOW.sm + ';--sh-md:' + T.SHADOW.md + ';--sh-lg:' + T.SHADOW.lg + ';' +
    '--ease:cubic-bezier(.22,1,.36,1);--dur:1.25s}';
}

/** Per-slide palette variables (inline style). Legacy names kept for the runtime. */
function paletteVars(p) {
  return [
    '--accent:' + p.accent, '--bg:' + p.bg, '--text:' + p.text, '--muted:' + T.rgba(p.text, 0.62),
    '--surface:' + T.rgba(p.text, 0.06), '--wash:transparent',
    '--bg2:' + p.bg2, '--bg3:' + p.bg3, '--text2:' + p.text2, '--text3:' + p.text3,
    '--line:' + p.line, '--line-soft:' + p.lineSoft, '--accent-soft:' + p.accentSoft, '--accent-ink:' + p.accentInk,
    '--accent2:' + (p.accent2 || p.accent),
    '--glass:' + T.rgba(p.text, p.isLight ? 0.035 : 0.045), '--glass-line:' + T.rgba(p.text, p.isLight ? 0.1 : 0.11),
    '--glass-hi:' + (p.isLight ? 'rgba(255,255,255,.75)' : T.rgba(p.text, 0.08)),
    '--card-sh:' + (p.isLight ? '0 24px 60px -28px ' + T.rgba(p.text, 0.28) + ',0 2px 6px ' + T.rgba(p.text, 0.05) : '0 30px 70px -30px rgba(0,0,0,.7)'),
    '--aura:' + (p.isLight ? '30%' : '48%'), '--blend:' + (p.isLight ? 'multiply' : 'screen'), '--vig:' + (p.isLight ? '.16' : '.55'), '--grain:' + (p.isLight ? '.05' : '.085'),
    '--radius:' + (T.RADIUS[p.radius] != null ? T.RADIUS[p.radius] : T.RADIUS.md) + 'px',
    '--deco:' + (p.isLight ? '24%' : '34%'), '--deco-line:' + (p.isLight ? '40%' : '38%'),
  ].join(';');
}

function typeVars(ts) {
  return ':root{--f-display:' + ts.display + ';--f-text:' + ts.text + ';' +
    '--dw:' + ts.displayWeight + ';--tw:' + ts.titleWeight + ';--dt:' + ts.displayTracking + ';--tt:' + ts.titleTracking + ';' +
    '--dl:' + ts.displayLine + ';--tl:' + ts.titleLine + '}';
}

function css(palette, ts) {
  const g = T.GRID;
  return fontFaces() + baseVars() + typeVars(ts) + `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%;background:#000;color:var(--text);font-family:var(--f-text);font-synthesis:none;overflow:hidden;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-kerning:normal}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
#frame{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000}
#stage{position:absolute;left:50%;top:50%;width:${g.W}px;height:${g.H}px;margin:-${g.H / 2}px 0 0 -${g.W / 2}px;transform:scale(var(--fit,1));transform-origin:50% 50%;overflow:hidden;background:var(--bg);box-shadow:0 0 0 1px rgba(255,255,255,.06),0 40px 120px rgba(0,0,0,.6)}

/* ── transitions (runtime-driven) ── */
.slide{position:absolute;inset:0;opacity:0;visibility:hidden;pointer-events:none;z-index:1;transform-origin:50% 50%;background:var(--bg);color:var(--text);transition:opacity var(--dur) var(--ease),transform var(--dur) var(--ease),filter var(--dur) var(--ease),visibility var(--dur);--fs:1}
.slide.is-active{opacity:1;visibility:visible;pointer-events:auto;z-index:2}
.slide.is-leaving{z-index:3;pointer-events:none}
.cam-through.from{transform:scale(.86);opacity:0;filter:blur(8px)}
.cam-through.to{transform:scale(1.6);opacity:0;filter:blur(10px);transform-origin:var(--focus-x,40%) var(--focus-y,45%)}
.cam-through.is-active{transform:scale(1);filter:none}
.cam-jump.from{transform:translate3d(var(--from-x,8%),var(--from-y,4%),0) scale(1.08);opacity:0;filter:blur(5px)}
.cam-jump.to{transform:translate3d(var(--to-x,-8%),var(--to-y,-4%),0) scale(1.1);opacity:0;filter:blur(6px)}
.cam-jump.is-active{transform:none;filter:none}
.cam-rise.from{transform:translate3d(0,10%,0) scale(.96);opacity:0}
.cam-rise.to{transform:translate3d(0,-6%,0) scale(1.03);opacity:0;filter:blur(3px)}
.cam-rise.is-active{transform:none;filter:none}
.cam-punch.from{transform:scale(1.12);opacity:0}
.cam-punch.to{transform:scale(.92);opacity:0}
.cam-punch.is-active{transform:none}
.cam-soft.from,.cam-soft.to{opacity:0}
.cam-soft.is-active{opacity:1}
.layer{position:absolute;inset:0;will-change:transform}
.layer-bg{z-index:0;overflow:hidden}
.layer-mid{z-index:2}

/* ── backgrounds ── */
.plate{position:absolute;inset:0;background:radial-gradient(120% 90% at 100% 0%,var(--bg2) 0%,transparent 62%),var(--bg)}
.plate-cover{background:radial-gradient(90% 100% at 100% 100%,var(--accent-soft) 0%,transparent 60%),radial-gradient(120% 90% at 0% 0%,var(--bg2) 0%,transparent 60%),var(--bg)}
.plate-section{background:linear-gradient(160deg,var(--accent-soft) 0%,var(--bg) 70%)}

/* ── decoration (plain slides only; kind comes from the theme, position rotates per slide via .dp-0..3) ── */
.deco{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.deco::before,.deco::after{content:"";position:absolute}
/* orbs: two soft accent glows */
.deco-orbs::before{width:820px;height:820px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) var(--deco),transparent) 0%,transparent 68%)}
.deco-orbs::after{width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) calc(var(--deco) * .6),transparent) 0%,transparent 70%)}
.deco-orbs.dp-0::before{top:-300px;right:-220px}.deco-orbs.dp-0::after{bottom:-240px;left:-180px}
.deco-orbs.dp-1::before{top:-260px;left:-240px}.deco-orbs.dp-1::after{bottom:-220px;right:-140px}
.deco-orbs.dp-2::before{bottom:-340px;right:-240px}.deco-orbs.dp-2::after{top:-200px;left:36%}
.deco-orbs.dp-3::before{bottom:-300px;left:-220px}.deco-orbs.dp-3::after{top:-220px;right:-160px}
/* grid: fine blueprint grid fading out from one corner + accent tick */
.deco-grid{--gx:100%;--gy:0%;background-image:linear-gradient(to right,color-mix(in srgb,var(--accent) 24%,transparent) 1px,transparent 1px),linear-gradient(to bottom,color-mix(in srgb,var(--accent) 24%,transparent) 1px,transparent 1px);background-size:96px 96px;-webkit-mask-image:radial-gradient(75% 85% at var(--gx) var(--gy),#000 0%,transparent 78%);mask-image:radial-gradient(75% 85% at var(--gx) var(--gy),#000 0%,transparent 78%)}
.deco-grid.dp-1{--gx:0%;--gy:0%}.deco-grid.dp-2{--gx:100%;--gy:100%}.deco-grid.dp-3{--gx:0%;--gy:100%}
/* rings: concentric outlines bleeding off a corner */
.deco-rings::before{width:1240px;height:1240px;border-radius:50%;background:repeating-radial-gradient(circle,transparent 0,transparent 62px,color-mix(in srgb,var(--accent) var(--deco-line),transparent) 63px,transparent 65px);-webkit-mask-image:radial-gradient(circle,#000 0%,transparent 72%);mask-image:radial-gradient(circle,#000 0%,transparent 72%)}
.deco-rings::after{width:300px;height:300px;border-radius:50%;border:2px solid color-mix(in srgb,var(--accent) calc(var(--deco-line) * 1.6),transparent)}
.deco-rings.dp-0::before{top:-560px;right:-520px}.deco-rings.dp-0::after{top:-90px;right:-90px}
.deco-rings.dp-1::before{top:-560px;left:-520px}.deco-rings.dp-1::after{top:-90px;left:-90px}
.deco-rings.dp-2::before{bottom:-560px;right:-520px}.deco-rings.dp-2::after{bottom:-90px;right:-90px}
.deco-rings.dp-3::before{bottom:-560px;left:-520px}.deco-rings.dp-3::after{bottom:-90px;left:-90px}
/* dots: dot matrix patch in a corner */
.deco-dots::before{width:900px;height:640px;background-image:radial-gradient(color-mix(in srgb,var(--accent) calc(var(--deco) * 2),transparent) 3px,transparent 3.6px);background-size:42px 42px;-webkit-mask-image:radial-gradient(closest-side,#000 0%,transparent 100%);mask-image:radial-gradient(closest-side,#000 0%,transparent 100%)}
.deco-dots::after{width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) calc(var(--deco) * .5),transparent) 0%,transparent 70%)}
.deco-dots.dp-0::before{top:-40px;right:-60px}.deco-dots.dp-0::after{bottom:-160px;left:-120px}
.deco-dots.dp-1::before{top:-40px;left:-60px}.deco-dots.dp-1::after{bottom:-160px;right:-120px}
.deco-dots.dp-2::before{bottom:-40px;right:-60px}.deco-dots.dp-2::after{top:-160px;left:-120px}
.deco-dots.dp-3::before{bottom:-40px;left:-60px}.deco-dots.dp-3::after{top:-160px;right:-120px}
/* diagonal: tilted translucent slab with a sharp accent edge */
.deco-diagonal::before{width:760px;height:2400px;background:linear-gradient(90deg,color-mix(in srgb,var(--accent) calc(var(--deco) * .55),transparent) 0%,transparent 100%);transform:rotate(26deg);transform-origin:0 0}
.deco-diagonal::after{width:3px;height:2400px;background:linear-gradient(180deg,transparent 0%,var(--accent) 35%,transparent 100%);opacity:.55;transform:rotate(26deg);transform-origin:0 0}
.deco-diagonal.dp-0::before{top:-300px;right:520px}.deco-diagonal.dp-0::after{top:-300px;right:520px}
.deco-diagonal.dp-1::before{top:-300px;right:200px}.deco-diagonal.dp-1::after{top:-300px;right:200px}
.deco-diagonal.dp-2::before{top:-700px;right:80px}.deco-diagonal.dp-2::after{top:-700px;right:80px}
.deco-diagonal.dp-3::before{top:-500px;right:760px}.deco-diagonal.dp-3::after{top:-500px;right:760px}
/* bands: short accent tick on the edge + a soft colour wash fading out from the opposite corner (no hard boxes) */
.deco-bands::before{background:var(--accent);border-radius:2px}
.deco-bands::after{width:1100px;height:700px}
.deco-bands.dp-0::before{left:0;top:24%;width:8px;height:150px}.deco-bands.dp-0::after{top:0;right:0;background:radial-gradient(ellipse 960px 600px at 100% 0,color-mix(in srgb,var(--accent) calc(var(--deco) * .55),transparent) 0%,transparent 100%)}
.deco-bands.dp-1::before{top:0;left:var(--mx);width:150px;height:8px}.deco-bands.dp-1::after{bottom:0;right:0;background:radial-gradient(ellipse 960px 600px at 100% 100%,color-mix(in srgb,var(--accent) calc(var(--deco) * .55),transparent) 0%,transparent 100%)}
.deco-bands.dp-2::before{right:0;bottom:24%;width:8px;height:150px}.deco-bands.dp-2::after{bottom:0;left:0;background:radial-gradient(ellipse 960px 600px at 0 100%,color-mix(in srgb,var(--accent) calc(var(--deco) * .55),transparent) 0%,transparent 100%)}
.deco-bands.dp-3::before{bottom:0;right:var(--mx);width:150px;height:8px}.deco-bands.dp-3::after{top:0;left:0;background:radial-gradient(ellipse 960px 600px at 0 0,color-mix(in srgb,var(--accent) calc(var(--deco) * .55),transparent) 0%,transparent 100%)}
.full,.scrim{position:absolute;inset:0}
.full .ph{width:100%;height:100%;object-fit:cover;display:block;transform:scale(1.06);transition:transform 1.8s var(--ease)}
.slide.is-active .full .ph{transform:scale(1)}
.bleed{position:absolute;top:0;bottom:0;overflow:hidden;background:var(--bg3)}
.bleed .ph{width:100%;height:100%;object-fit:cover;display:block}

/* ── grid canvas: everything sits inside the margins ── */
.canvas{position:absolute;left:var(--cl,var(--mx));right:var(--cr,var(--mx));top:var(--ct,var(--mt));bottom:var(--cb,var(--mb))}
.g12{display:grid;grid-template-columns:repeat(${g.cols},minmax(0,1fr));grid-template-rows:minmax(0,1fr);column-gap:var(--gut)}
.g12>*{grid-row:1}
.cell{min-width:0}
.cell.end{align-self:end}
.block{min-width:0}

/* ── typography roles ── */
.title{margin:0;font-family:var(--f-display);font-weight:var(--tw);letter-spacing:var(--tt);line-height:var(--tl);font-size:calc(var(--ts,72px)*var(--fs,1));text-wrap:balance;hyphens:none;overflow-wrap:normal;word-break:normal;color:var(--text)}
.title.t-display{font-weight:var(--dw);letter-spacing:var(--dt);line-height:var(--dl)}
.title.center{text-align:center}
.lead{margin:var(--s3) 0 0;font-size:calc(var(--ls,38px)*var(--fs,1));line-height:1.36;font-weight:400;color:var(--text2);text-wrap:pretty;letter-spacing:-.005em}
.lead.center{text-align:center;margin-inline:auto}
.para{margin:var(--s3) 0 0;font-size:calc(var(--bs,28px)*var(--fs,1));line-height:1.55;color:var(--text2);text-wrap:pretty}
.kicker{font-size:20px;line-height:1.2;font-weight:650;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);margin:0 0 var(--s3)}
.rule{height:3px;background:var(--accent);margin:var(--s4) 0 var(--s3);border-radius:2px}
.title+.rule{margin-top:var(--s4)}
.folio{position:absolute;left:var(--mx);right:var(--mx);bottom:40px;display:flex;justify-content:space-between;align-items:baseline;font-size:20px;line-height:1;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);z-index:3}
.folio b{font-weight:650;color:var(--text2)}
.folio-l{max-width:70%;white-space:nowrap;overflow:hidden;text-overflow:clip}

/* ── reveal ── */
.rv{opacity:0;transform:translateY(14px);transition:opacity .7s var(--ease),transform .7s var(--ease)}
.slide.is-active .rv{opacity:1;transform:none;transition-delay:calc(.12s + var(--i,0)*.07s)}
.measuring .rv,.measuring .figure,.measuring .bleed .ph,.measuring .full .ph,.measuring .photo .ph{transition:none!important;opacity:1!important;transform:none!important}

/* ── cover ── */
.cover{display:flex;flex-direction:column;justify-content:space-between}
.cover-top{display:flex;align-items:center;gap:var(--s3)}
.cover-top .rule{margin:0}.cover-top .kicker{margin:0}
.cover-block{padding-bottom:var(--s5)}
.cover .lead{margin-top:var(--s4)}
.meta-row{display:flex;gap:var(--s6);margin-top:var(--s6);padding-top:var(--s3);border-top:1px solid var(--line);max-width:${Math.round(g.span(11))}px}
.meta-i{display:flex;flex-direction:column;gap:6px;min-width:0}
.meta-k{font-size:20px;letter-spacing:.14em;text-transform:uppercase;color:var(--text3);font-weight:600}
.meta-v{font-size:28px;line-height:1.3;color:var(--text)}
.meta-row.is-dense{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s4) var(--s6)}
.meta-row.is-dense .meta-v{font-size:24px}.meta-row.is-dense .meta-k{font-size:18px}
.cover-org{font-size:24px;letter-spacing:.06em;text-transform:uppercase;color:var(--text2);font-weight:600;line-height:1.3}

/* ── cover variants (design systems) ── */
.cover-c{display:flex;flex-direction:column;justify-content:space-between;align-items:center;text-align:center}
.cover-c .cover-top{justify-content:center;min-height:30px}
.cover-c .cover-block{display:flex;flex-direction:column;align-items:center;padding-bottom:0}
.cover-c .cover-block .rule{margin:0 auto var(--s5)}
.cover-c .cover-foot{width:100%;display:flex;justify-content:center}
.cover-c .meta-row{justify-content:center;margin-top:0;max-width:${Math.round(g.span(12))}px}
.cover-c .meta-row.is-dense{justify-items:center}
.cover-c .meta-i{align-items:center}
.cover-panel{position:absolute;left:0;top:0;bottom:0;background:var(--accent);z-index:1}
.panel-pattern{position:absolute;right:0;top:0;bottom:0;width:46%;background:repeating-linear-gradient(135deg,var(--bg2) 0 2px,transparent 2px 26px),var(--bg)}
.cover-p{align-items:stretch}
.cover-p-l{display:flex;flex-direction:column;justify-content:space-between;min-height:0;gap:var(--s5)}
.cover-p-l .meta-row{margin-top:0;max-width:100%}
.on-accent{--text:var(--accent-ink);--text2:color-mix(in srgb,var(--accent-ink) 86%,transparent);--text3:color-mix(in srgb,var(--accent-ink) 68%,transparent);--line:color-mix(in srgb,var(--accent-ink) 32%,transparent);color:var(--text)}
.on-photo{--text:#fff;--text2:rgba(255,255,255,.9);--text3:rgba(255,255,255,.72);--line:rgba(255,255,255,.34);color:#fff}
.on-photo .title{text-shadow:0 2px 24px rgba(0,0,0,.35)}
#stage .slide .on-photo .title .hl{color:color-mix(in srgb,var(--accent) 38%,#fff)!important;-webkit-text-fill-color:color-mix(in srgb,var(--accent) 38%,#fff)!important}
.close-split .close-r .rows{margin-top:var(--s4)}
#stage .slide .on-accent .title .hl{background:none!important;-webkit-background-clip:border-box!important;background-clip:border-box!important;color:inherit!important;-webkit-text-fill-color:currentColor!important;text-decoration:underline;text-decoration-thickness:.06em;text-underline-offset:.14em}
.cover-m{align-items:stretch}
.mast-l{display:flex;flex-direction:column;justify-content:space-between;min-height:0;gap:var(--s5)}
.mast-top{border-bottom:4px double var(--text);padding-bottom:var(--s2)}
.mast-top .cover-org{color:var(--text)}
.mast-photo{align-self:stretch;display:flex;min-height:0}
.mast-photo .photo{height:100%}
.cover-m .meta-row{margin-top:0;max-width:100%}

/* ── section ── */
.sect{display:flex;flex-direction:column;justify-content:space-between}
.numeral-xl{font-family:var(--f-display);font-weight:var(--dw);font-size:calc(200px*var(--fs,1));line-height:.8;letter-spacing:-.04em;color:var(--accent);font-variant-numeric:lining-nums}
.sect-block{padding-bottom:var(--s5)}
.sect .lead{margin-top:var(--s4)}

/* ── statement ── */
.stmt{display:flex;flex-direction:column;justify-content:center;padding-bottom:var(--s5)}

/* ── split / focus / editorial / points ── */
.split{align-items:center}
.split .photo-cell{align-self:stretch;display:flex;flex-direction:column;justify-content:center}
.split .text-cell{align-self:center}
.photo{margin:0;overflow:hidden;position:relative;background:var(--bg3);border:1px solid var(--line-soft);width:100%}
.photo .ph{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.focus{align-items:end}
.focus .text-cell{padding-bottom:var(--s3)}
.edit{align-items:center}
.edit-l .cell-photo{margin-top:var(--s5)}
.edit-r{padding-top:var(--s1)}
.prose p{margin:0 0 var(--s3);font-size:calc(var(--bs,28px)*var(--fs,1));line-height:1.62;color:var(--text);text-wrap:pretty}
.prose p:first-child{color:var(--text)}
.prose.two{column-count:2;column-gap:var(--s5)}
.prose.two p{break-inside:avoid-column}
.notes{list-style:none;margin:var(--s4) 0 0;padding:0;display:grid;gap:var(--s3)}
.notes li{padding-left:var(--s3);border-left:3px solid var(--accent);font-size:calc(var(--bs,24px)*var(--fs,1));line-height:1.45;color:var(--text2)}
.pts{align-items:center}
.pts-l,.pts-r{align-self:center}
.rows{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.row{display:flex;gap:var(--s4);padding:var(--s4) 0;border-bottom:1px solid var(--line)}
.row-n{flex:none;width:48px;padding-top:.5em;font-size:20px;letter-spacing:.14em;font-weight:650;color:var(--accent);font-variant-numeric:tabular-nums}
.row-b{min-width:0;flex:1}
.row-l{font-size:calc(var(--rl,32px)*var(--fs,1));line-height:1.22;letter-spacing:-.012em;color:var(--text);text-wrap:balance}
.row-l.strong{font-weight:650}
.row-d{margin-top:10px;font-size:calc(var(--rd,26px)*var(--fs,1));line-height:1.45;color:var(--text2);text-wrap:pretty}

/* concept columns (3–4 labelled ideas) */
/* тақырып жоғарыда, ұғымдар төменгі жиекте: аралықтағы ауа — әдейі (асты бос қалмайды) */
.conc{display:flex;flex-direction:column;justify-content:space-between;gap:var(--s8)}
.concepts{list-style:none;margin:0;padding:0;display:grid;column-gap:var(--gut);align-items:start}
.concepts.n2{grid-template-columns:repeat(2,1fr)}.concepts.n3{grid-template-columns:repeat(3,1fr)}.concepts.n4{grid-template-columns:repeat(4,1fr)}.concepts.n5,.concepts.n6{grid-template-columns:repeat(3,1fr);row-gap:var(--s5)}
.concept{border-top:1px solid var(--line);padding-top:var(--s3);padding-right:var(--s2);position:relative}
.concept::before{content:'';position:absolute;left:0;top:-1px;width:48px;height:3px;background:var(--accent)}
.concept-n{display:block;font-size:20px;letter-spacing:.14em;font-weight:650;color:var(--accent);margin-bottom:var(--s3)}
.concept-l{font-size:calc(var(--rl,34px)*var(--fs,1));font-weight:650;line-height:1.2;letter-spacing:-.012em;color:var(--text);text-wrap:balance}
.concept-d{margin-top:var(--s2);font-size:calc(var(--rd,26px)*var(--fs,1));line-height:1.5;color:var(--text2);text-wrap:pretty}
.conc-head{padding-bottom:0}

/* title-on-top composition (reference decks) */
.stack{display:flex;flex-direction:column;gap:var(--s6)}
.stack-head{flex:none}
.stack-body{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-start}
.stack-body.g12{display:grid}
.stack-body .rows{width:100%}
.stack-txt{align-self:center}
.ref-folio-num .folio .of{display:none}
.ref-cards .concept{min-height:var(--card-h,auto);display:flex;flex-direction:column;justify-content:center}
/* full-bleed photo slide */
.fimg{display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:var(--s7)}
.fimg .title{color:#fff;text-shadow:0 2px 30px rgba(0,0,0,.35)}.fimg .lead{color:rgba(255,255,255,.88)}

/* ── reference skin: клиент референсінің безендіруі ── */
.ref-el{position:absolute;pointer-events:none;z-index:1}
.ref-flat .plate,.ref-flat .plate-cover,.ref-flat .plate-section{background:var(--bg)}
.ref-decor .plate,.ref-decor .plate-cover,.ref-decor .plate-section{background:transparent}
.ref-bg{position:absolute;inset:0;z-index:0}.dm{background-repeat:no-repeat}
.ref-dec{position:absolute;pointer-events:none;z-index:1;display:block}
.ref-cover-photo{position:absolute;overflow:hidden;z-index:1}.ref-cover-photo .ph{width:100%;height:100%;object-fit:cover;display:block}
.ref-cover-photo.is-circle{border-radius:50%;box-shadow:0 0 0 14px rgba(255,255,255,.92),0 22px 60px rgba(0,0,0,.35)}
.ref-circle .photo{border-radius:50%!important;aspect-ratio:1/1!important;height:auto!important;width:min(100%,var(--cw,640px))!important;margin:0 auto;border:12px solid #fff;box-shadow:0 22px 60px rgba(0,0,0,.28)}
.ref-circle .photo-cell{align-items:center}
.ref-title-center .title,.ref-title-center .lead,.ref-title-center .stack-head{text-align:center}
.ref-title-center .title,.ref-title-center .lead{margin-left:auto;margin-right:auto}
.ref-body-justify .para,.ref-body-justify .row-d{text-align:justify;hyphens:auto}
.ref-folio-none .folio{display:none}
.ref-folio-num .folio-l{display:none}
.ref-folio-num.ref-folio-left .folio{justify-content:flex-start}.ref-folio-num.ref-folio-right .folio{justify-content:flex-end}.ref-folio-num.ref-folio-center .folio{justify-content:center}
.ref-folio-num .folio b{font-weight:650}
.folio{bottom:calc(40px + var(--ref-bb,0px))}
.ref-cards .concept{background:var(--card-fill);border:0;border-radius:var(--radius);padding:var(--s4) var(--s4) var(--s5)}
.ref-cards .concept::before{display:none}
.ref-cards .concept-n{color:var(--accent)}
.ref-cards .concept-l,.ref-cards .concept-d{color:var(--card-ink)}

/* ── stats ── */
.stats{display:flex;flex-direction:column;justify-content:center;gap:var(--s8)}
.stats-head{align-items:start}
.stat-row{list-style:none;margin:0;padding:0;display:grid;column-gap:var(--gut);align-items:start}
.stat-row.n2{grid-template-columns:repeat(2,1fr)}.stat-row.n3{grid-template-columns:repeat(3,1fr)}.stat-row.n4{grid-template-columns:repeat(4,1fr)}
.stat{border-top:1px solid var(--line);padding-top:var(--s4);position:relative;min-width:0}
.stat::before{content:'';position:absolute;left:0;top:-1px;width:64px;height:3px;background:var(--accent)}
.stat-v{font-family:var(--f-display);font-weight:var(--dw);font-size:calc(var(--ns,120px)*var(--fs,1));line-height:.95;letter-spacing:-.035em;color:var(--text);font-variant-numeric:lining-nums tabular-nums;white-space:nowrap}
.stat-v .sfx{font-size:.5em;letter-spacing:0;margin-left:.06em;color:var(--accent);font-weight:var(--tw)}
.stat-l{margin-top:var(--s3);font-size:calc(28px*var(--fs,1));line-height:1.35;color:var(--text2);max-width:26ch;text-wrap:balance}

/* ── number hero ── */
.numb{align-items:center}
.mega{font-family:var(--f-display);font-weight:var(--dw);font-size:calc(var(--ns,240px)*var(--fs,1));line-height:.9;letter-spacing:-.045em;color:var(--accent);font-variant-numeric:lining-nums;white-space:nowrap}
.numb-r{border-left:1px solid var(--line);padding-left:var(--s5);align-self:center}

/* ── timeline ── */
.tl-canvas,.proc-canvas,.tbl{display:flex;flex-direction:column;justify-content:center;gap:var(--s8)}
.tl-head,.proc-head,.tbl-head{align-items:start}
.tl{list-style:none;margin:0;padding:0;display:grid;column-gap:var(--gut)}
.tl.n2{grid-template-columns:repeat(2,1fr)}.tl.n3{grid-template-columns:repeat(3,1fr)}.tl.n4{grid-template-columns:repeat(4,1fr)}.tl.n5{grid-template-columns:repeat(5,1fr)}.tl.n6{grid-template-columns:repeat(6,1fr)}
.tl-n{position:relative;min-width:0}
.tl-date{font-family:var(--f-display);font-weight:var(--tw);font-size:calc(var(--ds,54px)*var(--fs,1));line-height:1;letter-spacing:-.03em;color:var(--text);margin-bottom:var(--s3);font-variant-numeric:lining-nums;white-space:nowrap}
.tl-mark{position:relative;height:16px;margin-bottom:var(--s3)}
.tl-mark::before{content:'';position:absolute;left:0;right:calc(var(--gut)*-1);top:50%;height:1px;background:var(--line)}
.tl-n:last-child .tl-mark::before{right:0}
.tl-mark::after{content:'';position:absolute;left:0;top:50%;width:16px;height:16px;margin-top:-8px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 6px var(--bg)}
.tl-txt{font-size:calc(var(--bs,26px)*var(--fs,1));line-height:1.45;color:var(--text2);text-wrap:pretty;padding-right:var(--s2)}

/* ── process ── */
.steps{list-style:none;margin:0;padding:0;display:grid;column-gap:var(--gut);row-gap:var(--s6)}
.steps.g2{grid-template-columns:repeat(2,1fr)}.steps.g3{grid-template-columns:repeat(3,1fr)}.steps.g4{grid-template-columns:repeat(4,1fr)}
.st{min-width:0;padding-right:var(--s2)}
.st-mark{display:flex;align-items:center;gap:var(--s3);margin-bottom:var(--s4)}
.st-n{flex:none;font-family:var(--f-display);font-weight:var(--tw);font-size:calc(64px*var(--fs,1));line-height:1;letter-spacing:-.03em;color:var(--accent);font-variant-numeric:lining-nums}
.st-arrow{flex:1;position:relative;height:1px;background:var(--line);margin-right:var(--s2)}
.st-arrow::after{content:'';position:absolute;right:0;top:-5px;width:10px;height:10px;border-top:1px solid var(--text3);border-right:1px solid var(--text3);transform:rotate(45deg)}
.st-l{font-size:calc(var(--rl,32px)*var(--fs,1));font-weight:650;line-height:1.2;letter-spacing:-.012em;color:var(--text);text-wrap:balance}
.st-d{margin-top:var(--s2);font-size:calc(var(--rd,25px)*var(--fs,1));line-height:1.5;color:var(--text2);text-wrap:pretty}
.steps.wrap .st-mark{border-bottom:1px solid var(--line);padding-bottom:var(--s3)}

/* ── hierarchy ── */
.hier{display:flex;flex-direction:column;justify-content:center;gap:var(--s6);align-items:stretch}
.hier-root{text-align:center;display:flex;flex-direction:column;align-items:center}
.hier-root .kicker{margin-bottom:var(--s3)}
.tree{list-style:none;margin:0;padding:var(--s6) 0 0;display:grid;column-gap:var(--gut);position:relative}
.tree.n2{grid-template-columns:repeat(2,1fr)}.tree.n3{grid-template-columns:repeat(3,1fr)}.tree.n4{grid-template-columns:repeat(4,1fr)}.tree.n5{grid-template-columns:repeat(5,1fr)}.tree.n6{grid-template-columns:repeat(6,1fr)}
.tree::before{content:'';position:absolute;top:0;left:50%;width:1px;height:32px;background:var(--line)}
.tree::after{content:'';position:absolute;top:32px;height:1px;background:var(--line)}
.tree.n2::after{left:calc((100% - 1*var(--gut))/4);right:calc((100% - 1*var(--gut))/4)}
.tree.n3::after{left:calc((100% - 2*var(--gut))/6);right:calc((100% - 2*var(--gut))/6)}
.tree.n4::after{left:calc((100% - 3*var(--gut))/8);right:calc((100% - 3*var(--gut))/8)}
.tree.n5::after{left:calc((100% - 4*var(--gut))/10);right:calc((100% - 4*var(--gut))/10)}
.tree.n6::after{left:calc((100% - 5*var(--gut))/12);right:calc((100% - 5*var(--gut))/12)}
.hn{position:relative;padding:var(--s3) var(--s3) var(--s4);border:1px solid var(--line);border-radius:var(--radius);background:var(--bg2);min-width:0}
.hn::before{content:'';position:absolute;top:-32px;left:50%;width:1px;height:32px;background:var(--line)}
.hn-n{display:block;font-size:20px;letter-spacing:.14em;font-weight:650;color:var(--accent);margin-bottom:var(--s2)}
.hn-l{font-size:calc(var(--rl,30px)*var(--fs,1));font-weight:650;line-height:1.2;color:var(--text);text-wrap:balance}
.hn-d{margin-top:var(--s1);font-size:calc(var(--rd,24px)*var(--fs,1));line-height:1.45;color:var(--text2);text-wrap:pretty}
.st-s,.hn-s{color:var(--text);font-weight:500;line-height:1.4}.st-s{margin-top:var(--s3)}.hn-s{margin-top:var(--s2)}

/* ── table ── */
.table-wrap{width:100%}
.data-table{width:100%;border-collapse:collapse;font-size:calc(var(--ts2,28px)*var(--fs,1))}
.data-table th{text-align:left;padding:0 var(--s3) var(--s2) 0;font-size:20px;font-weight:650;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);border-bottom:2px solid var(--text)}
.data-table td{padding:var(--s3) var(--s3) var(--s3) 0;line-height:1.35;color:var(--text2);border-bottom:1px solid var(--line);vertical-align:top}
.data-table td.first{color:var(--text);font-weight:650}
.data-table tr:last-child td{border-bottom:1px solid var(--line)}

/* ── diagram ── */
.diag{align-items:center}
.diag-l{align-self:center}
.figure{margin:0;width:100%;height:740px;border-radius:var(--radius);overflow:hidden;background:var(--bg2);border:1px solid var(--line-soft);box-shadow:var(--sh-sm);display:flex;align-items:center;justify-content:center}
.figure img{display:block;width:100%;height:100%;object-fit:contain}
.diag-r{align-self:center}

/* ── quote ── */
.quote{display:flex;flex-direction:column;justify-content:center}
.quote-block{max-width:${Math.round(g.span(10))}px;padding-bottom:var(--s5)}
.qmark{font-family:var(--f-display);font-size:calc(220px*var(--fs,1));line-height:.6;height:.42em;color:var(--accent);font-weight:var(--dw)}
.qtext{margin:var(--s3) 0 0;font-family:var(--f-display);font-weight:var(--tw);font-size:calc(var(--ts,60px)*var(--fs,1));line-height:1.16;letter-spacing:-.015em;color:var(--text);text-wrap:balance}
.qwho{display:flex;align-items:center;gap:var(--s3);margin-top:var(--s5);font-size:22px;letter-spacing:.16em;text-transform:uppercase;color:var(--text2);font-weight:600}
.qrule{display:block;width:56px;height:3px;background:var(--accent);border-radius:2px}

/* ── closing / references ── */
.close{align-items:center}
.close-l,.close-r{align-self:center}
.closing-slide .row{padding:var(--s4) 0}
.refs{align-items:center}
.refs-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.refs-list.two{column-count:2;column-gap:var(--s5)}
.refs-list li{display:flex;gap:var(--s2);padding:var(--s2) 0;border-bottom:1px solid var(--line-soft);font-size:calc(var(--bs,24px)*var(--fs,1));line-height:1.4;color:var(--text2);break-inside:avoid}
.ref-n{flex:none;width:32px;color:var(--accent);font-weight:650;font-variant-numeric:tabular-nums}


/* ══ FX LAYER — "wow" without hurting legibility: atmosphere, gradient key-words, glass, motion ══ */
@property --pp{syntax:'<number>';inherits:false;initial-value:0}
/* film grain + vignette on every generated slide (client reference skins keep their own look) */
#stage:not(.ref-decor) .layer-bg::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:5;background-image:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 1.6 -.3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\");background-size:240px 240px;opacity:var(--grain);mix-blend-mode:overlay}
#stage:not(.ref-decor) .layer-bg::before{content:"";position:absolute;inset:0;pointer-events:none;z-index:4;background:radial-gradient(130% 120% at 50% 45%,transparent 58%,color-mix(in srgb,var(--bg) 70%,#000) 100%);opacity:var(--vig,.55)}
/* aurora: blurred accent fields that drift slowly (static in the PPTX, alive in the HTML) */
.aurora{position:absolute;inset:-10%;pointer-events:none;filter:blur(90px) saturate(1.15);opacity:1}
.aurora i{position:absolute;border-radius:50%;mix-blend-mode:var(--blend,screen)}
.aurora .a1{width:62%;height:78%;right:-6%;top:-18%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) var(--aura),transparent) 0%,transparent 66%);animation:drift1 18s ease-in-out infinite alternate}
.aurora .a2{width:52%;height:70%;right:22%;bottom:-30%;background:radial-gradient(circle,color-mix(in srgb,var(--accent2) var(--aura),transparent) 0%,transparent 66%);animation:drift2 22s ease-in-out infinite alternate}
.aurora .a3{width:36%;height:46%;left:-8%;top:8%;background:radial-gradient(circle,color-mix(in srgb,var(--accent2) calc(var(--aura) * .55),transparent) 0%,transparent 70%);animation:drift1 26s ease-in-out infinite alternate-reverse}
.aurora.soft{opacity:.62}
.aurora.soft .a1{width:48%;height:62%;right:-14%;top:-26%}
.aurora.soft .a2{width:40%;height:56%;right:-4%;bottom:-38%}
@keyframes drift1{from{transform:translate3d(0,0,0) scale(1)}to{transform:translate3d(-6%,5%,0) scale(1.12)}}
@keyframes drift2{from{transform:translate3d(0,0,0) scale(1.05)}to{transform:translate3d(7%,-6%,0) scale(.95)}}
/* cover halo: a thin orbit ring with a travelling accent dot */
.halo{position:absolute;width:980px;height:980px;right:-250px;top:50%;margin-top:-490px;border-radius:50%;border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);-webkit-mask-image:linear-gradient(100deg,transparent 8%,#000 55%);mask-image:linear-gradient(100deg,transparent 8%,#000 55%)}
.halo::before{content:"";position:absolute;inset:110px;border-radius:50%;border:1px solid color-mix(in srgb,var(--accent2) 22%,transparent)}
.halo i{position:absolute;inset:0;border-radius:50%;animation:orbit 30s linear infinite}
.halo i::after{content:"";position:absolute;left:50%;top:-7px;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 22%,transparent),0 0 40px 8px color-mix(in srgb,var(--accent) 60%,transparent)}
@keyframes orbit{from{transform:rotate(200deg)}to{transform:rotate(560deg)}}
/* ghost typography: giant outlined glyphs bleeding off the edge */
.ghost{position:absolute;pointer-events:none;font-family:var(--f-display);font-weight:var(--dw);line-height:.8;letter-spacing:-.06em;color:transparent;-webkit-text-stroke:2px color-mix(in srgb,var(--accent) 30%,transparent);white-space:nowrap;font-variant-numeric:lining-nums}
.ghost-num{right:-40px;bottom:-120px;font-size:860px;-webkit-mask-image:linear-gradient(200deg,#000 20%,transparent 85%);mask-image:linear-gradient(200deg,#000 20%,transparent 85%)}
.ghost-quote{right:60px;top:-80px;font-size:900px;line-height:1;-webkit-text-stroke:0;color:color-mix(in srgb,var(--accent) 9%,transparent)}
/* gradient key-word in display titles */
.title .hl{background:linear-gradient(100deg,var(--accent) 0%,var(--accent2) 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-box-decoration-break:clone;box-decoration-break:clone;padding-right:.04em}
.serif-tone .title.t-display .hl{font-style:italic}
.ref-skin .title .hl{background:none;-webkit-background-clip:border-box;background-clip:border-box;color:inherit}
/* title words materialise one by one */
.title .w{opacity:0;filter:blur(10px);transition:opacity .8s var(--ease),filter .8s var(--ease)}
.slide.is-active .title .w{opacity:1;filter:blur(0);transition-delay:calc(.18s + var(--w,0)*.06s)}
.measuring .title .w{transition:none!important;opacity:1!important;filter:none!important}
/* section numeral + hero numbers in gradient metal */
.numeral-xl,.mega,.st-n,.tl-date{background:linear-gradient(160deg,var(--accent) 10%,var(--accent2) 95%);-webkit-background-clip:text;background-clip:text;color:transparent}
.tl-date{background:linear-gradient(160deg,var(--text) 30%,var(--accent) 140%);-webkit-background-clip:text;background-clip:text}
/* stats → glass cards with an index, gradient value and a filling meter */
.stat-row{column-gap:var(--s4);align-items:stretch}
.stat{border:1px solid var(--glass-line);border-radius:calc(var(--radius) + 8px);padding:var(--s5) var(--s4);background:linear-gradient(160deg,var(--glass-hi) 0%,var(--glass) 60%);box-shadow:var(--card-sh);overflow:hidden}
.stat::before{left:var(--s4);top:0;width:72px;height:4px;border-radius:0 0 4px 4px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.stat::after{content:"";position:absolute;right:-90px;top:-90px;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 22%,transparent),transparent 70%);pointer-events:none}
.stat-ix{display:block;font-size:20px;letter-spacing:.16em;font-weight:650;color:var(--text3);margin-bottom:var(--s3)}
.stat-v{background:linear-gradient(170deg,var(--text) 35%,color-mix(in srgb,var(--accent) 70%,var(--text)) 120%);-webkit-background-clip:text;background-clip:text;color:transparent}
.stat-v .sfx{-webkit-text-fill-color:var(--accent)}
.meter{position:relative;height:8px;margin-top:var(--s4);border-radius:8px;background:color-mix(in srgb,var(--text) 9%,transparent);overflow:hidden}
.meter i{position:absolute;inset:0;border-radius:8px;transform-origin:0 50%;transform:scaleX(0);background:linear-gradient(90deg,var(--accent),var(--accent2));box-shadow:0 0 18px color-mix(in srgb,var(--accent) 55%,transparent);transition:transform 1.1s var(--ease)}
.slide.is-active .meter i{transform:scaleX(var(--p,0));transition-delay:calc(.45s + var(--k,0)*.12s)}
.measuring .meter i{transition:none!important}
/* percentage hero: progress ring around the number */
.ring-wrap{position:relative;width:640px;height:640px;display:flex;align-items:center;justify-content:center;margin:0 auto}
.ring{position:absolute;inset:0;border-radius:50%;--pp:0;background:conic-gradient(from -90deg,var(--accent) 0,var(--accent2) calc(var(--pp)*360deg),color-mix(in srgb,var(--text) 8%,transparent) calc(var(--pp)*360deg));-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 34px),#000 calc(100% - 33px));mask:radial-gradient(farthest-side,transparent calc(100% - 34px),#000 calc(100% - 33px));transition:--pp 1.3s var(--ease) .3s;filter:drop-shadow(0 0 24px color-mix(in srgb,var(--accent) 45%,transparent))}
.slide.is-active .ring{--pp:var(--p)}
.measuring .ring{transition:none!important}
.mega.in-ring{position:relative;line-height:1}
/* concept / step / hierarchy cards become glass panels */
.concept{border:1px solid var(--glass-line);border-radius:calc(var(--radius) + 6px);padding:var(--s5) var(--s4) var(--s5);background:linear-gradient(170deg,var(--glass-hi) 0%,var(--glass) 70%);box-shadow:var(--card-sh);overflow:hidden;align-self:stretch}
.concept::before{left:var(--s4);top:0;width:56px;height:4px;border-radius:0 0 4px 4px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.concept::after{content:"";position:absolute;right:-80px;top:-80px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--accent) 20%,transparent),transparent 70%);pointer-events:none}
.concepts{align-items:stretch}
.concept-l,.concept-d{position:relative;z-index:1}
.st{border:1px solid var(--glass-line);border-radius:calc(var(--radius) + 6px);padding:var(--s4) var(--s4) var(--s5);background:linear-gradient(170deg,var(--glass-hi) 0%,var(--glass) 70%);box-shadow:var(--card-sh);position:relative}
.steps{align-items:stretch;column-gap:var(--s4)}
.st-arrow{background:linear-gradient(90deg,var(--accent),transparent);height:2px}
.st-arrow::after{border-color:var(--accent)}
.steps.wrap .st-mark{border-bottom:0;padding-bottom:0}
.hn{background:linear-gradient(170deg,var(--glass-hi) 0%,var(--glass) 70%);border-color:var(--glass-line);box-shadow:var(--card-sh);border-radius:calc(var(--radius) + 6px);padding:var(--s4) var(--s4) var(--s5)}
.hn::after{content:"";position:absolute;left:var(--s4);top:-1px;width:44px;height:4px;border-radius:0 0 4px 4px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.tree::before,.tree::after,.hn::before{background:linear-gradient(180deg,var(--accent),color-mix(in srgb,var(--accent) 30%,transparent))}
/* rows: numbered pills */
.row-n{width:auto;min-width:56px;height:38px;padding:0 12px;margin-top:2px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;font-size:20px;background:color-mix(in srgb,var(--accent) 14%,transparent);border:1px solid color-mix(in srgb,var(--accent) 35%,transparent);color:var(--accent)}
.rows{border-top:0}
.row{border-bottom:1px solid var(--line-soft);align-items:flex-start}
.row:first-child{border-top:1px solid var(--line-soft)}
/* timeline: glowing nodes on a line that draws itself */
.tl-mark::before{height:2px;margin-top:-1px;background:linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent2) 60%,transparent));transform-origin:0 50%;transform:scaleX(0);transition:transform .9s var(--ease)}
.slide.is-active .tl-mark::before{transform:scaleX(1);transition-delay:calc(.35s + var(--i,0)*.05s)}
.measuring .tl-mark::before{transition:none!important;transform:none!important}
.tl-mark::after{width:22px;height:22px;margin-top:-11px;background:var(--bg);border:5px solid var(--accent);box-shadow:0 0 0 6px var(--bg),0 0 28px 4px color-mix(in srgb,var(--accent) 55%,transparent)}
/* table: header band + soft zebra */
.data-table th{background:color-mix(in srgb,var(--accent) 12%,transparent);padding:var(--s3) var(--s3) var(--s3) var(--s3);border-bottom:2px solid var(--accent)}
.data-table th:first-child{border-top-left-radius:var(--radius)}.data-table th:last-child{border-top-right-radius:var(--radius)}
.data-table td{padding-left:var(--s3)}
.data-table tbody tr:nth-child(even) td{background:var(--glass)}
/* quote: gradient mark */
.qmark{background:linear-gradient(160deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
/* photos: cinematic slow push-in + inner light edge */
.photo{box-shadow:var(--card-sh)}
.photo::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);pointer-events:none}
.photo .ph,.bleed .ph{transform:scale(1.08);transition:transform 2.4s var(--ease)}
.slide.is-active .photo .ph,.slide.is-active .bleed .ph{transform:scale(1)}
/* accent rule becomes a gradient bar */
.rule{background:linear-gradient(90deg,var(--accent),var(--accent2))}
/* decoration sits behind the text, never on top of the folio */
.deco{opacity:.75;-webkit-mask-image:linear-gradient(0deg,transparent 0,#000 140px);mask-image:linear-gradient(0deg,transparent 0,#000 140px)}

/* ══ INFOGRAPHICS (design/infographics.js) — one highlighted mark, muted rest, hairline axes, text in text colours ══ */
.igs{align-items:center}.igs-l,.igs-r{align-self:center}
.igk{display:flex;flex-direction:column;justify-content:center;gap:var(--s6)}.igk-head{align-items:start}
.ig-wrap{position:relative}
.ig{position:relative}
.ig>*{position:absolute}
.ig-svg{left:0;top:0;overflow:visible}
.ig-lab,.ig-val,.ig-det,.ig-big,.ig-date,.ig-center,.ig-n,.ig-vs-t{line-height:1.22;margin:0;text-wrap:balance}
.ig-lab{color:var(--text2)}
.ig-lab.strong{color:var(--text);font-weight:700}
.ig-det{color:var(--text2);line-height:1.38;text-wrap:pretty}
.ig-det-in{color:var(--text2);font-weight:400}
.right{text-align:right}.center{text-align:center}
.ig-val{color:var(--text);font-weight:700;letter-spacing:-.01em;font-variant-numeric:lining-nums;white-space:nowrap}
.ig-val.muted{color:var(--text3);font-weight:400}
.ig-big{color:var(--text);font-weight:700;letter-spacing:-.025em;line-height:1;white-space:nowrap;font-variant-numeric:lining-nums}
.ig-k{color:var(--accent);font-weight:700;margin-right:.2em}
.ig-n{color:var(--accent);font-weight:700}
.ig-center{font-family:var(--f-display);font-weight:var(--tw);color:var(--text);line-height:1.1}
.ig-date{color:var(--accent);font-weight:700;letter-spacing:-.01em;line-height:1.1}
.ig-source{margin-top:var(--s3);font-size:20px;color:var(--text3);letter-spacing:.02em}
/* bars / columns */
.ig-track{border-radius:0 8px 8px 0;background:color-mix(in srgb,var(--text) 8%,transparent)}
.ig-bar{border-radius:0 8px 8px 0;background:color-mix(in srgb,var(--text) 30%,transparent)}
.ig-bar.on{background:linear-gradient(90deg,var(--accent),var(--accent2));box-shadow:0 0 26px color-mix(in srgb,var(--accent) 45%,transparent)}
.ig-col{border-radius:10px 10px 0 0;background:color-mix(in srgb,var(--text) 22%,transparent)}
.ig-col.on{background:linear-gradient(180deg,var(--accent2),var(--accent));box-shadow:0 0 30px color-mix(in srgb,var(--accent) 40%,transparent)}
.ig-axis{background:var(--line)}
.ig-grid{stroke:var(--line-soft);stroke-width:1}
.ig-base{stroke:var(--line);stroke-width:2}
/* donut */
.ig-ring-track{stroke:color-mix(in srgb,var(--text) 7%,transparent)}
.ig-sw{border-radius:5px}
/* compare */
.ig-vs{border-radius:50%;border:2px solid var(--accent);background:var(--bg)}
.ig-vs-t{color:var(--accent);font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.ig-split{display:flex;gap:4px}.ig-split i{position:static;display:block;height:100%}
.ig-split .a{border-radius:13px 0 0 13px;background:linear-gradient(90deg,var(--accent),var(--accent2))}
.ig-split .b{border-radius:0 13px 13px 0;background:color-mix(in srgb,var(--text) 18%,transparent)}
/* pictogram */
.ig-pic{display:flex;align-items:flex-end;justify-content:center;color:color-mix(in srgb,var(--text) 16%,transparent)}
.ig-pic.on{color:var(--accent)}
/* cycle / nodes / badges */
.ig-arc{fill:none;stroke:var(--accent);stroke-width:3;opacity:.75}
.ig-node,.ig-badge{display:flex;align-items:center;justify-content:center;border-radius:50%}
.ig-node{background:linear-gradient(160deg,var(--glass-hi),var(--glass));border:2px solid color-mix(in srgb,var(--accent) 55%,transparent);color:var(--accent);box-shadow:var(--card-sh)}
.ig-node.on{background:linear-gradient(140deg,var(--accent),var(--accent2));color:var(--accent-ink);border-color:transparent}
.ig-badge{background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent)}
.ig-badge.on{background:linear-gradient(140deg,var(--accent),var(--accent2));color:var(--accent-ink)}
.ig-dot{border-radius:50%;background:var(--accent);box-shadow:0 0 0 6px color-mix(in srgb,var(--accent) 25%,transparent)}
/* funnel / pyramid */
.ig-band{border-radius:4px}
.ig-lead{background:var(--line)}
/* cards (matrix, icon grid) */
.ig-card{border:1px solid var(--glass-line);border-radius:calc(var(--radius) + 8px);background:linear-gradient(165deg,var(--glass-hi) 0%,var(--glass) 70%);box-shadow:var(--card-sh);overflow:hidden}
.ig-card::before{content:"";position:absolute;left:32px;top:0;width:64px;height:4px;border-radius:0 0 4px 4px;background:var(--c,linear-gradient(90deg,var(--accent),var(--accent2)))}
/* pros / cons */
.ig-col-head{border-radius:3px}.ig-col-head.good{background:linear-gradient(90deg,var(--accent),var(--accent2))}.ig-col-head.bad{background:var(--text3)}
.ig-mark{display:flex;align-items:center;justify-content:center;border-radius:50%}
.ig-mark.good{background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}
.ig-mark.bad{background:color-mix(in srgb,var(--text) 10%,transparent);color:var(--text2)}
/* roadmap */
.ig-road{border-radius:3px;background:linear-gradient(90deg,color-mix(in srgb,var(--accent2) 60%,transparent),var(--accent))}
.ig-stem{background:var(--line)}
.ig-mile{border-radius:50%;background:var(--bg);border:5px solid var(--accent)}
.ig-mile.on{background:var(--accent);box-shadow:0 0 0 8px color-mix(in srgb,var(--accent) 22%,transparent),0 0 30px color-mix(in srgb,var(--accent) 60%,transparent)}
.ig .ic{display:block}

/* free decks: the bottom-right corner is kept for the "Made in DeadLine" card (a native PPTX object) */
.has-badge .folio{right:calc(var(--mx) + 300px)}

/* slides that carry their own hero graphic stay clean */
.sect-slide .deco,.quote-slide .deco,.numb-slide .deco,.stmt-slide .deco,.ig-slide .deco{display:none}
/* client reference skins keep their own flat design */
.ref-decor .aurora,.ref-decor .halo,.ref-decor .ghost,.ref-flat .aurora,.ref-flat .halo{display:none}

/* ── chrome (hidden in export) ── */
#dots{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:20;display:flex;gap:6px}
.dot{width:5px;height:5px;border-radius:50%;padding:0;background:color-mix(in srgb,var(--text) 28%,transparent);transition:all .3s}
.dot.is-on{width:22px;border-radius:4px;background:var(--accent)}
#controls{position:absolute;right:28px;top:26px;z-index:20;display:flex;gap:8px}
.ctrl{width:40px;height:40px;border-radius:50%;border:1px solid color-mix(in srgb,var(--text) 16%,transparent);background:color-mix(in srgb,var(--bg) 55%,transparent);backdrop-filter:blur(10px)}
#progress{position:absolute;left:0;bottom:0;height:2px;width:0;z-index:25;background:var(--accent);transition:width .5s var(--ease)}
#hint{position:absolute;left:50%;bottom:34px;transform:translateX(-50%);z-index:15;font-size:14px;letter-spacing:.12em;color:color-mix(in srgb,var(--text) 34%,transparent);pointer-events:none;transition:opacity .6s}
.hint-hide{opacity:0}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition-duration:.01ms!important}.slide{transform:none!important;filter:none!important}}
`;
}

module.exports = { css, paletteVars, fontFaces };
