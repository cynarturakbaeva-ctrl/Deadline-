'use strict';
/**
 * АТЕЛЬЕ — жұмсақ заманауи стиль: Arial тақырып (кәдімгі салмақ, үлкен, тығыз), кілт сөз Times курсивімен
 * (контраст), дөңгелек нүкте-маркер, дөңгелек бұрышты толтырылған карточкалар, үлкен радиусты фото, жұмсақ
 * пастель фон, бет нөмірі тек оң жақта. Мұқаба ортаға тураланған.
 *
 * Қолтаңбасы (басқа жүйелерде жоқ):
 *   • пастель «жарқыл» — әр слайдтың екі бұрышында акцент/акцент-2 түсінің жұмсақ дақтары (фонның өзінде, мәтін
 *     астында контрастты бұзбайтындай әлсіз);
 *   • нүкте + жұмсақ сақина: тақырып белгісі, уақыт сызығының түйіндері, бет нөмірінің алдындағы нүкте;
 *   • тізім нөмірлері — толтырылған акцент шеңбер (ішінде анық нөмір);
 *   • «фарфор» карточкалар: ашық палитрада фоннан АҚШЫЛ (қағаз үстіндегі карта), қараңғыда акцентпен боялған;
 *   • фото — үлкен радиус; шетке жайылған фото да шеттен шегініп, дөңгеленеді (паспарту), мұқаба фотосы да рамкада.
 */
const { calm, solid, CARDS, CARD_DECOR } = require('./_fx');
const T = require('../tokens');

const S = '#stage.ds-atelier';
const sel = (list) => list.split(',').map((x) => `${S} ${x.trim()}`).join(',');

