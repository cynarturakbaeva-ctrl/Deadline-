'use strict';
/**
 * ТЕХНО — инженерлік сызба тілі: Arial Bold тақырып, Calibri мәтін, барлық белгі-жазулар Courier New Bold (моно),
 * нөмірлер [01], кілт сөздің астында маркер жолағы, «өлшем сызығы» |—| (тақырып белгісі), пунктир бөлгіштер мен
 * байланыс сызықтары, ақ қағаз-карточкалар қарама-қарсы бұрыштарында акцент «қысқыш» белгілерімен,
 * фото ығыстырылған акцент контурымен, торлы (миллиметровка) фон. Атмосфера/жылтыр жоқ — тек сызба.
 *
 * Ескерту: ::before/::after ішіндегі МӘТІН PPTX-ке түспейді (textLayer тек DOM мәтінін оқиды) —
 * сондықтан псевдо-элементтер тек графика (сызық, бұрыш, тор).
 */
const { calm, solid, CARDS, CARD_DECOR } = require('./_fx');

const S = '#stage.ds-mono';
const MONO = '"Courier New","Liberation Mono",monospace';
const sel = (list) => list.split(',').map((x) => `${S} ${x}`).join(',');
// миллиметровка: 64px тор (контент шеті 128px — тор сызығына дәл түседі)
const GRID_LINES = (pct) => `linear-gradient(color-mix(in srgb,var(--text) ${pct}%,transparent) 1px,transparent 1px) 0 0/64px 64px,` +
  `linear-gradient(90deg,color-mix(in srgb,var(--text) ${pct}%,transparent) 1px,transparent 1px) 0 0/64px 64px`;
const A = 'linear-gradient(var(--accent),var(--accent))';
// карточка бұрыштары: сол-жоғары және оң-төмен «қысқыш» (фонның бөлігі → PPTX-те суретпен бірге)
const TICKS = `${A} 0 0/26px 4px no-repeat,${A} 0 0/4px 26px no-repeat,${A} 100% 100%/26px 4px no-repeat,${A} 100% 100%/4px 26px no-repeat`;
// өлшем сызығы |———|
const DIM = `${A} 0 50%/100% 2px no-repeat,${A} 0 0/2px 100% no-repeat,${A} 100% 0/2px 100% no-repeat`;

