'use strict';
/**
 * DECOR — мағыналы әшекей: слайдтың МАЗМҰНЫНА сай ескі гравюра (rawpixel CC0) не ботаникалық баспа (Cleveland CC0).
 * Сай тақырып табылмаса — әшекей ЖОҚ (кездейсоқ сурет қойылмайды). Орнын рендер кезінде placeDecor() өлшеп
 * таңдайды: мәтінге/фотоға тимейтін бос бұрыш; ондай бұрыш болмаса — алынып тасталады.
 */
const fs = require('fs');
const path = require('path');

const A = path.join(__dirname, '..', 'assets');
// тақырып белгісі → слайд мәтініндегі мағына (kk / ru / en)
const THEMES = {
  quill: /әдебиет|ақын|жазушы|шығарма|өлең|поэзи|роман|хат|жазба|қолжазба|литератур|поэт|писател|рукопис|letter|poet|writer|literature|manuscript/i,
  book: /кітап|оқу|білім|кітапхана|ғылым|зерттеу|оқулық|книг|библиотек|знани|наук|book|library|knowledge|study|research/i,
  scroll: /шежіре|жарлық|заң|келісім|құжат|мұрағат|грамот|летопис|указ|архив|договор|scroll|decree|archive|treaty|chronicle/i,
  hourglass: /уақыт|ғасыр|кезең|дәуір|тарих|эпох|век|время|период|истори|time|century|era|histor/i,
  clock: /уақыт|сағат|кесте|мерзім|время|час|срок|time|clock|schedule|deadline/i,
  laurel: /жеңіс|мұра|құрмет|марапат|жетістік|ұлы|победа|наслед|слава|наград|victory|legacy|honou?r|award|achievement/i,
  compass: /сапар|саяхат|экспедиция|бағыт|жол|карта|путешеств|экспедиц|направлен|journey|expedition|travel|navigation|direction/i,
  globe: /әлем|халықаралық|жаһан|дүниежүзі|география|мир|глобал|международ|географ|world|global|international|geograph/i,
  map: /карта|аумақ|шекара|жер|өңір|жібек жол|территор|границ|регион|шелков|map|territor|border|region|silk road/i,
  column: /антика|грек|рим|философ|мемлекет|демократия|сәулет|антич|философ|государств|архитект|ancient|greek|roman|philosoph|democracy|architect/i,
  owl: /даналық|философ|ойшыл|ақыл|білім|мудрост|мыслител|философ|wisdom|philosoph|thinker|reason/i,
  scales: /құқық|заң|әділ|сот|этика|право|закон|суд|справедлив|этик|law|justice|court|ethic|legal/i,
  anchor: /теңіз|порт|кеме|мұхит|море|порт|корабл|океан|sea|port|maritime|ocean|naval/i,
  ship: /теңіз|кеме|мұхит|сауда жолы|флот|море|корабл|флот|sea|ship|fleet|ocean/i,
  horse: /көшпелі|дала|жылқы|ат |атты|хан|батыр|соғыс|кочев|степ|лошад|конниц|nomad|steppe|horse|cavalry|khan/i,
  crown: /хан|хандық|билік|патша|мемлекет|монарх|император|ханств|власть|царь|король|khan|khanate|monarch|kingdom|empire|power/i,
  key: /кілт|құпия|ключ|тайн|secret/i,
  candle: /ағартушы|ағарту|дін|рухани жаңғыру|просвещ|религ|enlightenment|religio/i,
  telescope: /астроном|ғарыш|жұлдыз|аспан|космос|звезд|astronom|space|star|telescope/i,
  microscope: /биология|медицина|химия|зертхана|ғылыми|биолог|медицин|хими|лаборатор|biolog|medic|chemist|laborator|scien/i,
  gears: /өндіріс|техника|механизм|инженер|өнеркәсіп|технология|производ|техни|механизм|инженер|промышлен|industr|engineer|mechanic|technolog|machine/i,
  coins: /экономика|қаржы|ақша|сауда|салық|теңге|экономик|финанс|деньг|торгов|налог|econom|financ|money|trade|tax/i,
  theater: /театр|өнер|драма|сахна|актер|искусств|сцен|theat|drama|stage|art/i,
  pen: /жазу|эссе|мақала|журналист|письм|стать|журналист|writing|essay|article|journalis/i,
  letter: /хат|хабар|байланыс|пошта|письм|почт|связ|letter|mail|correspond/i,
  camera: /фото|кино|медиа|бұқаралық|фотограф|кино|сми|photo|film|cinema|media/i,
  flora: /табиғат|гүл|өсімдік|ботаника|экология|бау|әдебиет|поэзия|өлең|сұлулық|мәдениет|природ|цвет|растен|ботаник|эколог|поэз|культур|nature|flower|plant|botan|ecolog|poetry|culture|beauty/i,
};

let IDX = null;
function index() {
  if (IDX) return IDX;
  IDX = {};
  const add = (dir, file, tag) => { (IDX[tag] = IDX[tag] || []).push(path.join(dir, file)); };
  try {
    const m = JSON.parse(fs.readFileSync(path.join(A, 'decor', 'index.json'), 'utf8'));
    for (const [f, v] of Object.entries(m)) add(path.join(A, 'decor'), f, v.tag);
  } catch { /* жоқ */ }
  try {
    const b = JSON.parse(fs.readFileSync(path.join(A, 'botanic', 'index.json'), 'utf8'));
    for (const f of Object.keys(b).sort()) add(path.join(A, 'botanic'), f, 'flora');
  } catch { /* жоқ */ }
  return IDX;
}

/**
 * Слайд мәтініне ең сай әшекей. used — осы презентацияда алынған тақырыптар/файлдар (қайталанбасын).
 * @returns {{file:string, tag:string}|null} — сай тақырып жоқ → null
 */
