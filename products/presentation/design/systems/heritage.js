'use strict';
/**
 * HERITAGE — гуманитарлық сала (тарих, әдебиет, философия): слайд «фон + мәтін» емес, ҚҰРАСТЫРЫЛҒАН композиция.
 *   • мұқаба: фото доға пішінінде + артында күн-шеңбер + төменде түсті табан (COVER.arch);
 *   • ұғымдар: үш түсті тұтас бағана, биіктігі сатылап төмендейді;
 *   • тізім/қорытынды: тақырып бағанасының астында шетке дейін созылған түсті жазықтық;
 *   • уақыт сызығы: жыл сайын түсі ауысатын қалың жолақ, жылдар ірі антиква;
 *   • бөлім слайды: тұтас түсті бет.
 * Үш түс: c1 — терең (мәтін + акцент), c2 — акцент, c3 — акцент-2. Әр түстің үстіндегі мәтін түсі контрастпен есептеледі.
 */
const T = require('../tokens');

const S = '#stage.ds-heritage';
const on = (c, ink) => (T.contrast('#ffffff', c) >= 3.6 ? '#ffffff' : ink);
const onVars = (c, ink) => {
  const t = on(c, ink);
  const soft = t === '#ffffff' ? 'rgba(255,255,255,.86)' : T.mixHex(ink, c, 0.25);
  return `--text:${t};--text2:${soft};--text3:${soft};--line:${t === '#ffffff' ? 'rgba(255,255,255,.3)' : 'rgba(0,0,0,.18)'};--accent:${t};--accent2:${t};color:${t}`;
};