module.exports = {
  id: 'mono',
  name: 'Техно',
  type: { display: 'arial', text: 'sans', dw: 700, tw: 700, dt: '-0.03em', tt: '-0.02em', dl: 1.02, tl: 1.06 },
  // салқын «сызба» палитралары: түнгі көк, мұздай көгілдір, графит+қызғылт сары, терминал жасылы; ашық — көкшіл қағаз,
  // жалбыз, піл сүйегі (сызба қағазы + қою көк сия)
  moods: ['midnight', 'cold', 'graphite', 'forest', 'cloud', 'mint', 'ivory'],
  num: 'bracket',
  folio: { title: true, total: true, pad: true, cover: false },
  cover: 'classic',
  // фото бір жақта толық биіктікте, анық (бүкіл фонға жайылып, тұманданып кетпейді)
  closing: 'split',
  css: (palette) => {
    const light = !palette || palette.isLight !== false;
    const CARD = light ? 'color-mix(in srgb,var(--bg) 45%,#fff)' : 'color-mix(in srgb,var(--bg) 92%,var(--text))';
    const MARK = light ? 'color-mix(in srgb,var(--accent) 30%,transparent)' : 'color-mix(in srgb,var(--accent) 42%,transparent)';
    return [
      calm(S),
      // ── фон: торлы қағаз (фото-сыз слайдтар) ──
      `${S} .plate,${S} .plate-cover,${S} .plate-section{background:${GRID_LINES(light ? 6 : 7)},var(--bg)}`,

      // ── моно белгі-жазулар: Courier New Bold, бас әріпсіз, контрасты ──
      `${sel('.kicker,.folio,.row-n,.meta-k,.stat-ix,.concept-n,.hn-n,.data-table th,.ig-source,.cover-org,.ref-n,.qwho,.st-n')}{font-family:${MONO};letter-spacing:0;text-transform:none}`,
      `${S} .kicker{font-size:22px;font-weight:700;color:var(--accent)}`,
      `${S} .meta-k{font-size:20px;font-weight:700;color:var(--text2)}${S} .meta-row.is-dense .meta-k{font-size:20px}`,
      `${S} .cover-org{font-size:24px;font-weight:700;color:var(--text)}`,
      `${S} .stat-ix{font-size:20px;font-weight:700;color:var(--text2)}`,
      `${S} .concept-n,${S} .hn-n{font-size:22px;font-weight:700;color:var(--accent)}`,
      `${S} .ig-source{color:var(--text2)}`,

      // ── бет нөмірі: «01 / 12» моно, сол жақта жүгірме тақырып, арасында пунктир өлшем сызығы ──
      `${S} .folio{font-size:20px;font-weight:400;color:var(--text2);align-items:center;gap:24px}`,
      `${S} .folio b{font-weight:700;color:var(--text)}${S} .folio .of{color:var(--text2)}`,
      `${S} .folio-l{order:0}${S} .folio-l:empty{display:none}${S} .folio-r{order:2;margin-left:auto;white-space:nowrap}`,
      `${S} .folio::after{content:'';order:1;flex:1 1 auto;height:0;border-top:1px dashed var(--line)}`,
      // фото бар слайдта сызық жоқ; фото сол жақта → жүгірме тақырып жасырын (фото үстіне түспейді);
      // фото оң жақта → нөмір сол жаққа (фото үстіне түспейді)
      `${S} .slide:has(.full,.bleed) .folio::after{display:none}`,
      `${S} .slide:has(.bleed[style^="left:0"],.bleed[style*="left: 0"]) .folio-l{display:none}`,
      `${S} .slide:has(.bleed[style^="right:0"],.bleed[style*="right: 0"]) .folio-l{display:none}`,
      `${S} .slide:has(.bleed[style^="right:0"],.bleed[style*="right: 0"]) .folio-r{order:-1;margin-left:0}`,

      // ── тақырып: кілт сөздің астында маркер жолағы (мәтін түсі өзгермейді → оқылуы толық) ──
      solid(`${S} .title .hl`, 'inherit'),
      `${S} .title .hl{background:linear-gradient(180deg,transparent 0 58%,${MARK} 58% 94%,transparent 94%)!important;padding:0 .06em;margin:0 -.06em;-webkit-box-decoration-break:clone;box-decoration-break:clone}`,
      `${S} .slide .on-accent .title .hl{text-decoration:none}`,

      // ── өлшем сызығы |———| (тақырып белгісі, дәйексөз белгісі) ──
      `${S} .rule,${S} .qrule{height:14px;border:0;border-radius:0;background:${DIM}!important}`,

      // ── тізім: [01] моно нөмір мәтіннің бірінші жолымен бір сызықта, пунктир бөлгіштер ──
      `${S} .row{align-items:baseline;border-bottom:1px dashed var(--line)}${S} .rows{border-top:0}${S} .row:first-child{border-top:1px dashed var(--line)}`,
      `${S} .row-n{display:block;background:none;border:0;border-radius:0;min-width:68px;width:auto;height:auto;padding:0;margin:0;font-size:22px;font-weight:700;color:var(--accent)}`,
      `${S} .notes li{border-left:2px dashed var(--accent)}`,

      // ── карточкалар: ақ «қағаз», бейтарап жиек, қарама-қарсы бұрыштарда акцент қысқыш ──
      `${sel(CARDS)}{background:${TICKS},${CARD};background-origin:border-box;border:1px solid var(--line);border-radius:0;box-shadow:none}`,
      `${sel(CARD_DECOR)}{display:none}`,
      // қадамдар: ірі моно нөмір + пунктир көрсеткі
      solid(`${S} .numeral-xl,${S} .mega,${S} .st-n`, 'var(--accent)'),
      `${S} .st-n{font-size:calc(52px*var(--fs,1));font-weight:700;letter-spacing:-.02em}`,
      `${S} .st-arrow{background:none;height:0;border-top:2px dashed var(--accent)}`,
      `${S} .st-arrow::after{top:-7px;border-top-width:2px;border-right-width:2px;border-color:var(--accent)}`,
      // иерархия: пунктир байланыс сызықтары
      `${S} .tree::before,${S} .hn::before{width:2px;background:repeating-linear-gradient(180deg,var(--accent) 0 6px,transparent 6px 11px)}`,
      `${S} .tree::after{height:2px;background:repeating-linear-gradient(90deg,var(--accent) 0 6px,transparent 6px 11px)}`,
      // статистика: алып сан мәтін түсінде, жұрнақ акцент, сегментті шкала (сегменттер қысылмайды)
      solid(`${S} .stat-v`, 'var(--text)'),
      `${S} .stat-v .sfx{color:var(--accent);-webkit-text-fill-color:var(--accent)}`,
      `${S} .meter{height:12px;border-radius:0;background:repeating-linear-gradient(90deg,color-mix(in srgb,var(--text) 16%,transparent) 0 8px,transparent 8px 12px)}`,
      `${S} .meter i{right:auto;width:calc(var(--p,0)*100%);transform:none!important;border-radius:0;background:repeating-linear-gradient(90deg,var(--accent) 0 8px,transparent 8px 12px);box-shadow:none}`,
      `${S} .ring{background:conic-gradient(from -90deg,var(--accent) 0 calc(var(--pp)*360deg),var(--bg3) calc(var(--pp)*360deg));filter:none}`,
      solid(`${S} .mega.in-ring`, 'var(--text)'),
      `${S} .numb-r{border-left:2px dashed var(--line)}`,

      // ── уақыт сызығы: пунктир жол, бос шаршы түйіндер ──
      solid(`${S} .tl-date`, 'var(--accent)'),
      `${S} .tl-mark::before{background:none;height:0;margin-top:-1px;border-top:2px dashed var(--accent)}`,
      `${S} .tl-mark::after{border-radius:0;width:18px;height:18px;margin-top:-9px;border:3px solid var(--accent);background:var(--bg);box-shadow:0 0 0 6px var(--bg)}`,

      // ── фото: жиексіз, ығыстырылған акцент контур (inline көлеңке мен дөңгелек бұрыш та өшеді) ──
      `${S} .photo{border:0;border-radius:0!important;box-shadow:16px 16px 0 -2px var(--bg),16px 16px 0 0 var(--accent)!important}${S} .photo::after{display:none}`,

      // ── мұқаба: фото үстінде нәзік тор (тақырып жағында, фотоға қарай сөнеді) + сызба бұрыштары ──
      `${S} .cover-photo .layer-bg::after{display:block;content:'';position:absolute;inset:0;z-index:3;opacity:1;mix-blend-mode:normal;` +
        `background:${GRID_LINES(light ? 7 : 8)};-webkit-mask-image:linear-gradient(90deg,#000 0%,#000 30%,transparent 72%);mask-image:linear-gradient(90deg,#000 0%,#000 30%,transparent 72%)}`,
      `${S} .cover::before,${S} .cover::after{content:'';position:absolute;width:40px;height:40px;pointer-events:none}`,
      `${S} .cover::before{left:-40px;top:-40px;border-left:4px solid var(--accent);border-top:4px solid var(--accent)}`,
      `${S} .cover::after{right:-40px;bottom:-24px;border-right:4px solid var(--accent);border-bottom:4px solid var(--accent)}`,
      `${S} .meta-row{border-top:2px solid var(--text);padding-top:var(--s3)}`,
      `${S} .meta-i+.meta-i{border-left:1px dashed var(--line);padding-left:var(--s4)}${S} .meta-row:not(.is-dense){gap:var(--s4)}`,
      `${S} .meta-row.is-dense .meta-i{border-left:0;padding-left:0}`,

      // ── қорытынды: фото сол жақта (closing:'split'), шетінде акцент жолақ ──
      `${S} .closing-slide .bleed::after{content:'';position:absolute;top:0;bottom:0;right:0;width:6px;background:var(--accent)}`,
      `${S} .closing-slide .row{padding:20px 0}`,

      // ── басқалары ──
      `${S} .data-table th{background:none;border-bottom:2px solid var(--accent);color:var(--accent);font-weight:700;border-radius:0!important}`,
      `${S} .data-table td{border-bottom:1px dashed var(--line)}${S} .data-table tr:last-child td{border-bottom:2px solid var(--text)}`,
      `${S} .data-table tbody tr:nth-child(even) td{background:none}`,
      solid(`${S} .qmark`, 'var(--accent)'),
      `${S} .qwho{font-weight:700}`,
      `${S} .figure{border-radius:0;box-shadow:none;border:1px solid var(--line)}`,
      // инфографика: тікбұрышты, жылтырсыз
      `${sel('.ig-node,.ig-card,.ig-band,.ig-bar,.ig-col,.ig-track,.ig-sw,.ig-vs,.ig-mile,.ig-badge,.ig-split .a,.ig-split .b,.ig-col-head,.ig-road')}{border-radius:0}`,
      `${S} .ig-bar.on,${S} .ig-col.on,${S} .ig-node,${S} .ig-mile.on,${S} .ig-dot{box-shadow:none}`,
      `${S} .ig-node{background:${CARD}}`,
    ].join('\n');
  },
};
