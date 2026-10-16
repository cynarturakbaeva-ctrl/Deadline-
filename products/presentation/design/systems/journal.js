'use strict';
/**
 * ЖУРНАЛ — сапалы баспасөз беті: Times тақырып (жеңіл салмақ, үлкен), Arial мәтін, курсив кілт сөз, курсив нөмірлер.
 * Қолтаңбасы — «қалың + жіңішке» қос сызық (Scotch rule): мұқабадағы masthead, тізім мен кестенің басы, тақырып алдындағы
 * акцент белгі. Бет нөмірі ЖОҒАРЫДА (running head + жіңішке сызық), бағандар арасында тік жіңішке сызық,
 * фото — көлеңкесіз, тік бұрышты, жіңішке жиекті. Атмосфералық эффект жоқ — таза «қағаз».
 */
const { calm, solid, CARDS, CARD_DECOR } = require('./_fx');
const { GRID } = require('../tokens');

const S = '#stage.ds-journal';
const px = (v) => Math.round(v * 100) / 100 + 'px';
/** n-ші бағанның сол жақ шеті (px) */
const colX = (n) => GRID.marginX + (n > 1 ? GRID.span(n - 1) + GRID.gutter : 0);
/** Қос сызық: жоғарыда қалың, астында жіңішке (Scotch rule) */
const scotch = (c, thick = 3) => `height:${thick + 4}px;border-top:${thick}px solid ${c};border-bottom:1px solid ${c};background:none`;
/** Тақырып жанындағы subtitle абзацтары (денелік мәтін емес) */
const DEKS = '.proc-head .para,.tl-head .para,.tbl-head .para,.igk-head .para,.stats-head .para,.igs-l .para,.numb-r .para';
const sel = (list) => list.split(',').map((x) => `${S} ${x.trim()}`).join(',');