function css(p) {
  const ink = p.text;
  const c1 = T.mixHex(p.text, p.accent, 0.28);
  const c2 = p.accent;
  const c3 = p.accent2 || T.mixHex(p.accent, p.bg, 0.4);
  const C = [c1, c2, c3];
  // тақырып бағанасы астындағы жазықтық: бағана сол жақта (1–5/1–6) не оң жақта (8–12) — шетке дейін
  const plane = (sel, left) => `${S} ${sel}{position:relative;z-index:0;${onVars(c1, ink)}}` +
    `${S} ${sel}::before{content:"";position:absolute;z-index:-1;top:-2000px;bottom:-2000px;` +
    (left ? 'left:-600px;right:-56px' : 'left:-56px;right:-600px') + `;background:${c1}}`;
  return [
    // фон: жылы қағаз, әшекейсіз (композицияны пішіндер жасайды)
    `${S} .deco,${S} .aurora,${S} .halo{display:none!important}`,
    `${S} .layer-bg::before,${S} .layer-bg::after{display:none!important}`,
    `${S} .title .hl{background:none!important;-webkit-text-fill-color:${c2}!important;color:${c2}!important;font-style:italic}`,
    `${S} .kicker{color:${c2};letter-spacing:.22em;font-weight:700}`,
    `${S} .rule{background:${c2}!important;height:4px}`,

    // ── мұқаба: доға-фото + күн + табан ──
    `${S} .arch-photo{position:absolute;right:150px;top:104px;width:620px;height:870px;border-radius:310px 310px 0 0;overflow:hidden;z-index:2}`,
    `${S} .arch-photo img{width:100%;height:100%;object-fit:cover}`,
    `${S} .arch-sun{position:absolute;right:56px;top:52px;width:430px;height:430px;border-radius:50%;background:${c3};z-index:1}`,
    `${S} .arch-sun.solo{right:-120px;top:-120px;width:760px;height:760px;opacity:.9}`,
    `${S} .arch-base{position:absolute;right:0;bottom:0;width:1000px;height:106px;background:${c1};z-index:3}`,
    `${S} .cover-arch .cover-block{position:absolute;left:var(--mx);top:200px}`,

    // ── ұғымдар: тұтас түсті бағаналар, сатылы биіктік ──
    `${S} .concepts{align-items:end!important}`,
    `${S} .concepts .concept{align-self:end!important}`,
    ...C.map((c, k) => `${S} .concepts .concept:nth-child(3n+${k + 1}){background:${c};${onVars(c, ink)};height:${[460, 400, 340][k]}px}`),
    `${S} .concept{border:0;border-radius:0!important;box-shadow:none!important;padding:44px 40px 46px;display:flex;flex-direction:column;justify-content:flex-end}`,
    `${S} .concept::before,${S} .concept::after{display:none}`,
    `${S} .concept-n{font-family:var(--f-display);font-size:28px;letter-spacing:0;font-weight:400;opacity:.85;margin-bottom:auto;padding-bottom:var(--s3)}`,
    `${S} .concept-l{font-family:var(--f-display);font-weight:400;font-size:calc(var(--rl,40px)*1.6*var(--fs,1));line-height:1.05;letter-spacing:-.01em}`,
    `${S} .concept-d{font-size:calc(var(--rd,26px)*1.1*var(--fs,1))}`,

    // ── тізім слайды мен қорытынды: тақырып бағанасының астында түсті жазықтық ──
    plane('.pts-l.at-l', true),
    plane('.pts-l.at-r', false),
    plane('.close .close-l', true),
    plane('.edit-l.at-l', true),
    plane('.edit-l.at-r', false),
    `${S} .row-n{font-family:var(--f-display);color:${c2};font-weight:400;font-size:34px}`,
    `${S} .rows{border-top:3px solid ${c1}}`,

    // ── уақыт сызығы: қалың түрлі түсті жолақ ──
    `${S} .tl-mark{height:24px}`,
    `${S} .tl-mark::before{top:0;height:24px;right:calc(var(--gut)*-1)}`,
    `${S} .tl-n:last-child .tl-mark::before{right:0}`,
    ...C.map((c, k) => `${S} .tl-n:nth-child(3n+${k + 1}) .tl-mark::before{background:${c}}`),
    `${S} .tl-mark::after{display:none}`,
    `${S} .tl-txt{font-size:calc(var(--bs,28px)*1.15*var(--fs,1))}`,
    `${S} .tl-date{font-size:calc(var(--ds,54px)*1.5*var(--fs,1))!important;background:none!important;-webkit-text-fill-color:currentColor;color:${ink};font-weight:400}`,

    // ── сандар: жалпақ қағаз карточка, үстінде түсті жолақ ──
    `${S} .stat{background:none!important;border:0;box-shadow:none!important;border-top:8px solid ${c1}!important;border-radius:0!important;padding-top:var(--s4)}`,
    ...C.map((c, k) => `${S} .stat:nth-child(3n+${k + 1}){border-top-color:${c}!important}`),
    `${S} .stat::before,${S} .stat::after,${S} .meter{display:none!important}`,
    // ── сандар ──
    `${S} .numeral-xl,${S} .mega,${S} .st-n,${S} .stat-v{background:none!important;-webkit-text-fill-color:${c2}!important;color:${c2}!important;font-family:var(--f-display);font-weight:400}`,

    // ── бөлім: тұтас түсті бет ──
    `${S} .L-section .plate-section{background:${c1}!important}`,
    `${S} .closing-slide .plate-section{background:var(--bg)!important}`,
    `${S} .L-section .canvas{${onVars(c1, ink)}}`,

    // ── фото: жиексіз, үлкен радиуссыз — тік бұрышты «журнал» кесігі ──
    `${S} .photo{border-radius:0!important;box-shadow:none}`,
  ].join('\n');
}

module.exports = {
  id: 'heritage',
  name: 'Мұра',
  type: { display: 'serif', text: 'sans', dw: 400, tw: 400, dt: '-0.02em', tt: '-0.01em', dl: 1.02, tl: 1.08 },
  moods: ['sand', 'light', 'ivory', 'mint', 'blush'],
  num: 'pad',
  folio: { title: false, total: false, pad: true, cover: false },
  cover: 'arch',
  closing: 'rows',
  css,
};
