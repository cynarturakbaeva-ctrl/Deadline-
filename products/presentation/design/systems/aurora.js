'use strict';
/**
 * АВРОРА — кинематографиялық стиль (бұрынғы әдепкі көрініс): атмосфералық жарық дақтары, мұқабадағы орбита,
 * тақырыптағы градиентті кілт сөз, шыны карточкалар, нөмір «01» таблеткада, үлдір түйіршігі.
 * Қаріп палитраның тонына қарай (editorial → Times, modern/technical → Calibri). Базалық стиль = осы жүйе.
 *
 * Жүйенің өз қолтаңбасы (style.js үстінен, тек #stage.ds-aurora аясында):
 *  - фонда палитраның әшекейі (сақина/тор/нүкте/жолақ — мәтіннің үстінен өтіп, оқуды бұзатын) ОРНЫНА әр слайдта
 *    бұрыштан бұрышқа ауысатын жұмсақ «аврора» жарығы (accent + accent2), мәтін аймағына әлсіз ғана жетеді;
 *  - карточкалар нағыз «шыны»: ашық фонда ақ мөлдір панель, қараңғыда аяз-шыны (артындағы жарық бұлдырайды);
 *  - мұқаба-фото: бүкіл фотоны тұмандатпай, жоғарғы бөлігі жарқын қалады, мәтін астында ғана фонға ауысады;
 *  - қорытынды-фото: фото сол жақта кинолық панель (ақ тақырып), оң жақта таза фон + аврора, түйіндер анық оқылады.
 */
const T = require('../tokens');

const S = '#stage.ds-aurora';
/** Ашық фондағы жарық: түстің өз реңі, бірақ ашық әрі қанық пастель (күңгірт accent фонды «сұр дақ» қылмасын) */
function pastel(hex, L = 0.82) {
  const [r, g, b] = T.hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const l0 = (mx + mn) / 2; const s0 = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1));
  const s = Math.min(0.85, s0 * 1.15 + 0.12);
  const c = (1 - Math.abs(2 * L - 1)) * s; const x = c * (1 - Math.abs(((h / 60) % 2) - 1)); const m = L - c / 2;
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [R, G, B].map((v) => ('0' + Math.round(Math.max(0, Math.min(1, v + m)) * 255).toString(16)).slice(-2)).join('');
}
const mix = (c, p) => `color-mix(in srgb,${c} ${p}%,transparent)`;

/** Әр слайдта аврора жарығының орны (dp-0..3 — html3DBuilder.decoFor айналдырады) */
const GLOW_AT = [
  ['104% -10%', '70% 112%'],
  ['104% 110%', '22% -14%'],
  ['-4% 110%', '86% -14%'],
  ['-4% -10%', '82% 112%'],
];

