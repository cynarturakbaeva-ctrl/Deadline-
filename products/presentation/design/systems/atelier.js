'use strict';
/**
 * АТЕЛЬЕ — жұмсақ заманауи стиль: Arial тақырып (кәдімгі салмақ, үлкен, тығыз), кілт сөз Times курсивімен
 * (контраст), дөңгелек нүкте-маркер, дөңгелек бұрышты толтырылған карточкалар, үлкен радиусты фото, жұмсақ
 * пастель фон, бет нөмірі тек оң жақта. Мұқаба ортаға тураланған.
 */
const { calm, solid, CARDS, CARD_DECOR } = require('./_fx');

const S = '#stage.ds-atelier';
module.exports = {
  id: 'atelier',
  name: 'Ателье',
  type: { display: 'arial', text: 'sans', dw: 400, tw: 400, dt: '-0.04em', tt: '-0.03em', dl: 1.0, tl: 1.06 },
  moods: ['blush', 'sand', 'mint', 'cloud', 'vivid', 'wine', 'forest'],
  num: 'pad',
  folio: { title: false, total: true, pad: true, cover: false },
  cover: 'center',
  closing: 'split', // фото бір жақта, түйіндер екінші жақта
  css: () => [
    calm(S, { aurora: true }),
    `${S} .aurora{opacity:.55;filter:blur(110px) saturate(1.05)}`,
    `${S} .plate,${S} .plate-cover,${S} .plate-section{background:radial-gradient(70% 80% at 90% 10%,var(--bg2) 0%,transparent 70%),var(--bg)}`,
    // кілт сөз: Times курсив, акцент
    solid(`${S} .title .hl`, 'var(--accent)'),
    `${S} .title .hl{font-family:"Times New Roman","Liberation Serif",serif;font-style:italic;letter-spacing:-.01em;padding-right:.06em}`,
    `${S} .rule{width:16px!important;height:16px;border-radius:50%;background:var(--accent)!important}`,
    `${S} .folio{justify-content:flex-end;letter-spacing:.06em}${S} .folio-l{display:none}`,
    `${S} .row-n{border:0;background:var(--accent-soft);color:var(--accent);border-radius:999px;font-weight:700}`,
    `${S} .rows{border-top:0}${S} .row,${S} .row:first-child{border:0}${S} .row{padding:var(--s3) 0}`,
    // карточкалар: толтырылған, үлкен радиус
    `${S} ${CARDS.split(',').join(`,${S} `)}{background:var(--bg2);border:0;border-radius:32px;box-shadow:none}`,
    `${S} ${CARD_DECOR.split(',').join(`,${S} `)}{display:none}`,
    `${S} .concept-n,${S} .hn-n,${S} .stat-ix{color:var(--accent)}`,
    solid(`${S} .stat-v`, 'var(--text)'),
    `${S} .stat-v,${S} .mega,${S} .numeral-xl,${S} .st-n{font-weight:400}`,
    solid(`${S} .numeral-xl,${S} .mega,${S} .st-n`, 'var(--accent)'),
    `${S} .meter{height:14px;border-radius:14px}${S} .meter i{border-radius:14px;box-shadow:none}`,
    `${S} .photo{border:0;border-radius:36px!important;box-shadow:0 30px 60px -34px rgba(0,0,0,.45)}${S} .photo::after{display:none}`,
    `${S} .bleed{border-radius:0}`,
    `${S} .notes li{border-left:0;background:var(--bg2);border-radius:20px;padding:var(--s2) var(--s3)}`,
    `${S} .data-table th:first-child{border-top-left-radius:20px}${S} .data-table th:last-child{border-top-right-radius:20px}`,
    `${S} .tl-mark::after{border-width:0;background:var(--accent);box-shadow:0 0 0 8px var(--accent-soft)}`,
    `${S} .ig-card{border-radius:32px}`,
  ].join('\n'),
};
