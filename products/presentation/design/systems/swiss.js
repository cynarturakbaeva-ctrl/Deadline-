'use strict';
/**
 * ШВЕЙЦАР — халықаралық типографиялық стиль: Arial Bold тығыз тақырып, тұтас акцент түсті кілт сөз,
 * шаршы маркер (■ — жүйенің бірден-бір белгісі: тақырып белгісі, бет нөмірі, уақыт сызығы, дәйексөз авторы),
 * үлкен жалаң нөмірлер, қалың қара сызықтар (тізім, кесте, карточка үсті), тұтас түсті тікбұрышты блоктар,
 * жиексіз/көлеңкесіз фото. Түсті алаң — мұқаба, бөлім беті және фотосыз қорытынды (бір ырғақ).
 * Атмосфера жоқ: жалпақ фон, қатаң тор, бәрі сол жаққа тураланған.
 */
const { GRID } = require('../tokens');
const { calm, solid, CARDS, CARD_DECOR } = require('./_fx');

const S = '#stage.ds-swiss';
const px = (v) => Math.round(v) + 'px';
// мұқаба панелінің ені — layouts.js COVER.panel-мен бірдей (фото панельге тура жанасады, арада жолақ қалмайды)
const PANEL_W = GRID.marginX + GRID.span(7) + GRID.gutter / 2;
// фотосыз қорытынды: түсті алаң тақырып бағанын (1–5) жауып, 6-баған ортасында бітеді
const CLOSE_W = GRID.marginX + GRID.span(5) + GRID.gutter + GRID.colW / 2;
// түсті алаңдағы мәтін: мөлдір емес араластыру (PPTX-те түс тура шығады)
const ON_ACCENT = '--text:var(--accent-ink);--text2:color-mix(in srgb,var(--accent-ink) 88%,var(--accent));' +
  '--text3:color-mix(in srgb,var(--accent-ink) 74%,var(--accent));--line:color-mix(in srgb,var(--accent-ink) 40%,var(--accent));' +
  '--line-soft:color-mix(in srgb,var(--accent-ink) 26%,var(--accent));color:var(--text)';
const sel = (list) => list.split(',').map((x) => `${S} ${x}`).join(',');