module.exports = {
  id: 'atelier',
  name: 'Ателье',
  // трекинг −0.04em қазақ әріптерін (ң, қ құйрығы) көршісіне жабыстырып жіберетін → сәл босаңсытылды
  type: { display: 'arial', text: 'sans', dw: 400, tw: 400, dt: '-0.028em', tt: '-0.022em', dl: 1.02, tl: 1.08 },
  // пастель жарқылға лайық палитралар: жұмсақ ашық (қызғылт, құм, жалбыз, бұлт) + терең «түнгі» (күлгін, шарап, түн)
  moods: ['blush', 'sand', 'mint', 'cloud', 'vivid', 'wine', 'midnight'],
  num: 'pad',
  folio: { title: false, total: true, pad: true, cover: false },
  cover: 'center',
  closing: 'split', // фото бір жақта, түйіндер екінші жақта
  css: (p) => {
    const L = !p || p.isLight !== false;
    // карточка беті: ашықта — фоннан ақшыл «фарфор»; қараңғыда — акцентпен жеңіл боялған беткей
    const card = L ? 'color-mix(in srgb,var(--bg) 38%,#fff)' : 'color-mix(in srgb,var(--accent) 9%,var(--bg2))';
    const cardSh = L
      ? '0 28px 56px -36px color-mix(in srgb,var(--text) 34%,transparent),0 2px 8px -4px color-mix(in srgb,var(--text) 10%,transparent)'
      : 'inset 0 1px 0 color-mix(in srgb,var(--text) 9%,transparent),0 30px 60px -36px rgba(0,0,0,.7)';
    // пастель жарқылдың күші (мәтін контрастын бұзбайтын шек)
    const g1 = L ? '20%' : '32%'; const g2 = L ? '14%' : '22%';
    // жоғарғы оң бұрышта — акцент (үлкен дақ), төменгі сол жақта — акцент-2 (кіші); қараңғыда сарғыш акцент-2
    // жоғарыда «қоңыр дақ» болып көрінетін (шарап палитрасы) → негізгі дақ әрқашан акцент
    const glow = (a, b) => `radial-gradient(52% 66% at 98% 0%,color-mix(in srgb,var(--accent) ${a},transparent) 0%,transparent 72%),` +
      `radial-gradient(46% 60% at 0% 100%,color-mix(in srgb,var(--accent2) ${b},transparent) 0%,transparent 74%)`;
    // шеңбер ішіндегі нөмір: ақ (≥3.6:1, 20px жуан) — қара сиядан нәзік; әйтпесе палитраның өз сиясы
    const ink = p && p.accent && T.contrast('#ffffff', p.accent) >= 3.6 ? '#ffffff' : 'var(--accent-ink)';
    const ring = (w, a) => `0 0 0 ${w}px color-mix(in srgb,var(--accent) ${a},transparent)`;
    return [
      calm(S, { aurora: true }),
      `${S} .aurora{opacity:.5;filter:blur(120px) saturate(1)}`,

      // ── фон: екі бұрышта жұмсақ пастель жарқыл ──
      `${S} .plate,${S} .plate-cover{background:${glow(g1, g2)},var(--bg)}`,
      `${S} .plate-section{background:${glow(L ? '30%' : '34%', L ? '22%' : '24%')},var(--bg)}`,

      // ── тақырып: кілт сөз — Times курсив, тұтас акцент ──
      solid(`${S} .title .hl`, 'var(--accent)'),
      `${S} .title .hl{font-family:"Times New Roman","Liberation Serif",serif;font-style:italic;letter-spacing:-.005em;padding-right:.06em}`,
      `${S} .lead{letter-spacing:0}`,

      // ── қолтаңба: нүкте + жұмсақ сақина ──
      `${S} .rule{width:16px!important;height:16px;border-radius:50%;background:var(--accent)!important;box-shadow:${ring(8, '20%')};margin-left:8px}`,
      `${S} .cover-c .rule{margin-left:auto;margin-right:auto}`,
      // тізімнің алдындағы жалғыз нүкте «ұмытылған белгі» сияқты көрінеді → орны сақталып, өзі жасырылады
      `${S} .rule:has(+ .rows){visibility:hidden;height:0}`,
      `${S} .kicker{display:block;width:fit-content;max-width:100%;padding:8px 18px;border-radius:999px;background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--text);letter-spacing:.12em}`,

      // ── бет нөмірі: оң жақта, алдында акцент нүкте ──
      `${S} .folio{justify-content:flex-end;letter-spacing:.06em}${S} .folio-l{display:none}`,
      `${S} .folio-r::before{content:"";display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent);margin-right:14px;vertical-align:.12em}`,

      // ── тізім: толтырылған акцент шеңбер + анық нөмір, сызықсыз ──
      `${S} .row-n{width:48px;min-width:48px;height:48px;padding:0;margin-top:-3px;border:0;border-radius:50%;background:var(--accent);color:${ink};font-size:20px;letter-spacing:0;font-weight:700;display:inline-flex;align-items:center;justify-content:center}`,
      `${S} .rows{border-top:0}${S} .rows::before{display:none}${S} .row,${S} .row:first-child{border:0}${S} .row{padding:var(--s3) 0}`,

      // ── карточкалар: толтырылған, үлкен радиус, жиексіз ──
      `${sel(CARDS)}{background:${card};border:0;border-radius:32px;box-shadow:${cardSh}}`,
      `${sel(CARD_DECOR)}{display:none}`,
      `${S} .concept-n,${S} .hn-n,${S} .stat-ix{color:var(--accent);letter-spacing:.1em}`,
      solid(`${S} .stat-v`, 'var(--text)'),
      `${S} .stat-v,${S} .mega,${S} .numeral-xl,${S} .st-n{font-weight:400}`,
      solid(`${S} .numeral-xl,${S} .mega,${S} .st-n`, 'var(--accent)'),
      `${S} .st-arrow{background:color-mix(in srgb,var(--accent) 45%,transparent)}`,
      `${S} .meter{height:14px;border-radius:14px;background:color-mix(in srgb,var(--accent) 12%,transparent)}${S} .meter i{border-radius:14px;box-shadow:none}`,
      `${S} .notes li{border-left:0;background:${card};border-radius:24px;padding:var(--s2) var(--s3);box-shadow:${cardSh}}`,
      `${S} .data-table th{background:color-mix(in srgb,var(--accent) 14%,transparent);border-bottom:0}`,
      `${S} .data-table th:first-child{border-top-left-radius:20px;border-bottom-left-radius:20px}${S} .data-table th:last-child{border-top-right-radius:20px;border-bottom-right-radius:20px}`,
      `${S} .ig-card{border-radius:32px}`,

      // ── уақыт сызығы: түйін = нүкте + сақина ──
      `${S} .tl-mark::after{width:20px;height:20px;margin-top:-10px;border:0;background:var(--accent);box-shadow:${ring(9, '20%')}}`,

      // ── фото: үлкен радиус, жұмсақ көлеңке; шетке жайылған фото да шегініп дөңгеленеді (паспарту) ──
      `${S} .photo{border:0;border-radius:40px!important;box-shadow:${L ? '0 34px 64px -38px rgba(0,0,0,.5)' : '0 0 0 1px color-mix(in srgb,var(--text) 14%,transparent),0 34px 64px -38px rgba(0,0,0,.8)'}}${S} .photo::after{display:none}`,
      `${S} .bleed{border-radius:0;clip-path:inset(28px round 40px);background:transparent}`,
      // мұқаба фотосы — паспарту рамкасында (фон түсті жиек, үлкен радиус)
      `${S} .cover-center .full,${S} .cover-center .scrim{clip-path:inset(24px round 44px)}`,
    ].join('\n');
  },
};
