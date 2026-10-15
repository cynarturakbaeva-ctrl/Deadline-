'use strict';
/**
 * АКАДЕМИЯ — университет баяндамасы, бірақ заманауи: Times Bold тақырып + Calibri мәтін, әр слайдтың жоғарғы
 * шетінде акцент жолақ, кілт сөздің астын сызу, дөңгелек нөмірлер «1», жиегі бар карточкалар, дөңгеленген фото,
 * бет нөмірі ортада «3 / 12». Мұқаба ортаға тураланған.
 */
const { calm, solid, CARDS, CARD_DECOR } = require('./_fx');

const S = '#stage.ds-academy';
module.exports = {
  id: 'academy',
  name: 'Академия',
  type: { display: 'serif', text: 'sans', dw: 700, tw: 700, dt: '-0.015em', tt: '-0.01em', dl: 1.02, tl: 1.08 },
  moods: ['ivory', 'cloud', 'mint', 'sand', 'midnight', 'forest', 'light'],
  num: 'plain',
  folio: { title: true, total: true, pad: false, cover: false },
  stack: 'center', // мазмұн слайдтарында тақырып жоғарыда
  cover: 'center',
  closing: 'split', // фото бір жақта, түйіндер екінші жақта
  css: () => [
    calm(S, { deco: true }),
    // жоғарғы акцент жолақ (виньетканың орнына)
    `${S} .layer-bg::before{display:block!important;content:'';position:absolute;left:0;right:0;top:0;height:14px;background:var(--accent);opacity:1;z-index:6}`,
    `${S} .plate,${S} .plate-cover{background:var(--bg)}`,
    // тақырып жоғарыда, ортада (ресми баяндама құрылымы)
    `${S} .stack-head{text-align:center;display:flex;flex-direction:column;align-items:center}${S} .stack-head .lead{margin-inline:auto;text-align:center}`,
    `${S} .plate-section{background:var(--bg2)}`,
    `${S} .deco{opacity:.45}`,
    solid(`${S} .title .hl`, 'inherit'),
    `${S} .title .hl{text-decoration:underline;text-decoration-color:var(--accent);text-decoration-thickness:.075em;text-underline-offset:.14em;text-decoration-skip-ink:none}`,
    `${S} .rule{height:6px;border-radius:3px;background:var(--accent)!important}`,
    // бет нөмірі ортада
    `${S} .folio{justify-content:center;gap:28px;letter-spacing:.08em}${S} .folio-l{max-width:52%}`,
    // дөңгелек нөмірлер
    `${S} .row-n{width:46px;min-width:46px;height:46px;padding:0;margin-top:0;border-radius:50%;border:0;background:var(--accent);color:var(--accent-ink);font-size:22px;letter-spacing:0;font-weight:700}`,
    `${S} .rows{border-top:0}${S} .row,${S} .row:first-child{border-color:var(--line-soft)}`,
    // карточкалар: жиегі бар, ақ/жұмсақ фон, көлеңкесіз
    `${S} ${CARDS.split(',').join(`,${S} `)}{background:var(--bg);border:2px solid var(--line);border-radius:16px;box-shadow:none}`,
    `${S} ${CARD_DECOR.split(',').join(`,${S} `)}{display:none}`,
    `${S} .concept-n,${S} .hn-n,${S} .stat-ix{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;background:var(--accent-soft);color:var(--accent);letter-spacing:0;font-size:20px}`,
    solid(`${S} .stat-v`, 'var(--accent)'),
    solid(`${S} .numeral-xl,${S} .mega,${S} .st-n`, 'var(--accent)'),
    solid(`${S} .tl-date`, 'var(--text)'),
    `${S} .meter{height:10px;border-radius:5px}${S} .meter i{background:var(--accent);box-shadow:none}`,
    `${S} .photo{border:0;border-radius:18px!important;box-shadow:0 18px 40px -22px rgba(0,0,0,.45)}${S} .photo::after{display:none}`,
    `${S} .notes li{border-left:4px solid var(--accent);background:var(--bg2);padding:var(--s2) var(--s3);border-radius:0 10px 10px 0}`,
    `${S} .data-table th{background:var(--accent);color:var(--accent-ink);border-bottom:0}`,
    `${S} .tl-mark::after{border-width:4px;box-shadow:0 0 0 6px var(--bg)}`,
    `${S} .tl-mark::before{background:var(--accent)}`,
    `${S} .ig-bar.on,${S} .ig-col.on,${S} .ig-road{background:var(--accent);box-shadow:none}`,
  ].join('\n'),
};