module.exports = {
  id: 'journal',
  name: 'Журнал',
  type: { display: 'serif', text: 'arial', dw: 400, tw: 400, dt: '-0.02em', tt: '-0.012em', dl: 1.0, tl: 1.06, italicQuote: true },
  // жылы «қағаз» + терең түнгі «баспа» палитралары; жасыл/көк «техно» түстер журналға жат
  moods: ['ivory', 'sand', 'light', 'blush', 'archive', 'wine', 'graphite'],
  num: 'plain',
  folio: { title: true, total: false, pad: false, cover: false },
  cover: 'masthead',
  closing: 'split', // фото бір жақта, түйіндер екінші жақта
  css: () => [
    calm(S),
    `${S} .plate,${S} .plate-cover{background:var(--bg)}`,
    `${S} .plate-section{background:var(--bg2)}`,

    // ── тақырып: кілт сөз курсив, тұтас акцент ──
    solid(`${S} .title .hl`, 'var(--accent)'),
    `${S} .title .hl{font-style:italic;padding-right:.02em}`,
    // лид (standfirst) — журналдағыдай серифті курсив; Times кіші көрінеді → 8% ірірек, түсі анық
    `${S} .lead{font-family:var(--f-display);font-style:italic;font-size:calc(var(--ls,38px)*1.08*var(--fs,1));line-height:1.3;letter-spacing:0;color:var(--text2)}`,
    // тақырып жанындағы ішкі тақырып (subtitle) мәтіні де — сол серифті курсив (бір слайдта Arial, келесісінде Times болмасын)
    `${sel(DEKS)}{font-family:var(--f-display);font-style:italic;font-size:calc(var(--bs,28px)*1.1*var(--fs,1));line-height:1.36;letter-spacing:0;color:var(--text2)}`,

    // ── қолтаңба: қос сызық (қалың + жіңішке) ──
    `${S} .rule{width:72px!important;${scotch('var(--accent)')}!important;border-radius:0;opacity:1}`,
    // тізімнің өз қос сызығы бар → алдындағы қысқа белгі артық (үш сызық қатар тұрмасын)
    `${S} .rule:has(+ .rows){visibility:hidden;height:0!important;border:0!important;margin:var(--s4) 0 0}`,
    `${S} .rows{border-top:0}${S} .rows::before{content:'';display:block;${scotch('var(--text)')}}`,
    `${S} .row,${S} .row:first-child{border-color:var(--line)}${S} .row:first-child{border-top:0}`,
    `${S} .table-wrap::before{content:'';display:block;${scotch('var(--text)')}}`,

    // ── бет нөмірі жоғарыда: курсив running head + нөмір + жіңішке сызық ──
    `${S} .folio{top:44px;bottom:auto;font-family:var(--f-display);font-style:italic;text-transform:none;letter-spacing:.01em;font-size:22px;color:var(--text2);border-bottom:1px solid var(--line);padding-bottom:12px}`,
    `${S} .folio b{font-style:normal;font-weight:400;font-size:24px;color:var(--text)}`,
    // фото шетке дейін жайылған слайдтарда бет нөмірі фотоны кесіп өтпейді — мәтін жағында тұрады
    `${S} .closing-slide:has(.close-split) .folio{left:${px(colX(7))}}`,
    `${S} .focus-slide:has(.bleed[style^="left"]) .folio{left:${px(colX(9))}}`,
    `${S} .focus-slide:has(.bleed[style^="right"]) .folio{right:${px(GRID.W - GRID.marginX - GRID.span(4))}}`,
    // ақысыз колоданың белгісі төменгі бұрышта — жоғарыдағы бет нөміріне орын босатудың қажеті жоқ
    `${S}.has-badge .folio{right:var(--mx)}`,
    `${S} .fimg-slide .folio{color:rgba(255,255,255,.9);border-color:rgba(255,255,255,.4);text-shadow:0 1px 12px rgba(0,0,0,.45)}${S} .fimg-slide .folio b{color:#fff}`,

    // ── мұқаба (masthead): ұйым атауы + қос сызық, астында деректер жолы (dateline), тақырып төменгі жақта ──
    `${S} .mast-top{border-bottom:0;padding-bottom:0}`,
    `${S} .mast-top::after{content:'';display:block;${scotch('var(--text)', 4)}}${S} .mast-top:has(.cover-org[data-role])::after{margin-top:var(--s2)}`,
    // ұйым атауы жоқ болса — бос жол орын алмайды: қос сызық фотоның жоғарғы шетімен бір деңгейде
    `${S} .mast-top .cover-org:not([data-role]){display:none}`,
    `${S} .mast-top .cover-org{font-family:var(--f-display);font-weight:400;font-size:26px;letter-spacing:.1em;line-height:1.25;color:var(--text)}`,
    `${S} .cover-m .meta-row{order:1;border-top:0;padding-top:0;margin-top:calc(var(--s3) - var(--s5))}`,
    `${S} .cover-m .mast-l>.block{order:2;margin-top:auto}`,
    `${S} .meta-k{font-family:var(--f-display);font-style:italic;text-transform:none;letter-spacing:0;font-size:24px;font-weight:400;color:var(--text2)}`,
    `${S} .meta-v{color:var(--text)}`,

    // ── тізім нөмірлері — курсив сандар, таблеткасыз ──
    `${S} .row-n{background:none;border:0;border-radius:0;min-width:44px;height:auto;padding:0;margin-top:0;font-family:var(--f-display);font-style:italic;font-size:34px;line-height:1.05;letter-spacing:0;font-weight:400;color:var(--accent)}`,

    // ── карточкалар → газет бағандары: жоғарыда қалың сызық, фонсыз, бағандар арасында тік жіңішке сызық ──
    `${sel(CARDS)}{background:none;border:0;border-top:2px solid var(--text);border-radius:0;box-shadow:none;padding:var(--s4) var(--s2) var(--s3) 0;overflow:visible}`,
    `${sel(CARD_DECOR)}{display:none}`,
    `${S} .concept+.concept::after,${S} .stat+.stat::after{display:block;content:'';position:absolute;top:var(--s4);bottom:0;right:auto;width:1px;height:auto;border-radius:0;background:var(--line)}`,
    `${S} .concept+.concept::after{left:calc(var(--gut) / -2)}${S} .stat+.stat::after{left:calc(var(--s4) / -2)}`,
    `${S} .concepts:is(.n5,.n6) .concept:nth-child(3n+1)::after{display:none}`,
    `${S} .concept-n,${S} .hn-n,${S} .stat-ix{font-family:var(--f-display);font-style:italic;letter-spacing:0;font-size:26px;font-weight:400;color:var(--accent)}`,
    `${S} .stat-ix{color:var(--text2)}`,
    // қадамдар: жоғарғы сызықтың орнына нөмірден келесі қадамға созылған жіңішке көрсеткі (екі сызық қатар тұрмайды)
    `${S} .st{border-top:0;padding-top:0}`,
    `${S} .st-arrow{background:var(--text);height:1px}${S} .st-arrow::after{border-color:var(--text)}`,
    `${S} .st-n{font-style:italic}`,
    // иерархия: байланыс сызықтары — тұтас жіңішке (градиентті «өшіп бара жатқан» сызық емес)
    `${S} .tree::before,${S} .tree::after,${S} .hn::before{background:var(--text)}`,

    // ── сандар ──
    solid(`${S} .stat-v`, 'var(--text)'),
    solid(`${S} .numeral-xl,${S} .mega,${S} .st-n`, 'var(--accent)'),
    solid(`${S} .tl-date`, 'var(--text)'),
    `${S} .stat-v,${S} .mega,${S} .numeral-xl{font-weight:400}`,
    // бөлім ашатын слайд: журналдағы «тарау» нөмірі — ірі курсив сан
    `${S} .numeral-xl{font-style:italic;font-size:calc(280px*var(--fs,1));letter-spacing:-.02em}`,
    `${S} .meter{height:3px;border-radius:0;background:var(--line)}${S} .meter i{border-radius:0;background:var(--text);box-shadow:none}`,
    // пайыз сақинасы: жіңішке тұтас акцент, жарқылсыз
    `${S} .ring{filter:none;background:conic-gradient(from -90deg,var(--accent) 0,var(--accent) calc(var(--pp)*360deg),var(--line) calc(var(--pp)*360deg));-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 10px),#000 calc(100% - 9px));mask:radial-gradient(farthest-side,transparent calc(100% - 10px),#000 calc(100% - 9px))}`,

    // ── фото: тік бұрыш, жіңішке жиек, көлеңкесіз (imagery inline көлеңкесін басады) ──
    `${S} .photo{border:1px solid var(--text);border-radius:0!important;box-shadow:none!important}${S} .photo::after{display:none}`,

    // ── түсініктеме, кесте, дәйексөз ──
    `${S} .notes li{border-left:2px solid var(--accent);color:var(--text2)}`,
    `${S} .data-table th{background:none;border-bottom:1px solid var(--text);color:var(--text);font-family:var(--f-display);font-style:italic;font-weight:400;text-transform:none;letter-spacing:0;font-size:26px;padding-left:0}`,
    `${S} .data-table td{padding-left:0}${S} .data-table tbody tr:nth-child(even) td{background:none}`,
    `${S} .refs-list{border-top:2px solid var(--text)}${S} .ref-n{font-family:var(--f-display);font-style:italic;font-weight:400;font-size:1.1em}`,
    solid(`${S} .qmark`, 'var(--accent)'),
    `${S} .qtext{font-style:italic}`,
    `${S} .qwho{font-family:var(--f-display);font-style:italic;text-transform:none;letter-spacing:0;font-size:28px;font-weight:400}${S} .qrule{height:1px;width:48px;background:var(--text);border-radius:0}`,

    // ── уақыт сызығы ──
    `${S} .tl-mark::after{width:14px;height:14px;margin-top:-7px;border:0;background:var(--text);box-shadow:0 0 0 5px var(--bg)}`,
    `${S} .tl-mark::before{background:var(--text);height:1px}`,

    // ── инфографика: тұтас акцент, жарқыл/шыны жоқ ──
    `${S} .ig-bar.on,${S} .ig-col.on,${S} .ig-road,${S} .ig-split .a,${S} .ig-col-head.good{background:var(--accent);box-shadow:none}`,
    `${S} .ig-node{background:var(--bg);box-shadow:none}${S} .ig-node.on,${S} .ig-badge.on{background:var(--accent)}`,
    `${S} .ig-mile.on,${S} .ig-dot{box-shadow:none}`,
  ].join('\n'),
};
