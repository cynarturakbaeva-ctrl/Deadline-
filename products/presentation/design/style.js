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

function fontFaces() {
  let css = '';
  const inter = fontData('InterVariable.woff2', 'font/woff2', "woff2-variations");
  if (inter) css += "@font-face{font-family:'Inter';font-style:normal;font-weight:100 900;font-display:block;src:url(" + inter.uri + ") format('" + inter.fmt + "')}\n";
  const serif = fontData('DisplaySerif.ttf', 'font/ttf', 'truetype');
  if (serif) css += "@font-face{font-family:'DisplayFace';font-style:normal;font-weight:400 700;font-display:block;src:url(" + serif.uri + ") format('" + serif.fmt + "')}\n";
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
html,body{margin:0;height:100%;background:#000;color:var(--text);font-family:var(--f-text);overflow:hidden;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;font-kerning:normal}
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
.folio-l{max-width:70%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* ── reveal ── */
.rv{opacity:0;transform:translateY(14px);transition:opacity .7s var(--ease),transform .7s var(--ease)}
.slide.is-active .rv{opacity:1;transform:none;transition-delay:calc(.12s + var(--i,0)*.07s)}
.measuring .rv,.measuring .figure,.measuring .bleed .ph,.measuring .full .ph{transition:none!important;opacity:1!important;transform:none!important}

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
.conc{display:flex;flex-direction:column;justify-content:center;gap:var(--s8)}
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
