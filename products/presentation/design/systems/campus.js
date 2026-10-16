'use strict';
/**
 * CAMPUS («Кампус») — педагогика, психология, спорт: жеңіл, жылы, «дәптер» тілі.
 *   • фон: әлсіз нүктелі дәптер торы;
 *   • мұқаба мен қорытындыда тақырыпқа сай қолмен салынған иллюстрация (Open Doodles, CC0, палитраға боялған);
 *   • кілт сөздің астында қолмен сызылғандай толқын сызық;
 *   • ұғымдар — ақ «стикер» карточкалар, кезекпен сәл қисайған;
 *   • тізім нөмірлері — қолмен сызылған сақина ішінде.
 */
const T = require('../tokens');

const S = '#stage.ds-campus';
const enc = (svg) => 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
const squiggle = (c) => enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 16" preserveAspectRatio="none"><path d="M2 10c18-8 30 6 48 0s30-8 48-1 30 7 48 0 32-7 52 0" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/></svg>`);
const ring = (c) => enc(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60"><path d="M31 5c14 0 25 10 24 25-1 14-12 25-26 24C15 53 5 43 6 29 7 16 17 6 33 7" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/></svg>`);

function css(p) {
  const ink = p.text;
  const acc = p.accent;
  const dot = T.mixHex(p.bg, p.text, 0.16);
  const card = T.mixHex(p.bg, '#ffffff', 0.75);
  return [
    `${S} .deco,${S} .aurora,${S} .halo{display:none!important}`,
    `${S} .plate,${S} .plate-cover,${S} .plate-section{background:radial-gradient(${dot} 1.6px,transparent 1.8px) 0 0/34px 34px,var(--bg)!important}`,
    `${S} .layer-bg::before,${S} .layer-bg::after{display:none!important}`,

    // кілт сөз: түсі мәтіндікі, астында қолмен сызылған толқын
    `${S} .title .hl{background:${squiggle(acc)} left 100%/100% .2em no-repeat!important;-webkit-text-fill-color:${ink}!important;color:${ink}!important;padding-bottom:.1em}`,
    `${S} .kicker{color:${acc};letter-spacing:.14em;font-weight:700}`,
    `${S} .rule{background:${squiggle(acc)} left center/100% 100% no-repeat!important;height:14px!important;width:120px!important}`,

    // иллюстрациялар
    `${S} .doodle{position:absolute;pointer-events:none}`,
    `${S} .doodle-cover{right:70px;bottom:90px;width:680px;height:720px;object-fit:contain;object-position:right bottom}`,
    `${S} .doodle-close{left:96px;bottom:40px;width:400px;height:330px;object-fit:contain;object-position:left bottom}`,
    `${S} .cover-doodle .cover-block{position:absolute;left:var(--mx);top:50%;transform:translateY(-50%)}`,

    // ұғымдар: ақ стикерлер
    `${S} .concept{background:${card}!important;border:0!important;border-radius:22px!important;padding:40px 38px!important;box-shadow:0 18px 40px -26px rgba(0,0,0,.35)!important}`,
    `${S} .concept:nth-child(odd){transform:rotate(-1.2deg)}${S} .concept:nth-child(even){transform:rotate(1deg)}`,
    `${S} .concept::before,${S} .concept::after{display:none!important}`,
    `${S} .concept-n{display:inline-flex!important;align-items:center;justify-content:center;width:56px;height:56px;margin-bottom:22px;background:${ring(acc)} center/100% no-repeat;color:${acc};font-size:24px;font-weight:700;letter-spacing:0}`,
    `${S} .concept-l{font-weight:700}`,

    // тізім: нөмір қолмен сызылған сақинада
    `${S} .row-n{background:${ring(acc)} center/100% no-repeat!important;border:0!important;width:58px;min-width:58px;height:58px;display:inline-flex;align-items:center;justify-content:center;color:${acc};font-weight:700;font-size:24px;letter-spacing:0;margin-top:-8px}`,
    `${S} .rows{border-top:0}${S} .row,${S} .row:first-child{border:0!important;border-bottom:2px dashed ${T.mixHex(p.bg, p.text, 0.14)}!important}`,
    `${S} .pts-r .rows,${S} .edit-r .rows{background:${card};border-radius:26px;padding:26px 44px;box-shadow:0 22px 48px -30px rgba(0,0,0,.35);transform:rotate(-.6deg)}`,
    `${S} .pts-r .row:last-child,${S} .edit-r .row:last-child{border-bottom:0!important}`,

    // уақыт сызығы: үзік сызық
    `${S} .tl-mark::before{background:none!important;border-top:3px dashed ${T.mixHex(p.bg, acc, 0.6)};height:0!important}`,
    `${S} .tl-mark::after{background:${acc}!important;box-shadow:0 0 0 6px var(--bg)!important}`,
    `${S} .tl-date{background:none!important;-webkit-text-fill-color:${acc}!important;color:${acc}!important;font-weight:700}`,

    // сандар
    `${S} .numeral-xl,${S} .mega,${S} .st-n,${S} .stat-v{background:none!important;-webkit-text-fill-color:${acc}!important;color:${acc}!important;font-weight:700}`,
    `${S} .stat{background:${card}!important;border:0!important;border-radius:22px!important;box-shadow:0 18px 40px -26px rgba(0,0,0,.3)!important}`,
    `${S} .stat::before,${S} .stat::after{display:none!important}`,

    // инфографика карточкалары мен фото — дөңгеленген, жұмсақ
    `${S} .ig-card{background:${card}!important;border:0!important;border-radius:22px!important;box-shadow:0 18px 40px -26px rgba(0,0,0,.3)!important}`,
    `${S} .photo{border-radius:28px!important;border:10px solid #fff!important;box-shadow:0 22px 44px -24px rgba(0,0,0,.4)!important}`,
  ].join('\n');
}

module.exports = {
  id: 'campus',
  name: 'Кампус',
  type: { display: 'arial', text: 'sans', dw: 700, tw: 700, dt: '-0.025em', tt: '-0.02em', dl: 1.04, tl: 1.08 },
  moods: ['mint', 'cloud', 'blush', 'ivory'],
  num: 'plain',
  folio: { title: false, total: false, pad: true, cover: false },
  cover: 'doodle',
  closing: 'rows',
  doodles: true,
  css,
};
