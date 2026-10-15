'use strict';
/**
 * ШВЕЙЦАР — халықаралық типографиялық стиль: Arial Bold тығыз тақырып, тұтас акцент түсті кілт сөз,
 * шаршы маркер, үлкен жалаң нөмірлер, тұтас түсті тікбұрышты блоктар, жиексіз фото, мұқабада түсті панель.
 * Атмосфера жоқ: жалпақ фон, қатаң тор.
 */
const { calm, solid, CARDS, CARD_DECOR } = require('./_fx');

const S = '#stage.ds-swiss';
module.exports = {
  id: 'swiss',
  name: 'Швейцар',
  type: { display: 'arial', text: 'arial', dw: 700, tw: 700, dt: '-0.035em', tt: '-0.025em', dl: 0.98, tl: 1.02 },
  moods: ['cloud', 'light', 'graphite', 'midnight', 'mint', 'ivory', 'vivid'],
  num: 'plain',
  folio: { title: false, total: false, pad: false, cover: false },
  stack: 'left', // мазмұн слайдтарында тақырып жоғарыда
  cover: 'panel',
  closing: 'rows',
  css: () => [
    calm(S),
    `${S} .plate,${S} .plate-cover,${S} .plate-section{background:var(--bg)}`,
    solid(`${S} .title .hl`, 'var(--accent)'),
    // шаршы маркер
    `${S} .rule{width:22px!important;height:22px;border-radius:0;background:var(--accent)!important}`,
    // бет нөмірі: тек сан, сол жақта, қалың
    `${S} .folio{justify-content:flex-start;font-size:26px;letter-spacing:0;font-weight:700;color:var(--text)}${S} .folio-l,${S} .folio .of{display:none}`,
    `${S} .folio b{font-weight:700;color:var(--text)}`,
    `${S} .folio::before{content:'';display:inline-block;width:14px;height:14px;background:var(--accent);margin-right:14px;align-self:center}`,
    // тізім нөмірлері — үлкен қалың сандар
    `${S} .row-n{background:none;border:0;border-radius:0;min-width:64px;height:auto;padding:0;margin-top:0;font-size:40px;line-height:1;letter-spacing:-.03em;font-weight:700;color:var(--accent)}`,
    `${S} .rows{border-top:4px solid var(--text)}${S} .row,${S} .row:first-child{border-color:var(--line)}`,
    `${S} .row-l.strong,${S} .concept-l,${S} .st-l,${S} .hn-l{font-weight:700;letter-spacing:-.02em}`,
    // карточкалар → тұтас блоктар
    `${S} ${CARDS.split(',').join(`,${S} `)}{background:var(--bg2);border:0;border-radius:0;box-shadow:none}`,
    `${S} ${CARD_DECOR.split(',').join(`,${S} `)}{display:none}`,
    `${S} .concept,${S} .st,${S} .hn,${S} .stat{border-top:8px solid var(--accent)}`,
    `${S} .concept-n,${S} .hn-n,${S} .stat-ix{font-size:30px;letter-spacing:-.02em;font-weight:700;color:var(--accent)}`,
    solid(`${S} .stat-v`, 'var(--text)'),
    solid(`${S} .numeral-xl,${S} .mega,${S} .st-n`, 'var(--accent)'),
    solid(`${S} .tl-date`, 'var(--text)'),
    `${S} .meter{height:12px;border-radius:0;background:var(--bg3)}${S} .meter i{border-radius:0;background:var(--accent);box-shadow:none}`,
    `${S} .photo{border:0;border-radius:0!important;box-shadow:none}${S} .photo::after{display:none}`,
    `${S} .notes li{border-left:6px solid var(--accent)}`,
    `${S} .data-table th{background:var(--text);color:var(--bg);border-bottom:0;border-radius:0!important}`,
    `${S} .data-table tbody tr:nth-child(even) td{background:var(--bg2)}`,
    solid(`${S} .qmark`, 'var(--accent)'),
    `${S} .tl-mark::after{width:20px;height:20px;margin-top:-10px;border:0;border-radius:0;background:var(--accent);box-shadow:none}`,
    `${S} .tl-mark::before{background:var(--text);height:3px;margin-top:-1px}`,
    `${S} .st-arrow{background:var(--text);height:3px}${S} .st-arrow::after{border-color:var(--text);border-width:3px}`,
    `${S} .meta-k{letter-spacing:.02em;text-transform:none;font-weight:700;color:var(--text2)}`,
    `${S} .ig-bar.on,${S} .ig-col.on,${S} .ig-road,${S} .ig-split .a,${S} .ig-col-head.good{background:var(--accent);box-shadow:none;border-radius:0}`,
    `${S} .ig-bar,${S} .ig-col,${S} .ig-track{border-radius:0}`,
    `${S} .ig-node{background:var(--bg2);box-shadow:none;border-radius:0}${S} .ig-node.on,${S} .ig-badge.on{background:var(--accent)}`,
    `${S} .hl-panel{background:var(--accent)}`,
  ].join('\n'),
};
