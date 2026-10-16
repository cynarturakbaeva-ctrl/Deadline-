'use strict';
/**
 * LEDGER («Есеп») — бизнес, экономика, менеджмент, туризм: таза ақ қағаз, батыл қара тақырып, бір ғана акцент,
 * ірі сандар, жіңішке «кітап-есеп» сызықтары, сол жақта түсті вертикаль жолақ; мағынасына сай ірі белгішелер.
 */
const T = require('../tokens');

const S = '#stage.ds-ledger';
function css(p) {
  const acc = p.accent;
  const ink = p.text;
  const hair = T.mixHex(p.bg, p.text, 0.14);
  return [
    `${S} .deco,${S} .aurora,${S} .halo{display:none!important}`,
    `${S} .layer-bg::before,${S} .layer-bg::after{display:none!important}`,
    `${S} .plate,${S} .plate-cover,${S} .plate-section{background:linear-gradient(90deg,${acc} 0 14px,transparent 14px),var(--bg)!important}`,
    `${S} .L-section .plate-section{background:${acc}!important}`,
    `${S} .L-section .canvas{--text:#fff;--text2:rgba(255,255,255,.88);--text3:rgba(255,255,255,.75);--accent:#fff;color:#fff}`,
    `${S} .plate-cover{background:linear-gradient(90deg,${acc} 0 14px,transparent 14px),linear-gradient(0deg,${acc} 0 14px,transparent 14px),var(--bg)!important}`,
    `${S} .title .hl{background:linear-gradient(transparent 62%,${T.mixHex(p.bg, acc, 0.28)} 62% 92%,transparent 92%)!important;-webkit-text-fill-color:${ink}!important;color:${ink}!important}`,
    `${S} .kicker{color:${acc};font-weight:800;letter-spacing:.16em}`,
    `${S} .rule{background:${acc}!important;height:6px!important;width:72px!important}`,
    // тізім мен карточкалар: «есеп кітабы» — жіңішке сызықтар, ірі нөмір
    `${S} .rows{border-top:3px solid ${ink}}${S} .row{border-color:${hair}}`,
    // «көмескі индекс»: тізім нөмірі — қатардың артындағы ірі, бозғылт сан (журнал/есеп беттеріндегідей)
    `${S} .row{position:relative}`,
    `${S} .row-n{position:absolute!important;left:-4px;top:50%;transform:translateY(-54%);width:auto!important;height:auto!important;margin:0!important;padding:0!important;background:none!important;border:0!important;` +
      `color:${T.mixHex(p.bg, acc, 0.2)}!important;font-weight:800;font-size:120px!important;line-height:1;letter-spacing:-.06em;z-index:0}`,
    `${S} .row-b{position:relative;z-index:1;padding-left:176px}`,
    `${S} .concept{background:none!important;border:0!important;border-top:3px solid ${ink}!important;border-radius:0!important;box-shadow:none!important;padding-top:28px!important}`,
    `${S} .concept::before,${S} .concept::after{display:none!important}`,
    `${S} .concept-n{color:${acc}!important;font-weight:800;letter-spacing:0;font-size:22px}`,
    `${S} .stat{background:none!important;border:0!important;border-left:3px solid ${acc}!important;border-radius:0!important;box-shadow:none!important;padding-left:30px!important}`,
    `${S} .stat::before,${S} .stat::after{display:none!important}`,
    `${S} .numeral-xl,${S} .mega,${S} .st-n,${S} .stat-v,${S} .tl-date{background:none!important;-webkit-text-fill-color:${ink}!important;color:${ink}!important;font-weight:800!important;letter-spacing:-.04em}`,
    `${S} .tl-mark::before{background:${ink}!important;height:2px!important}`,
    `${S} .tl-mark::after{background:${acc}!important;border-radius:0!important;box-shadow:0 0 0 6px var(--bg)!important}`,
    `${S} .ig-card{background:none!important;border:1px solid ${hair}!important;border-radius:0!important;box-shadow:none!important}`,
    `${S} .decor{position:absolute;visibility:hidden;pointer-events:none;object-fit:contain;opacity:.6}`,
    `${S} .decor[data-decor="pair"]{opacity:.32}`,
    `${S} .photo{border-radius:0!important;box-shadow:none!important}`,
  ].join('\n');
}

module.exports = {
  id: 'ledger',
  name: 'Есеп',
  type: { display: 'arial', text: 'sans', dw: 800, tw: 800, dt: '-0.035em', tt: '-0.03em', dl: 1.0, tl: 1.04 },
  moods: ['cloud', 'ivory', 'mint', 'light'],
  num: 'pad',
  folio: { title: true, total: false, pad: true, cover: false },
  cover: 'classic',
  closing: 'rows',
  iconDecor: true,
  iconStroke: 1,
  iconMax: 280,
  css,
};
