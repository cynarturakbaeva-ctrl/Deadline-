'use strict';
/**
 * BLUEPRINT («Сызба») — IT, инженерия, жаратылыстану: қою көк «сызба қағазы», жұқа өлшеу торы,
 * моноширинді белгілер (01 / 02, [ ]), тақырып бойында өлшеу сызығы, ірі жіңішке белгішелер (мағынасына сай).
 */
const T = require('../tokens');

const S = '#stage.ds-blueprint';
function css(p) {
  const acc = p.accent;
  const grid = T.mixHex(p.bg, p.text, 0.07);
  const grid2 = T.mixHex(p.bg, p.text, 0.035);
  const line = T.mixHex(p.bg, acc, 0.45);
  return [
    `${S} .deco,${S} .aurora,${S} .halo{display:none!important}`,
    `${S} .layer-bg::before,${S} .layer-bg::after{display:none!important}`,
    `${S} .plate,${S} .plate-cover,${S} .plate-section{background:linear-gradient(${grid} 1px,transparent 1px) 0 0/120px 120px,linear-gradient(90deg,${grid} 1px,transparent 1px) 0 0/120px 120px,linear-gradient(${grid2} 1px,transparent 1px) 0 0/24px 24px,linear-gradient(90deg,${grid2} 1px,transparent 1px) 0 0/24px 24px,var(--bg)!important}`,
    // тақырып: кілт сөз акцентпен, алдында өлшеу белгісі
    `${S} .title .hl{background:none!important;-webkit-text-fill-color:${acc}!important;color:${acc}!important}`,
    `${S} .kicker{font-family:var(--f-mono,"Courier New",monospace);color:${acc};letter-spacing:.08em}`,
    `${S} .kicker::before{content:"// "}`,
    `${S} .rule{background:repeating-linear-gradient(90deg,${acc} 0 14px,transparent 14px 22px)!important;height:3px!important;width:180px!important}`,
    // карточкалар: жұқа рамка, бұрышында белгі
    `${S} .concept,${S} .stat,${S} .ig-card{background:${T.mixHex(p.bg, p.text, 0.04)}!important;border:1px solid ${line}!important;border-radius:4px!important;box-shadow:none!important;position:relative}`,
    `${S} .concept::before,${S} .stat::before{content:"+"!important;position:absolute!important;top:-14px!important;left:-9px!important;width:auto!important;height:auto!important;background:none!important;color:${acc};font:400 22px/1 monospace}`,
    `${S} .concept::after,${S} .stat::after{display:none!important}`,
    `${S} .concept-n,${S} .row-n,${S} .stat-ix{font-family:"Courier New","Liberation Mono",monospace!important;color:${acc}!important;background:none!important;border:0!important;letter-spacing:0}`,
    `${S} .row-n::before{content:"[";opacity:.6}${S} .row-n::after{content:"]";opacity:.6}`,
    `${S} .rows{border-top:1px solid ${line}}${S} .row{border-color:${T.mixHex(p.bg, p.text, 0.12)}}`,
    // уақыт сызығы: пунктир, түйіндер — шаршы
    `${S} .tl-mark::before{background:repeating-linear-gradient(90deg,${line} 0 10px,transparent 10px 16px)!important}`,
    `${S} .tl-mark::after{border-radius:2px!important;background:${acc}!important;box-shadow:0 0 0 6px var(--bg)!important}`,
    `${S} .tl-date,${S} .numeral-xl,${S} .mega,${S} .st-n,${S} .stat-v{background:none!important;-webkit-text-fill-color:${acc}!important;color:${acc}!important;font-family:"Courier New","Liberation Mono",monospace!important;font-weight:700!important;letter-spacing:-.02em}`,
    // мағыналы белгішелер: жарқырамайтын, жұқа
    `${S} .decor{position:absolute;visibility:hidden;pointer-events:none;object-fit:contain;opacity:.55}`,
    `${S} .decor[data-decor="pair"]{opacity:.35}`,
    `${S} .photo{border-radius:4px!important;border:1px solid ${line}!important;box-shadow:none!important}`,
  ].join('\n');
}

module.exports = {
  id: 'blueprint',
  name: 'Сызба',
  type: { display: 'arial', text: 'sans', dw: 700, tw: 700, dt: '-0.025em', tt: '-0.02em', dl: 1.04, tl: 1.08 },
  moods: ['midnight', 'cold', 'graphite'],
  num: 'pad',
  folio: { title: true, total: true, pad: true, cover: false },
  cover: 'classic',
  closing: 'rows',
  iconDecor: true,
  iconStroke: 0.9,
  iconMax: 340,
  css,
};