module.exports = {
  id: 'swiss',
  name: 'Швейцар',
  type: { display: 'arial', text: 'arial', dw: 700, tw: 700, dt: '-0.035em', tt: '-0.025em', dl: 0.98, tl: 1.04 },
  // қатаң, контрасты палитралар (қызыл/көк/жасыл/қызғылт сары + ақ/қара); «vivid» (күлгін градиент жұбы) — швейцарға жат
  moods: ['cloud', 'light', 'graphite', 'midnight', 'mint', 'ivory'],
  num: 'plain',
  folio: { title: false, total: false, pad: false, cover: false },
  stack: 'left', // мазмұн слайдтарында тақырып жоғарыда
  cover: 'panel',
  closing: 'split', // фото бір жақта толық биіктікте (бұрын бүкіл фонға жайылып, ағарып/қараңғыланып кететін)
  css: () => [
    calm(S),
    `${S} .plate,${S} .plate-cover,${S} .plate-section{background:var(--bg)}`,

    // ── типографика ──
    solid(`${S} .title .hl`, 'var(--accent)'),
    `${S} .title .hl{padding-right:0}`,
    `${S} .kicker{font-size:22px;letter-spacing:.01em;text-transform:none;font-weight:700;color:var(--accent)}`,
    `${S} .lead{color:var(--text2)}`,
    `${S} .lead+.rows,${S} .para+.rows{margin-top:var(--s5)}${S} .stack-txt .lead+.rows,${S} .stack-txt .para+.rows{margin-top:var(--s3)}${S} .stack-txt .row{padding:var(--s3) 0}`,
    // шаршы маркер
    `${S} .rule{width:22px!important;height:22px;border-radius:0;background:var(--accent)!important}`,
    // бет нөмірі: шаршы + қалың сан, сол жақта; фото сол жақта толық биіктікте тұрса — оң жаққа (фото үстіне түспейді)
    `${S} .folio{justify-content:flex-start;align-items:center;font-size:24px;letter-spacing:0;font-weight:700;color:var(--text)}${S} .folio-l,${S} .folio .of{display:none}`,
    `${S} .folio b{font-weight:700;color:var(--text)}`,
    `${S} .folio::before{content:'';display:inline-block;flex:none;width:14px;height:14px;background:var(--accent);margin-right:14px}`,
    // (style атрибуты браузерде «left: 0px» болып қайта жазылуы мүмкін — екі пішін де)
    `${S} .slide:has(.bleed[style^="left:0"],.bleed[style*="left: 0"]) .folio,${S} .closing-slide:not(:has(.bleed,.full)) .folio{justify-content:flex-end}`,

    // ── мұқаба: түсті панель + фото (арасында жолақ жоқ), жоғарыда ірі шаршы, тақырып деректердің үстінде ──
    `${S} .cover-panel-slide .bleed{left:${px(PANEL_W)}!important;width:auto!important}`,
    `${S} .cover-panel-slide .panel-pattern{display:none}`,
    `${S} .cover-panel-slide .panel-pattern+.cover-panel{width:100%!important}`, // фото жоқ → бүкіл бет түсті алаң,
    `${S} .cover-panel-slide:has(.panel-pattern) .cover-p-l{grid-column:1/11!important}`, // тақырып кеңірек (2–3 жол, 5 емес)
    `${S} .cover-p-l{justify-content:flex-start}${S} .cover-p-l>.block{margin-top:auto}`,
    `${S} .cover-p-l .cover-top{gap:var(--s3);min-height:56px}`,
    `${S} .cover-p-l .cover-top::before{content:'';flex:none;width:56px;height:56px;background:var(--accent-ink)}`,
    `${S} .cover-org{font-size:24px;letter-spacing:0;text-transform:none;font-weight:700;color:var(--text)}`,
    `${S} .slide .on-accent .title .hl{text-decoration:none}`,
    `${S} .meta-row{border-top:2px solid var(--line);padding-top:var(--s3)}`,
    `${S} .meta-k{letter-spacing:.01em;text-transform:none;font-weight:700;color:var(--text2)}`,
    `${S} .meta-row.is-dense .meta-k{font-size:20px}${S} .meta-row.is-dense .meta-v{font-size:26px}`,

    // ── бөлім беті: түсті алаң (фото болса — оң жақта, мұқабадай), алып жалаң нөмір ──
    `${S} .sect-slide .plate-section{background:var(--accent)}`,
    `${S} .sect-slide .layer-mid{${ON_ACCENT}}`,
    solid(`${S} .sect-slide .numeral-xl`, 'var(--accent-ink)'),
    `${S} .sect-slide .numeral-xl{font-size:calc(280px*var(--fs,1));line-height:.76;letter-spacing:-.05em}`,
    solid(`${S} .sect-slide .title .hl`, 'var(--accent-ink)'),
    `${S} .sect-slide .rule{display:none}`, // алып нөмірдің қасында кішкене шаршы — артық
    // фото бар бөлімде мәтін фотоға дейін ғана (блоктар бүкіл енге созылып, QA «қабаттасу» деп кішірейтетін)
    `${S} .sect-slide:has(.bleed) .sect>*{max-width:${px(GRID.span(7))}}`,

    // ── қорытынды: фото сол жақта (closing:'split'); фотосыз — сол жақта түсті алаң, тақырып соның ішінде ──
    `${S} .closing-slide:not(:has(.bleed,.full)) .plate-section{background:linear-gradient(90deg,var(--accent) 0 ${px(CLOSE_W)},var(--bg) ${px(CLOSE_W)})}`,
    `${S} .closing-slide:not(:has(.bleed,.full)) .close-l{${ON_ACCENT}}`,
    solid(`${S} .closing-slide:not(:has(.bleed,.full)) .close-l .title .hl`, 'var(--accent-ink)'),
    `${S} .closing-slide:not(:has(.bleed,.full)) .close-l .rule{background:var(--accent-ink)!important}`,

    // ── тақырып-жоғарыда слайдтар: мазмұн бір «ілгек сызықтан» басталады (слайдтар бір тормен оқылады) ──
    `${S} .L-stackPoints .stack-head{min-height:290px}`,
    `${S} .L-stackPoints:has(.stack-body .para) .stack-head,${S} .L-stackPoints:has(.row:nth-child(5)) .stack-head{min-height:0}`,
    `${S} .L-stackPoints .stack-body .row-b{max-width:${px(GRID.span(8))}}`, // бір бағанды тізімде жол тым ұзарып кетпейді

    // ── тізім: сол жақ шетке тураланған ірі нөмірлер, үстінде қалың қара сызық ──
    `${S} .row{gap:var(--s3)}`,
    `${S} .row-n{background:none;border:0;border-radius:0;min-width:64px;height:auto;padding:0;margin-top:0;justify-content:flex-start;font-size:40px;line-height:1;letter-spacing:-.03em;font-weight:700;color:var(--accent)}`,
    `${S} .rows{border-top:4px solid var(--text)}${S} .row{border-color:var(--line)}${S} .row:first-child{border-top:0}`,
    `${S} .row-l.strong,${S} .concept-l,${S} .st-l,${S} .hn-l{font-weight:700;letter-spacing:-.02em}`,

    // ── карточкалар → тұтас блоктар: қалың қара жоғарғы жолақ, ішінде акцент нөмір ──
    `${sel(CARDS)}{background:var(--bg2);border:0;border-radius:0;box-shadow:none}`,
    `${sel(CARD_DECOR)}{display:none}`,
    `${S} .concept,${S} .st,${S} .hn,${S} .stat{border-top:8px solid var(--text)}`,
    `${S} .concept-n,${S} .hn-n{font-size:30px;letter-spacing:-.02em;font-weight:700;color:var(--accent)}`,
    solid(`${S} .numeral-xl,${S} .mega,${S} .st-n`, 'var(--accent)'),
    `${S} .st-n{font-size:calc(80px*var(--fs,1));letter-spacing:-.04em}`,
    `${S} .st-arrow{visibility:hidden}`, // блок ішіндегі көрсеткі келесі блокқа жетпейді — реттілікті нөмір береді
    `${S} .st-mark{margin-bottom:var(--s3)}`,
    // статистика: алып сан (мәтін түсі) + акцент жұрнақ + тұтас шкала; реттік нөмір артық
    `${S} .stat-ix{display:none}`,
    solid(`${S} .stat-v`, 'var(--text)'),
    `${S} .stat-v .sfx{color:var(--accent);-webkit-text-fill-color:var(--accent)}`,
    `${S} .stat-l{color:var(--text2);max-width:none}`,
    `${S} .meter{height:12px;border-radius:0;background:var(--bg3)}${S} .meter i{border-radius:0;background:var(--accent);box-shadow:none}`,
    // иерархия: сол жаққа тураланған тақырып + тікбұрышты тармақ сызықтары (блоктардың сол жақ шетінен)
    `${S} .hier-root{text-align:left;align-items:flex-start}${S} .hier-root .title.center,${S} .hier-root .lead.center{text-align:left;margin-left:0}`,
    `${S} .tree::before{left:0;top:-40px;width:3px;height:73px;background:var(--text)}`,
    `${S} .tree::after{left:0!important;height:3px;background:var(--text)}`,
    ...[2, 3, 4, 5, 6].map((n) => `${S} .tree.n${n}::after{right:calc((100% - ${n - 1}*var(--gut))/${n} - 3px)!important}`),
    `${S} .hn::before{left:0;top:-37px;width:3px;height:29px;background:var(--text)}`,

    // ── уақыт сызығы: шаршы түйіндер қалың сызықта ──
    solid(`${S} .tl-date`, 'var(--text)'),
    `${S} .tl-mark::after{width:20px;height:20px;margin-top:-10px;border:0;border-radius:0;background:var(--accent);box-shadow:none}`,
    `${S} .tl-mark::before{background:var(--text);height:3px;margin-top:-1px}`,

    // ── фото: жиексіз, көлеңкесіз (inline көлеңке де өшеді) ──
    `${S} .photo{border:0;border-radius:0!important;box-shadow:none!important}${S} .photo::after{display:none}`,

    // ── басқа элементтер ──
    // қорытынды тізімі: жолдар арасы ықшамырақ (4 пункт + тақырып жарты бетке кішірейтусіз сыйсын)
    `${S} .closing-slide .row{padding:18px 0}${S} .close-split .close-r .rows{margin-top:var(--s3)}`,
    `${S} .notes li{border-left:6px solid var(--accent);color:var(--text2)}`,
    `${S} .data-table th{background:var(--text);color:var(--bg);border-bottom:0;border-radius:0!important;font-weight:700;letter-spacing:.06em}`,
    `${S} .data-table tbody tr:nth-child(even) td{background:var(--bg2)}`,
    `${S} .data-table tr:last-child td{border-bottom:4px solid var(--text)}`,
    solid(`${S} .qmark`, 'var(--accent)'),
    `${S} .qrule{width:22px;height:22px;border-radius:0}`,
    `${S} .qwho{letter-spacing:.06em;font-weight:700}`,
    // пайыз сақинасы: тұтас акцент, жарқылсыз; ішіндегі сан — мәтін түсі
    `${S} .ring{background:conic-gradient(from -90deg,var(--accent) 0 calc(var(--pp)*360deg),var(--bg3) calc(var(--pp)*360deg));filter:none}`,
    solid(`${S} .mega.in-ring`, 'var(--text)'),
    `${S} .numb-r{border-left:4px solid var(--text)}`,
    `${S} .ig-source{color:var(--text2)}`,
    `${S} .ig-bar.on,${S} .ig-col.on,${S} .ig-road,${S} .ig-split .a,${S} .ig-col-head.good{background:var(--accent);box-shadow:none;border-radius:0}`,
    `${S} .ig-bar,${S} .ig-col,${S} .ig-track,${S} .ig-split .b,${S} .ig-col-head{border-radius:0}`,
    `${S} .ig-node{background:var(--bg2);box-shadow:none;border-radius:0}${S} .ig-node.on,${S} .ig-badge.on{background:var(--accent)}`,
    `${S} .ig-mile.on{box-shadow:none}${S} .ig-dot{box-shadow:none}`,
    `${S} .hl-panel{background:var(--accent)}`,
  ].join('\n'),
};