function pickDecor(text, used, seed = 0) {
  const t = ' ' + String(text || '') + ' ';
  const idx = index();
  const scored = Object.keys(THEMES)
    .filter((tag) => idx[tag] && idx[tag].length)
    .map((tag) => ({ tag, n: (t.match(new RegExp(THEMES[tag].source, 'gi')) || []).length }))
    .filter((x) => x.n > 0 && !(used && used.has('tag:' + x.tag)))
    .sort((a, b) => b.n - a.n);
  if (!scored.length) return null;
  const tag = scored[0].tag;
  const files = idx[tag].filter((f) => !(used && used.has(f)));
  if (!files.length) return null;
  const file = files[Math.abs(seed) % files.length];
  if (used) { used.add(file); used.add('tag:' + tag); }
  return { file, tag };
}

const cache = new Map();
function decorUri(file) {
  if (cache.has(file)) return cache.get(file);
  let uri = '';
  try { uri = 'data:image/webp;base64,' + fs.readFileSync(file).toString('base64'); } catch { /* жоқ */ }
  cache.set(file, uri);
  return uri;
}

/* eslint-disable no-var */
/**
 * Браузерде (page.evaluate): әр .decor суретін бос бұрышқа қояды. Мәтін, фото, сызба, карточкаларға тимеуі керек;
 * сыймаса кішірейтіп көреді; бос бұрыш жоқ болса — алып тастайды. Нәтиже: [{slide, placed}].
 */
function placeDecor(only) {
  var out = [];
  [].forEach.call(document.querySelectorAll('.slide'), function (slide, si) {
    if (only != null && si !== only) return;
    var imgs = slide.querySelectorAll('img.decor');
    if (!imgs.length) return;
    var st = document.getElementById('stage');
    var k = parseFloat(getComputedStyle(st).getPropertyValue('--fit')) || 1;
    var prevDisp = slide.style.display; slide.style.display = 'block';
    var sr = slide.getBoundingClientRect();
    var blocks = [];
    [].forEach.call(slide.querySelectorAll('.layer-mid *, .layer-bg .photo, .layer-bg .bleed, .layer-bg .arch-photo, .layer-bg .full, .layer-bg .doodle, .figure, .layer-bg .botanic'), function (el) {
      if (el.tagName === 'IMG' && el.classList.contains('decor')) return;
      var own = [].some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
      var visual = /^(IMG|SVG|CANVAS)$/i.test(el.tagName) || el.classList.contains('photo') || el.classList.contains('bleed') || el.classList.contains('full') || el.classList.contains('concept') || el.classList.contains('stat') || el.classList.contains('ig-card');
      if (!own && !visual) return;
      var r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      blocks.push({ x: (r.left - sr.left) / k, y: (r.top - sr.top) / k, w: r.width / k, h: r.height / k, m: el.closest('h1,.title') ? 110 : 36 });
    });
    var full = blocks.some(function (b) { return b.w > 1800 && b.h > 1000; }); // бүкіл фон-фото — әшекей керек емес
    // бет нөмірі мен ұсақ белгілер (folio) кедергі емес
    blocks = blocks.filter(function (b) { return !(b.h < 40 && b.w < 260 && b.y > 960); });
    [].forEach.call(imgs, function (img) {
      var ar = (img.naturalWidth || 1) / (img.naturalHeight || 1);
      var M = 36; var placed = null;
      var free = function (x, y, w, h) {
        return !blocks.some(function (b) { var m = b.m || M; return x < b.x + b.w + m && x + w + m > b.x && y < b.y + b.h + m && y + h + m > b.y; });
      };
      if (!full) {
        var sizes = [400, 340, 280, 220, 170];
        outer: for (var s = 0; s < sizes.length; s++) {
          var h = sizes[s]; var w = Math.min(h * ar, 560); h = w / ar;
          // бұрыштарға жақын орындар бірінші (оң-төмен → оң-жоғары → сол-төмен → сол-жоғары), сосын шеттер бойымен
          var cand = [];
          for (var gx = 0; gx <= 12; gx++) {
            for (var gy = 0; gy <= 8; gy++) {
              var x = 60 + (1920 - 120 - w) * (gx / 12); var y = 50 + (1080 - 100 - h) * (gy / 8);
              var dx = Math.min(x - 60, 1860 - (x + w)); var dy = Math.min(y - 50, 1030 - (y + h));
              var right = x + w / 2 > 960 ? 0 : 1; var bottom = y + h / 2 > 540 ? 0 : 1;
              cand.push({ x: x, y: y, cost: dx + dy + right * 140 + bottom * 320 });
            }
          }
          cand.sort(function (a, b) { return a.cost - b.cost; });
          for (var c = 0; c < cand.length; c++) {
            if (cand[c].cost > 760) break; // шеттен алыс (слайд ортасы) — әшекейге орын емес
            if (free(cand[c].x, cand[c].y, w, h)) { placed = { x: cand[c].x, y: cand[c].y, w: w, h: h }; break outer; }
          }
        }
      }
      if (!placed) { img.remove(); out.push({ slide: si + 1, placed: false }); return; }
      img.style.cssText += ';position:absolute;left:' + placed.x + 'px;top:' + placed.y + 'px;width:' + placed.w + 'px;height:' + placed.h + 'px;visibility:visible';
      blocks.push(placed);
      out.push({ slide: si + 1, placed: Math.round(placed.x) + ',' + Math.round(placed.y) });
    });
    slide.style.display = prevDisp;
  });
  return out;
}
/* eslint-enable no-var */

module.exports = { pickDecor, decorUri, placeDecor, THEMES };
