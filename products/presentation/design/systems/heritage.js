'use strict';
/**
 * HERITAGE («Мұра») — гуманитарлық сала (тарих, әдебиет, философия). Тұтас түсті геометрия (шеңбер, блок) ЖОҚ:
 * көрініс ескі кітап/мұрағат тілімен құрылады —
 *   • жылы қағаз фон + әлсіз түйіршік пен жиек көлеңкесі;
 *   • қошқар мүйіз оюы (бөлгіш, мұқаба), жұқа қос жиектеме;
 *   • тақырып бағанасы — шеті жыртық қағаз парағы (процедуралық, әр слайдта басқаша);
 *   • ұғымдар — рим цифрлы, жұқа тік сызықпен бөлінген бағандар;
 *   • уақыт сызығы — жұқа сызық + ромб түйіндер, жылдар ірі курсив антиква;
 *   • мұқаба-фото — доға ішінде, сыртында ығыстырылған жұқа доға-сызық.
 */
const T = require('../tokens');

const S = '#stage.ds-heritage';
const enc = (svg) => 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';

/** Қошқар мүйіз: ортада ромб, екі жаққа сызық, ұштары ішке бұралған мүйіз */
function ramHorn(c) {
  const horn = 'M30 12c-9 0-14-5-11-10 2-3 8-2 7 3-1 3-5 2-4-1';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 24"><g fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round">` +
    `<path d="M120 4l8 8-8 8-8-8z" fill="${c}"/><path d="M132 12h70M108 12H38"/>` +
    `<path d="${horn}" transform="translate(8 0)"/><path d="${horn}" transform="matrix(-1 0 0 1 232 0)"/>` +
    `<path d="M130 12c6-7 14-7 16-2M110 12c-6-7-14-7-16-2"/></g></svg>`;
}
/** Жыртық шет: оң (не сол) жиегі ирек polygon — seed бойынша әр түрлі */
function deckle(seed, side) {
  let x = seed * 9301 + 49297;
  const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  const pts = [];
  for (let i = 0; i <= 40; i++) pts.push(`${(97.2 + rnd() * 2.8).toFixed(2)}% ${(i * 2.5).toFixed(1)}%`);
  const right = pts.join(',');
  const poly = side === 'left'
    ? 'polygon(' + pts.map((p) => { const [a, b] = p.split(' '); return (100 - parseFloat(a)).toFixed(2) + '% ' + b; }).join(',') + ',100% 100%,100% 0)'
    : 'polygon(0 0,' + right + ',0 100%)';
  return poly;
}

function css(p) {
  const ink = p.text;
  const deep = T.mixHex(p.text, p.accent, 0.3);
  const acc = p.accent;
  const paper2 = T.mixHex(p.bg, p.text, 0.075);
  const hair = T.mixHex(p.bg, p.text, 0.35);
  const orn = enc(ramHorn(acc));
  const sheet = (sel, left) => `${S} ${sel}{position:relative;z-index:0}` +
    `${S} ${sel}::before{content:"";position:absolute;z-index:-1;top:-2000px;bottom:-2000px;` +
    (left ? 'left:-600px;right:-70px' : 'left:-70px;right:-600px') +
    `;background:${paper2};clip-path:${deckle(left ? 7 : 3, left ? 'right' : 'left')};` +
    `filter:drop-shadow(${left ? '6px' : '-6px'} 0 10px rgba(60,40,20,.14))}`;
  return [
    // фон: жылы қағаз, түйіршік + жиегі сәл қараңғы (ескі парақ); палитраның дақтары/аврорасы жоқ
    `${S} .deco,${S} .aurora,${S} .halo{display:none!important}`,
    `${S} .layer-bg::before{display:block!important;background:radial-gradient(130% 110% at 50% 45%,transparent 58%,rgba(90,60,30,.16) 100%)!important;opacity:1!important}`,
    `${S} .plate,${S} .plate-cover,${S} .plate-section{background:var(--bg)!important}`,
    `${S} .title .hl{background:none!important;-webkit-text-fill-color:${acc}!important;color:${acc}!important;font-style:italic}`,
    `${S} .kicker{color:${acc};letter-spacing:.24em;font-weight:700;padding-bottom:30px;background:${orn} left bottom/180px 18px no-repeat}`,
    `${S} .rule{width:220px!important;height:22px!important;background:${orn} left center/220px 22px no-repeat!important}`,

    // ── мұқаба ──
    `${S} .arch-photo{position:absolute;right:170px;top:110px;width:600px;height:860px;border-radius:300px 300px 0 0;overflow:hidden;z-index:2;box-shadow:0 30px 60px -30px rgba(60,40,20,.45)}`,
    `${S} .arch-photo img{width:100%;height:100%;object-fit:cover}`,
    `${S} .arch-line{position:absolute;right:140px;top:80px;width:600px;height:860px;border-radius:300px 300px 0 0;border:1.5px solid ${acc};z-index:1}`,
    `${S} .cover-frame{position:absolute;inset:48px;border:1.5px solid ${hair};outline:1.5px solid ${hair};outline-offset:-14px}`,
    `${S} .orn-cover{position:absolute;left:var(--mx);top:130px;width:260px;height:26px;background:${orn} center/260px 26px no-repeat}`,
    `${S} .has-arch .cover-arch .cover-block{position:absolute;left:var(--mx);top:210px}`,
    `${S} .no-arch .cover-arch .cover-block{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;width:1400px!important}`,
    `${S} .no-arch .cover-arch .kicker{background-position:center bottom}`,
    `${S} .no-arch .orn-cover{left:50%;margin-left:-130px;top:auto;bottom:130px}`,
    `${S} .no-arch .meta-row{justify-content:center}`,

    // ── ұғымдар: рим цифры + жұқа тік сызықтар ──
    `${S} .concepts{counter-reset:roman;column-gap:0!important}`,
    `${S} .concept{counter-increment:roman;border:0!important;border-left:1.5px solid ${hair}!important;border-radius:0!important;box-shadow:none!important;background:none!important;padding:8px 44px 8px 44px!important}`,
    `${S} .concept:first-child{border-left:0!important;padding-left:0!important}`,
    `${S} .concept::before{content:counter(roman,upper-roman)!important;position:static!important;display:block;width:auto!important;height:auto!important;background:none!important;font-family:var(--f-display);font-style:italic;font-size:64px;line-height:1;color:${acc};margin-bottom:28px}`,
    `${S} .concept::after,${S} .concept-n{display:none!important}`,
    `${S} .concept-l{font-family:var(--f-display);font-weight:400;font-size:calc(var(--rl,40px)*1.75*var(--fs,1));line-height:1.06;color:${ink}}`,
    `${S} .concept-d{font-size:calc(var(--rd,26px)*1.1*var(--fs,1));color:var(--text2)}`,

    // ── тізім/мәтін/қорытынды: тақырып жыртық шетті қағаз парағында ──
    sheet('.pts-l.at-l', true), sheet('.pts-l.at-r', false),
    sheet('.edit-l.at-l', true), sheet('.edit-l.at-r', false),
    sheet('.close .close-l', true),
    `${S} .row-n{font-family:var(--f-display);font-style:italic;color:${acc};font-weight:400;font-size:36px;background:none!important;border:0!important}`,
    `${S} .rows{border-top:0}${S} .row{border-color:${hair}}`,

    // ── уақыт сызығы: жұқа сызық + ромб ──
    `${S} .tl-mark::before{background:${hair}!important;height:1.5px!important}`,
    `${S} .tl-mark::after{width:16px!important;height:16px!important;margin-top:-8px!important;border-radius:0!important;transform:rotate(45deg);background:${acc}!important;box-shadow:0 0 0 7px var(--bg)!important}`,
    `${S} .tl-date{font-size:calc(var(--ds,54px)*1.45*var(--fs,1))!important;font-style:italic;background:none!important;-webkit-text-fill-color:${deep}!important;color:${deep}!important;font-weight:400}`,
    `${S} .tl-txt{font-size:calc(var(--bs,28px)*1.12*var(--fs,1))}`,

    // ── сандар: курсив антиква, астында ою ──
    `${S} .stat{background:none!important;border:0!important;box-shadow:none!important;border-radius:0!important;padding-bottom:40px!important}`,
    `${S} .stat::before,${S} .stat::after,${S} .meter{display:none!important}`,
    `${S} .stat::after{content:""!important;display:block!important;position:static!important;width:150px;height:16px;margin-top:20px;background:${orn} left center/150px 16px no-repeat!important;opacity:1!important}`,
    `${S} .numeral-xl,${S} .mega,${S} .st-n,${S} .stat-v{background:none!important;-webkit-text-fill-color:${deep}!important;color:${deep}!important;font-family:var(--f-display);font-style:italic;font-weight:400}`,

    // ── инфографика карточкалары: тегіс, жиексіз ──
    `${S} .ig-card,${S} .hn,${S} .st{background:none!important;box-shadow:none!important;border:0!important;border-top:1.5px solid ${hair}!important;border-radius:0!important}`,

    // ── ботаникалық гравюралар: бос бұрышта, шеттен сәл шығып, қағазға «басылғандай» ──
    `${S} .botanic{position:absolute;pointer-events:none;object-fit:contain;mix-blend-mode:multiply;filter:saturate(.85) sepia(.12);opacity:.95}`,
    `${S} .bt-corner{right:-40px;bottom:-60px;width:360px;height:440px;object-position:right bottom;transform:rotate(-6deg)}`,
    `${S} .bt-close{right:-30px;bottom:-50px;width:300px;height:380px;object-position:right bottom;transform:rotate(-4deg);opacity:.9}`,
    `${S} .bt-cover{right:120px;top:50%;width:560px;height:820px;transform:translateY(-50%);object-position:center}`,
    `${S} .no-arch .cover-arch .cover-block{left:var(--mx)!important;transform:translateY(-50%)!important;text-align:left!important;width:1050px!important}`,
    `${S} .no-arch .meta-row{justify-content:flex-start}${S} .no-arch .orn-cover{left:var(--mx);margin-left:0}`,
    // ── бөлім ──
    `${S} .L-section .canvas{text-align:center}`,

    // ── фото: жұқа ақ паспарту + көлеңке (ескі фотосурет) ──
    `${S} .photo,${S} .bleed{border-radius:0!important}`,
    `${S} .photo{border:14px solid #fbf8f1!important;box-shadow:0 22px 44px -22px rgba(60,40,20,.5)!important}`,
  ].join('\n');
}

module.exports = {
  id: 'heritage',
  name: 'Мұра',
  type: { display: 'serif', text: 'sans', dw: 400, tw: 400, dt: '-0.02em', tt: '-0.01em', dl: 1.02, tl: 1.08, italicQuote: true },
  moods: ['sand', 'light', 'ivory'],
  num: 'pad',
  folio: { title: false, total: false, pad: true, cover: false },
  cover: 'arch',
  botanic: true,
  closing: 'rows',
  css,
};
