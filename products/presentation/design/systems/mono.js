'use strict';
/**
 * ТЕХНО — инженерлік/IT стиль: Arial Bold тақырып, Calibri мәтін, барлық белгі-жазулар Courier New (моно),
 * нөмірлер [01], кілт сөз маркермен боялған, пунктир сызық, жіңішке жиекті шаршы карточкалар бұрыш белгісімен,
 * фото ығыстырылған акцент жақтаумен, торлы фон.
 */
const { calm, solid, CARDS, CARD_DECOR } = require('./_fx');

const S = '#stage.ds-mono';
const MONO = '"Courier New","Liberation Mono",monospace';
module.exports = {
  id: 'mono',
  name: 'Техно',
  type: { display: 'arial', text: 'sans', dw: 700, tw: 700, dt: '-0.03em', tt: '-0.02em', dl: 1.0, tl: 1.04 },
  moods: ['midnight', 'cold', 'graphite', 'cloud', 'forest', 'mint'],
  num: 'bracket',
  folio: { title: true, total: true, pad: true, cover: true },
  cover: 'classic',
  closing: 'rows',
  css: () => [
    calm(S, { deco: true }),
    // фон: нәзік инженерлік тор (барлық фото-сыз слайдта)
    `${S} .plate,${S} .plate-cover,${S} .plate-section{background:linear-gradient(color-mix(in srgb,var(--text) 6%,transparent) 1px,transparent 1px) 0 0/64px 64px,linear-gradient(90deg,color-mix(in srgb,var(--text) 6%,transparent) 1px,transparent 1px) 0 0/64px 64px,var(--bg)}`,
    `${S} .deco{display:none}`,
    // моно белгі-жазулар
    `${S} .kicker,${S} .folio,${S} .row-n,${S} .meta-k,${S} .stat-ix,${S} .concept-n,${S} .hn-n,${S} .data-table th,${S} .ig-source,${S} .cover-org,${S} .ref-n{font-family:${MONO};letter-spacing:0;text-transform:none}`,
    `${S} .folio{font-size:20px;color:var(--text3)}${S} .folio-l::before{content:'// '}`,
    // маркермен боялған кілт сөз
    solid(`${S} .title .hl`, 'inherit'),
    `${S} .title .hl{background:color-mix(in srgb,var(--accent) 32%,transparent)!important;padding:0 .1em;margin:0 -.04em;-webkit-box-decoration-break:clone;box-decoration-break:clone}`,
    `${S} .rule{height:0;background:none!important;border-top:4px dashed var(--accent);border-radius:0}`,
    `${S} .row-n{background:none;border:0;border-radius:0;min-width:64px;height:auto;padding:0;margin-top:.15em;font-size:22px;font-weight:700;color:var(--accent)}`,
    `${S} .rows{border-top:1px dashed var(--line)}${S} .row,${S} .row:first-child{border-color:var(--line);border-bottom-style:dashed}`,
    // карточкалар: шаршы, жіңішке жиек, сол жақ жоғарғы бұрышта акцент «белгі»
    `${S} ${CARDS.split(',').join(`,${S} `)}{background:color-mix(in srgb,var(--bg) 88%,var(--text));border:1px solid color-mix(in srgb,var(--accent) 45%,transparent);border-radius:0;box-shadow:none}`,
    `${S} ${CARD_DECOR.split(',').join(`,${S} `)}{display:none}`,
    `${S} .concept::before,${S} .stat::before{display:block!important;content:'';position:absolute;left:-1px;top:-1px;width:18px;height:18px;border-left:4px solid var(--accent);border-top:4px solid var(--accent);background:none;border-radius:0}`,
    solid(`${S} .stat-v`, 'var(--text)'),
    solid(`${S} .numeral-xl,${S} .mega,${S} .st-n`, 'var(--accent)'),
    solid(`${S} .tl-date`, 'var(--accent)'),
    `${S} .meter{height:10px;border-radius:0;background:repeating-linear-gradient(90deg,color-mix(in srgb,var(--text) 14%,transparent) 0 10px,transparent 10px 14px)}${S} .meter i{border-radius:0;background:repeating-linear-gradient(90deg,var(--accent) 0 10px,transparent 10px 14px);box-shadow:none}`,
    // фото: ығыстырылған акцент жақтау
    `${S} .photo{border:2px solid var(--accent);border-radius:0!important;box-shadow:18px 18px 0 0 color-mix(in srgb,var(--accent) 30%,transparent)}${S} .photo::after{display:none}`,
    `${S} .notes li{border-left:2px dashed var(--accent)}`,
    `${S} .data-table th{background:none;border-bottom:2px solid var(--accent);color:var(--accent)}`,
    `${S} .data-table tbody tr:nth-child(even) td{background:none}`,
    `${S} .tl-mark::after{border-radius:0;width:18px;height:18px;margin-top:-9px;border:3px solid var(--accent);box-shadow:0 0 0 6px var(--bg)}`,
    `${S} .tl-mark::before{background:none;border-top:2px dashed var(--accent);height:0}`,
    `${S} .st-arrow{background:none;border-top:2px dashed var(--accent);height:0}`,
    `${S} .ig-node,${S} .ig-card{border-radius:0;box-shadow:none}`,
    `${S} .ig-bar,${S} .ig-col,${S} .ig-track{border-radius:0}${S} .ig-bar.on,${S} .ig-col.on{box-shadow:none}`,
  ].join('\n'),
};