function css(p) {
  const light = !!(p && p.isLight);
  // қараңғыда — accent өзі; ашықта — оның ашық пастелі (әйтпесе күңгірт түс фонды сұрғылт етеді)
  const c1 = light ? pastel(p.accent) : 'var(--accent)';
  const c2 = light ? pastel(p.accent2 || p.accent, 0.84) : 'var(--accent2)';
  const g1 = light ? 70 : 42; // негізгі жарық қанықтығы
  const g2 = light ? 60 : 30; // серік жарық
  const glow = (a, b) =>
    `radial-gradient(1050px 820px at ${a},${mix(c1, g1)} 0%,${mix(c1, Math.round(g1 * 0.45))} 38%,transparent 72%),` +
    `radial-gradient(820px 640px at ${b},${mix(c2, g2)} 0%,${mix(c2, Math.round(g2 * 0.4))} 40%,transparent 72%)`;
  const bg = (a) => `color-mix(in srgb,var(--bg) ${a}%,transparent)`;

  return [
    // ── 1. Фон әшекейі → аврора жарығы (сақина/тор/нүкте мәтіннің үстінен өтпейді) ──
    `${S} .deco{opacity:1;background:none!important;-webkit-mask-image:none!important;mask-image:none!important}`,
    `${S} .deco::before{inset:0;width:auto;height:auto;border:0;border-radius:0;transform:none;-webkit-mask-image:none;mask-image:none;opacity:1}`,
    `${S} .deco::after{display:none}`,
    ...GLOW_AT.map(([a, b], i) => `${S} .deco.dp-${i}::before{top:0;right:0;bottom:0;left:0;background:${glow(a, b)}}`),
    // қараңғы виньетка бұрыштағы жарықты «жеп қоятын» → жұмсартылады
    light ? '' : `${S} .layer-bg::before{opacity:.32}`,
    // өз аврорасы бар слайдта (мұқаба, бөлім, қорытынды) екінші жарық қосылмайды
    `${S} .layer-bg:has(.aurora) .deco{display:none}`,
    // ашық фонда базалық аврора (multiply) көрінбей қалатын — жұмсақ қалыпты түске
    light ? `${S} .aurora i{mix-blend-mode:normal}${S} .aurora{opacity:.8}` : '',

    // ── 2. Шыны карточкалар ──
    light
      ? `${S} .concept,${S} .st,${S} .hn,${S} .stat,${S} .ig-card{background:linear-gradient(170deg,rgba(255,255,255,.95) 0%,rgba(255,255,255,.7) 100%);` +
        `border-color:color-mix(in srgb,var(--text) 9%,transparent);` +
        `box-shadow:inset 0 1px 0 #fff,0 30px 60px -36px color-mix(in srgb,var(--accent) 45%,transparent),0 2px 8px color-mix(in srgb,var(--text) 5%,transparent)}`
      : `${S} .concept,${S} .st,${S} .hn,${S} .stat,${S} .ig-card{background:linear-gradient(170deg,color-mix(in srgb,var(--text) 9%,transparent) 0%,color-mix(in srgb,var(--text) 3.5%,transparent) 100%);` +
        `-webkit-backdrop-filter:blur(26px) saturate(1.2);backdrop-filter:blur(26px) saturate(1.2);` +
        `box-shadow:inset 0 1px 0 color-mix(in srgb,var(--text) 14%,transparent),0 30px 70px -30px rgba(0,0,0,.7)}`,
    // карточка бұрышындағы жарық дақ ашық фонда «кір дақ» сияқты → тек қараңғыда
    light ? `${S} .stat::after,${S} .concept::after{display:none}` : '',
    // карточканың жоғарғы градиент «тілі» шетке жабысып кесілгендей көрінетін → ішке, дөңгелек
    `${S} .stat::before,${S} .concept::before,${S} .hn::after{top:-1px;border-radius:0 0 6px 6px;height:5px}`,

    // ── 3. Нөмір-таблетка: градиентті жиек, анық цифр ──
    `${S} .row-n{background:linear-gradient(135deg,${mix('var(--accent)', light ? 12 : 20)},${mix('var(--accent2)', light ? 10 : 16)});border-color:${mix('var(--accent)', light ? 30 : 42)};font-weight:700}`,

    // ── 4. Мұқаба-фото: жоғарғы жағы жарқын, мәтін астында ғана фонға ауысады (бұрынғы екі қабат «тұман» жоқ) ──
    `${S} .cover-photo .layer-bg>.scrim{background:none!important}`,
    `${S} .cover-photo .layer-bg>.full+.scrim{background:linear-gradient(90deg,${bg(light ? 40 : 70)} 0%,${bg(light ? 14 : 38)} 44%,transparent 70%)!important}`,
    `${S} .cover-photo .cover-block{position:relative;z-index:0}`,
    `${S} .cover-photo .cover-block::before{content:"";position:absolute;z-index:-1;pointer-events:none;top:-300px;left:calc(var(--mx) * -1);right:calc(var(--mx) * -1);bottom:-200px;` +
      `background:linear-gradient(180deg,transparent 0,${bg(light ? 70 : 72)} 190px,${bg(light ? 90 : 88)} 300px,${bg(light ? 94 : 92)} 100%)}`,

    // ── 5. Қорытынды-фото: сол жақта кинолық фото-панель (ақ тақырып), оң жақта таза фон + аврора ──
    `${S} .closing-slide .layer-bg:has(>.full){background:${glow('104% -10%', '62% 116%')},var(--bg)}`,
    `${S} .closing-slide .layer-bg>.full,${S} .closing-slide .layer-bg>.full~.scrim{-webkit-mask-image:linear-gradient(90deg,#000 0,#000 46%,transparent 46.1%);mask-image:linear-gradient(90deg,#000 0,#000 46%,transparent 46.1%)}`,
    `${S} .closing-slide .layer-bg>.full~.scrim{background:linear-gradient(180deg,rgba(6,9,16,.22) 0%,rgba(6,9,16,.5) 34%,rgba(6,9,16,.58) 56%,rgba(6,9,16,.5) 74%,rgba(6,9,16,.36) 100%)!important}`,
    `${S} .closing-slide:has(.layer-bg>.full) .close-l{--text:#fff;--text2:rgba(255,255,255,.9);--text3:rgba(255,255,255,.72);--line:rgba(255,255,255,.34);color:#fff}`,
    `${S} .closing-slide:has(.layer-bg>.full) .close-l .title{text-shadow:0 2px 28px rgba(0,0,0,.35)}`,
    `${S} .closing-slide:has(.layer-bg>.full) .close-l .title .hl{background:linear-gradient(100deg,color-mix(in srgb,var(--accent) 22%,#fff),color-mix(in srgb,var(--accent2) 38%,#fff));-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}`,
    `${S} .closing-slide:has(.layer-bg>.full) .close-l .rule{background:linear-gradient(90deg,#fff,color-mix(in srgb,var(--accent2) 50%,#fff))}`,
  ].filter(Boolean).join('\n');
}

module.exports = {
  id: 'aurora',
  name: 'Аврора',
  type: null,
  // жарық дақтары қараңғы фонда ең әсерлі; ашықтан тек салқын/таза фондар (беж «light»/«sand» — журнал стилі, аврора онда лайланады)
  moods: ['midnight', 'cold', 'vivid', 'archive', 'forest', 'wine', 'graphite', 'warm', 'ivory', 'cloud', 'mint', 'blush'],
  num: 'pad',
  folio: { title: true, total: true, pad: true, cover: true },
  cover: 'classic',
  closing: 'rows',
  css,
};
