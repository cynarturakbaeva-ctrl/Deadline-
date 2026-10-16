'use strict';
/**
 * АКАДЕМИЯ — заманауи университет баяндамасы: Times Bold тақырып + Calibri мәтін, «бланк» композициясы.
 * Қолтаңбасы:
 *   • әр слайдтың жоғарғы шетінде акцент жолақ, төменде — ортасында бет нөмірі бар жіңішке колонтитул сызығы;
 *   • мазмұн слайдтарының бәрінде тақырып ЖОҒАРЫДА, ОРТАДА, астында қысқа акцент сызық (кілт сөзі бар
 *     тақырыпта — кілт сөздің астын сызу); мазмұн тақырып астындағы бос орынның ортасында;
 *   • бір «дөңгелек» тіл: нөмірлер — толық акцент дөңгелек, уақыт сызығының түйіндері, бөлім нөмірі шеңберде;
 *   • жиегі бар ақшыл карточкалар (көлеңкесіз), дөңгеленген фото;
 *   • мұқаба — кітап мұқабасындай: жоғарғы бөлікте ашық (қараңғыланбаған) фото, астында «қағаз» панельде
 *     ортаға тураланған тақырып пен титул деректері.
 * Атмосфералық эффект (аврора, түйіршік, фон әшекейі) жоқ — оқылуы бірінші.
 */
const { GRID } = require('../tokens');
const { calm, solid, CARDS, CARD_DECOR } = require('./_fx');

const S = '#stage.ds-academy';
const px = (v) => Math.round(v) + 'px';
const sel = (list) => list.split(',').map((x) => `${S} ${x.trim()}`).join(',');
// Тақырыбы сол жақта, сипаттамасы оң жақта тұратын «бас» блоктар → академияда тақырып ортада, сипаттама астында
const HEADS = '.proc-head,.tl-head,.stats-head,.tbl-head,.igk-head';
const HEAD_DEK = HEADS.split(',').map((h) => h + ' .para').join(',');
// Тақырып жоғарыда тұратын композициялар: тақырып орны бекітулі, мазмұн қалған кеңістіктің ортасында
const TOP_CANVAS = '.proc-canvas,.tl-canvas,.stats,.tbl,.igk,.conc,.hier';
const TOP_BODY = '.proc-canvas>.steps,.tl-canvas>.tl,.stats>.stat-row,.tbl>.table-wrap,.igk>.ig-wrap,.conc>.concepts,.hier>.tree';
// Мұқаба: фото 0…(1080−COVER_PH_B) аралығында, панель кемінде PANEL_MIN биік → панель фотоның астыңғы шетін әрқашан жабады
const COVER_PH_B = 420;
const PANEL_MIN = 448;
// Толық акцент дөңгелек (нөмірлер)
const BADGE = 'display:inline-flex;align-items:center;justify-content:center;flex:none;padding:0;border:0;border-radius:50%;' +
  'background:var(--accent);color:var(--accent-ink);font-family:var(--f-text);font-weight:700;letter-spacing:0;line-height:1;' +
  'font-variant-numeric:lining-nums tabular-nums;box-shadow:none';
// Градиентсіз толық фон (solid() фонды өшіреді, дөңгелекке керек емес)
const BADGE_FILL = 'background:var(--accent)!important;-webkit-background-clip:border-box!important;background-clip:border-box!important;' +
  'color:var(--accent-ink)!important;-webkit-text-fill-color:var(--accent-ink)!important';

