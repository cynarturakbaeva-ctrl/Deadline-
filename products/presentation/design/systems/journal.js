'use strict';
/**
 * ЖУРНАЛ — сапалы баспасөз беті: Times тақырып (жеңіл салмақ, үлкен), Arial мәтін, қос сызық, курсив кілт сөз,
 * нөмірлер курсивпен, жақтаусыз тік бұрышты фото, бет нөмірі ЖОҒАРЫДА. Атмосфералық эффект жоқ — таза «қағаз».
 */
const { calm, solid, CARDS, CARD_DECOR } = require('./_fx');

const S = '#stage.ds-journal';
module.exports = {
  id: 'journal',
  name: 'Журнал',
  type: { display: 'serif', text: 'arial', dw: 400, tw: 400, dt: '-0.02em', tt: '-0.012em', dl: 1.0, tl: 1.06, italicQuote: true },
  moods: ['ivory', 'sand', 'light', 'blush', 'archive', 'wine', 'forest'],
  num: 'plain',
  folio: { title: true, total: false, pad: false, cover: false },
  cover: 'masthead',
  closing: 'split', // фото бір жақта, түйіндер екінші жақта
  css: () => [
    calm(S),
    `${S} .plate,${S} .plate-cover{background:var(--bg)}`,
    `${S} .plate-section{background:var(--bg2)}`,
    solid(`${S} .title .hl`, 'var(--accent)'),
    `${S} .title .hl{font-style:italic}`,
    // қос сызық (газет бағанының белгісі)
    `${S} .rule{height:7px;background:none!important;border-top:2px solid var(--text);border-bottom:1px solid var(--text);border-radius:0;opacity:.85}`,
    // бет нөмірі жоғарыда: курсив тақырып + нөмір
    `${S} .folio{top:44px;bottom:auto;font-family:var(--f-display);font-style:italic;text-transform:none;letter-spacing:.01em;font-size:22px;color:var(--text3);border-bottom:1px solid var(--line);padding-bottom:12px}`,
    `${S} .folio b{font-style:normal;font-weight:400;font-size:24px;color:var(--text)}`,
    // тізім нөмірлері — курсив сандар, таблеткасыз
    `${S} .row-n{background:none;border:0;border-radius:0;min-width:44px;height:auto;padding:0;margin-top:0;font-family:var(--f-display);font-style:italic;font-size:34px;line-height:1.05;letter-spacing:0;font-weight:400;color:var(--accent)}`,
    `${S} .row,${S} .row:first-child{border-color:var(--line)}`,
    `${S} .rows{border-top:2px solid var(--text)}`,
    // карточкалар → баған: жоғарыда қара сызық, фонсыз
    `${S} ${CARDS.split(',').join(`,${S} `)}{background:none;border:0;border-top:2px solid var(--text);border-radius:0;box-shadow:none;padding:var(--s4) var(--s2) var(--s3) 0}`,
    `${S} ${CARD_DECOR.split(',').join(`,${S} `)}{display:none}`,
    `${S} .concept-n,${S} .hn-n,${S} .stat-ix{font-family:var(--f-display);font-style:italic;letter-spacing:0;font-size:26px;font-weight:400}`,
    solid(`${S} .stat-v`, 'var(--text)'),
    solid(`${S} .numeral-xl,${S} .mega,${S} .st-n`, 'var(--accent)'),
    solid(`${S} .tl-date`, 'var(--text)'),
    `${S} .stat-v,${S} .mega,${S} .numeral-xl{font-weight:400}`,
    `${S} .meter{height:2px;border-radius:0;background:var(--line)}${S} .meter i{border-radius:0;background:var(--text);box-shadow:none}`,
    // фото: тік бұрыш, жіңішке қара жиек, көлеңкесіз
    `${S} .photo{border:1px solid var(--text);border-radius:0!important;box-shadow:none}${S} .photo::after{display:none}`,
    `${S} .notes li{border-left:1px solid var(--text);font-style:italic}`,
    `${S} .data-table th{background:none;border-bottom:2px solid var(--text);color:var(--text);font-family:var(--f-display);font-style:italic;text-transform:none;letter-spacing:0;font-size:24px}`,
    `${S} .data-table tbody tr:nth-child(even) td{background:none}`,
    solid(`${S} .qmark`, 'var(--accent)'),
    `${S} .tl-mark::after{width:14px;height:14px;margin-top:-7px;border:0;background:var(--text);box-shadow:0 0 0 5px var(--bg)}`,
    `${S} .tl-mark::before{background:var(--text);height:1px}`,
    `${S} .st-arrow{background:var(--text);height:1px}${S} .st-arrow::after{border-color:var(--text)}`,
    `${S} .meta-k{font-family:var(--f-display);font-style:italic;text-transform:none;letter-spacing:0;font-size:22px}`,
    `${S} .ig-bar.on,${S} .ig-col.on,${S} .ig-road{background:var(--accent);box-shadow:none}`,
    `${S} .ig-node{background:var(--bg);box-shadow:none}`,
  ].join('\n'),
};