module.exports = {
  id: 'academy',
  name: 'Академия',
  type: { display: 'serif', text: 'sans', dw: 700, tw: 700, dt: '-0.015em', tt: '-0.01em', dl: 1.02, tl: 1.08 },
  // «университет» палитралары: сия-көк, көк, жасыл, кірпіш-қызыл, құм + терең көк/жасыл (қараңғы зал)
  moods: ['ivory', 'cloud', 'mint', 'sand', 'midnight', 'forest', 'light'],
  num: 'plain',
  // бет нөмірі «3 / 12» төменде ортада, колонтитул сызығының ортасында (жүгіртпе тақырып жоқ — журналдан өзгеше)
  folio: { title: false, total: true, pad: false, cover: false },
  stack: 'center', // мазмұн слайдтарында тақырып жоғарыда
  cover: 'center',
  closing: 'split', // фото бір жақта, түйіндер екінші жақта
  css: (p = {}) => {
    const light = p.isLight !== false;
    // карточка: ашық палитрада қағаздан сәл ақшыл, қараңғыда фоннан сәл ашық
    const card = light ? 'color-mix(in srgb,var(--bg) 45%,#fff)' : 'var(--bg2)';
    return [
      calm(S),
      `${S} .plate,${S} .plate-cover,${S} .plate-section{background:var(--bg)}`,
      // ── «бланк»: жоғарғы акцент жолақ ──
      `${S} .layer-bg::before{display:block!important;content:'';position:absolute;left:0;right:0;top:0;height:12px;background:var(--accent);opacity:1;z-index:6;-webkit-mask-image:none;mask-image:none}`,

      // ── типографика ──
      solid(`${S} .title .hl`, 'inherit'),
      // кілт сөз: тік (курсив емес — Times Bold Italic PPTX-те басқаша өлшенеді), акцент түсті астын сызу
      `${S} .title .hl{font-style:normal!important;padding-right:0;text-decoration:underline;text-decoration-color:var(--accent);text-decoration-thickness:.07em;text-underline-offset:.13em;text-decoration-skip-ink:auto}`,
      // кілт сөзі жоқ тақырып астында қысқа акцент сызық (ортадағы тақырыпта — ортада)
      `${S} .title:not(:has(.hl))::after{content:'';display:block;width:64px;height:6px;border-radius:3px;background:var(--accent);margin:26px 0 0}`,
      `${S} .title.center::after,${S} .stack-head .title::after,${S} .conc-head .title::after,${S} .hier-root .title::after,${sel(HEADS.split(',').map((h) => h + ' .title::after').join(','))}{margin-inline:auto}`,
      `${S} .rule{display:none}`, // сызық тақырыптың астында (жоғарыдағы) — бір ереже
      `${S} .lead{color:var(--text2)}`,
      `${S} .kicker{letter-spacing:.14em;font-weight:700}`,
      `${S} .title+.lead{margin-top:var(--s3)}`,

      // ── тақырып жоғарыда, ортада: stack + процесс/уақыт/сан/кесте/инфографика/карточка/иерархия ──
      `${S} .stack-head,${S} .conc-head{text-align:center;display:flex;flex-direction:column;align-items:center}`,
      `${S} .stack-head .lead,${S} .conc-head .lead{margin-inline:auto;text-align:center}`,
      `${sel(HEADS)}{display:flex;flex-direction:column;align-items:center;text-align:center}`,
      `${sel(HEADS.split(',').map((h) => h + '>*').join(','))}{align-self:center!important;max-width:100%}`,
      `${sel(HEADS.split(',').map((h) => h + '>.cell:empty').join(','))}{display:none}`,
      `${sel(HEAD_DEK)}{max-width:${px(GRID.span(9))}!important;margin:var(--s3) auto 0;text-align:center;font-size:calc(30px*var(--fs,1));line-height:1.4;color:var(--text2)}`,
      `${sel(HEADS.split(',').map((h) => h + ' .notes').join(','))}{justify-items:center;margin-top:var(--s3)}`,
      `${sel(TOP_CANVAS)}{justify-content:flex-start;gap:var(--s6)}`,
      `${sel(TOP_BODY)}{margin-top:auto;margin-bottom:auto}`,
      // stack: тақырып орнында, мазмұн қалған бос орынның ортасында (бұрын жоғарыға жабысып, асты бос қалатын)
      `${S} .stack-body{justify-content:center}`,

      // ── бет нөмірі: колонтитул сызығының ортасында «3 / 12» ──
      `${S} .folio{justify-content:center;align-items:center;gap:24px;letter-spacing:.08em;color:var(--text2)}`,
      `${S} .folio::before,${S} .folio::after{content:'';flex:1;height:1px;background:var(--line)}`,
      `${S} .folio-l{display:none}${S} .folio b{color:var(--accent);font-weight:700}${S} .folio .of{color:var(--text2)}`,
      // бүйірінде фото тұрған слайдта: сызықсыз, нөмір фотоға түспейтін жақта
      `${S} .slide:has(.bleed) .folio::before,${S} .slide:has(.bleed) .folio::after{display:none}`,
      `${S} .slide:has(.bleed[style^="left:0"],.bleed[style*="left: 0"]) .folio{justify-content:flex-end}`,
      `${S} .slide:has(.bleed[style^="right:0"],.bleed[style*="right: 0"]) .folio{justify-content:flex-start}`,

      // ── мұқаба: жоғарыда ашық фото, астында «қағаз» панель (тақырып, ұйым, титул деректері — ортада) ──
      `${S} .cover-center .full{bottom:${COVER_PH_B}px}`,
      `${S} .cover-center .scrim{display:none}`,
      // фотосыз мұқаба: фото орнында акцент түсті алаң (кітап мұқабасы)
      `${S} .cover-plain.cover-center .plate-cover{background:radial-gradient(120% 160% at 50% 0%,color-mix(in srgb,var(--accent) 84%,#fff) 0%,var(--accent) 70%) top/100% ${1080 - COVER_PH_B}px no-repeat,var(--bg)}`,
      `${S} .cover-c{top:auto;left:0;right:0;bottom:0;min-height:${PANEL_MIN}px;padding:56px var(--mx) var(--mb);background:var(--bg);justify-content:center;gap:var(--s4);border-top:8px solid var(--accent)}`,
      `${S} .cover-c.on-photo{--text:${p.text || 'inherit'};--text2:${p.text2 || 'inherit'};--text3:${p.text2 || 'inherit'};--line:${p.line || 'currentColor'};color:var(--text)}`,
      `${S} .cover-c .title{text-shadow:none}`,
      `#stage.ds-academy .slide .cover-c .title .hl{color:var(--text)!important;-webkit-text-fill-color:inherit!important}`,
      `${S} .cover-c .cover-top{min-height:0}${S} .cover-c .cover-top:empty{display:none}`,
      `${S} .cover-c .lead{margin-top:var(--s3)}`,
      `${S} .cover-org{color:var(--text2);letter-spacing:.12em;font-weight:700}`,
      `${S} .cover-c .meta-row{border-top:1px solid var(--line);padding-top:var(--s3)}`,
      `${S} .meta-k{color:var(--text2);font-weight:700}`,

      // ── толық фото слайд: фото жоғарыда, тақырып астындағы панельде (ақ мәтін ашық фонда оқылмай қалмайды) ──
      `${S} .fimg-slide .full{bottom:300px}${S} .fimg-slide .scrim{display:none}`,
      `${S} .fimg{top:auto;left:0;right:0;bottom:0;min-height:340px;padding:48px var(--mx) var(--mb);background:var(--bg);justify-content:center;border-top:8px solid var(--accent)}`,
      `${S} .fimg .title{color:var(--text);text-shadow:none}${S} .fimg .lead{color:var(--text2)}`,

      // ── бөлім беті: нөмір шеңберде; фотосыз — бәрі ортада ──
      solid(`${S} .numeral-xl`, 'var(--accent)'),
      `${S} .numeral-xl{display:flex;align-items:center;justify-content:center;width:calc(220px*var(--fs,1));height:calc(220px*var(--fs,1));border:6px solid var(--accent);border-radius:50%;font-size:calc(116px*var(--fs,1));line-height:1;letter-spacing:-.02em}`,
      `${S} .sect-slide:not(:has(.bleed)) .sect{justify-content:center;align-items:center;text-align:center;gap:var(--s6)}`,
      `${S} .sect-slide:not(:has(.bleed)) .sect-block{padding-bottom:0;display:flex;flex-direction:column;align-items:center}`,
      `${S} .sect-slide:not(:has(.bleed)) .lead{margin-inline:auto;text-align:center}`,
      `${S} .sect-slide:has(.bleed) .sect>*{max-width:${px(GRID.span(6))}}`,

      // ── тұжырым (statement) және дәйексөз: ортада ──
      `${S} .stmt{align-items:center;text-align:center}${S} .stmt-block{display:flex;flex-direction:column;align-items:center}`,
      `${S} .stmt .lead,${S} .stmt .para{margin-inline:auto;text-align:center}`,
      `${S} .quote{align-items:center;text-align:center}${S} .quote-block{margin-inline:auto;display:flex;flex-direction:column;align-items:center}`,
      solid(`${S} .qmark`, 'var(--accent)'),
      `${S} .qtext{font-style:italic;font-weight:400}`,
      `${S} .qwho{justify-content:center;letter-spacing:.1em;font-weight:700;color:var(--text2)}${S} .qrule{width:40px;height:4px;border-radius:2px}`,

      // ── тізім: толық акцент дөңгелек нөмір, әр пункттің үстінде жіңішке сызық (екі бағанда да бірдей) ──
      `${S} .row-n{${BADGE};width:44px;min-width:44px;height:44px;margin-top:-2px;font-size:22px}`,
      `${S} .rows{border-top:0}${S} .row,${S} .row:first-child{border-top:1px solid var(--line-soft);border-bottom:0}`,
      `${S} .row{break-inside:avoid;gap:var(--s3)}`,
      `${S} .closing-slide .row{padding:20px 0}${S} .close-split .close-r .rows{margin-top:var(--s4)}`,

      // ── карточкалар: жиегі бар ақшыл парақ, көлеңкесіз ──
      `${sel(CARDS)}{background:${card};border:2px solid var(--line);border-radius:18px;box-shadow:none}`,
      `${sel(CARD_DECOR)}{display:none}`,
      `${S} .concept-n,${S} .hn-n{${BADGE};width:44px;height:44px;font-size:22px;margin-bottom:var(--s3)}`,
      `${S} .concept-l,${S} .st-l,${S} .hn-l{font-weight:700}`,
      // процесс: нөмір дөңгелегі + келесі қадамға жіңішке көрсеткі
      `${S} .st-n{${BADGE};width:56px;height:56px;font-size:calc(28px*var(--fs,1));${BADGE_FILL}}`,
      `${S} .st-arrow{height:2px;background:var(--line)}${S} .st-arrow::after{border-color:var(--text2)}`,
      // иерархия: тармақ сызықтары тұтас (градиентсіз)
      `${S} .tree::before,${S} .tree::after,${S} .hn::before{background:var(--line);width:2px}${S} .tree::after{width:auto;height:2px}`,
      // статистика: реттік нөмір артық — алып сан (Times, акцент), тұтас шкала
      `${S} .stat-ix{display:none}`,
      solid(`${S} .stat-v`, 'var(--accent)'),
      `${S} .stat-v .sfx{color:var(--accent);-webkit-text-fill-color:var(--accent)}`,
      `${S} .stat-l{color:var(--text2);max-width:none}`,
      `${S} .meter{height:10px;border-radius:5px;background:var(--bg3)}${S} .meter i{border-radius:5px;background:var(--accent);box-shadow:none}`,
      solid(`${S} .mega`, 'var(--accent)'),
      `${S} .numb-r{border-left:2px solid var(--line)}`,
      `${S} .ring{background:conic-gradient(from -90deg,var(--accent) 0 calc(var(--pp)*360deg),var(--bg3) calc(var(--pp)*360deg));filter:none}`,
      solid(`${S} .mega.in-ring`, 'var(--text)'),

      // ── уақыт сызығы: шеңбер түйіндер тұтас сызықта ──
      solid(`${S} .tl-date`, 'var(--text)'),
      `${S} .tl-mark::before{background:var(--line);height:2px}`,
      `${S} .tl-mark::after{width:22px;height:22px;margin-top:-11px;background:var(--bg);border:5px solid var(--accent);box-shadow:0 0 0 6px var(--bg)}`,

      // ── фото: дөңгеленген, жиексіз; ашық палитрада жұмсақ көлеңке ──
      `${S} .photo{border:0;border-radius:20px!important;box-shadow:${light ? '0 28px 56px -34px rgba(0,0,0,.42)' : 'none'}!important}${S} .photo::after{display:none}`,
      `${S} .figure{border:2px solid var(--line);border-radius:18px;box-shadow:none;background:${card}}`,

      // ── басқа элементтер ──
      `${S} .notes li{border-left:4px solid var(--accent);background:var(--bg2);padding:var(--s2) var(--s3);border-radius:0 10px 10px 0;color:var(--text2)}`,
      `${S} .data-table th{background:var(--accent);color:var(--accent-ink);border-bottom:0;font-weight:700;letter-spacing:.08em}`,
      `${S} .data-table tbody tr:nth-child(even) td{background:var(--bg2)}`,
      `${S} .data-table tr:last-child td{border-bottom:2px solid var(--line)}`,
      `${S} .ref-n{font-weight:700}`,
      `${S} .ig-source{color:var(--text2)}`,
      `${S} .ig-bar.on,${S} .ig-col.on,${S} .ig-road,${S} .ig-split .a,${S} .ig-col-head.good,${S} .ig-node.on,${S} .ig-badge.on,${S} .ig-mile.on{background:var(--accent);box-shadow:none}`,
      `${S} .ig-node{background:${card};box-shadow:none}${S} .ig-dot{box-shadow:none}`,

      // PPTX фоны: мәтін ешқашан суретке «жабысып» қалмайды (жүйенің !important түстері hideText-тен күшті болмасын)
      `#stage#stage.ds-academy.pptx-hide-text .layer-mid,#stage#stage.ds-academy.pptx-hide-text .layer-mid *{-webkit-text-fill-color:transparent!important;text-shadow:none!important;-webkit-text-stroke:0!important}`,
    ].join('\n');
  },
};
