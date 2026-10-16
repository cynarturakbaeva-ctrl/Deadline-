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
  kazakh: /қазақ|хандық|хандығ|көшпелі|дала|ұлттық|дәстүр|салт|ата-баба|киіз үй|шаңырақ|ою|казах|кочев|степ|юрт|традиц|kazakh|nomad|steppe|yurt|tradition/i,
  music: /домбыра|күй|ән |әндер|музыка|жыр|айтыс|домбр|музык|песн|music|song|folk/i,
  butterfly: /көбелек|жәндік|табиғат|экология|бабочк|насеком|природ|butterfl|insect|nature|ecolog/i,
  bird: /құс|бейбітшілік|еркіндік|птиц|мир |свобод|bird|peace|freedom/i,
  feather: /еркіндік|жеңіл|ақын|поэзия|свобод|поэз|freedom|poetry/i,
  wheat: /ауыл шаруашылығы|егін|бидай|астық|нан|агро|сельск|зерн|пшениц|урожа|agricult|wheat|grain|harvest|farm/i,
  bulb: /идея|инновация|өнертабыс|жаңалық|шығармашылық|идея|инновац|изобрет|творч|idea|innovat|invent|creativ/i,
  typewriter: /журналистика|баспасөз|жазушы|кеңсе|іс қағаз|журналист|пресс|печат|канцеляр|journalis|press|office|writer/i,
  phone: /байланыс|коммуникация|телефон|связ|коммуникац|communicat|telephone/i,
  factory: /зауыт|фабрика|өнеркәсіп|индустрия|завод|промышлен|индустри|factory|industr/i,
  train: /темір жол|көлік|пойыз|логистика|железн|транспорт|поезд|логистик|railway|train|transport|logistic/i,
  heart: /жүрек|қан айналым|кардио|сердц|кровообращ|кардио|heart|cardio/i,
  brain: /ми |миы|нейрон|психология|сана|ойлау|мозг|нейр|психолог|сознан|мышлен|brain|neuro|psycholog|cognit|mind/i,
  skeleton: /анатомия|сүйек|қаңқа|анатом|кост|скелет|anatom|bone|skeleton/i,
  flask: /химия|реакция|зертхана|эксперимент|хими|реакц|лаборатор|эксперимент|chemi|reaction|laborator|experiment/i,
  abacus: /математика|есеп|санау|бухгалтер|статистика|математ|счёт|счет|бухгалт|статист|mathemat|account|arithmet|statistic/i,
  violin: /музыка|оркестр|классикалық|скрипка|музык|оркестр|скрипк|music|orchestr|violin|classical/i,
  handshake: /серіктестік|ынтымақтастық|келісім|әріптес|бірлік|партнер|сотруднич|соглаш|partner|cooperat|agreement|collaborat/i,
  tree: /орман|ағаш|экология|табиғат|тамыр|лес|дерев|эколог|природ|forest|tree|ecolog|nature|roots/i,
  mountain: /тау|шың|алатау|гор|вершин|mountain|peak|alps/i,
  sun: /күн |күн энергиясы|жарық|күн жүйесі|солнц|свет|sun|solar|light/i,
  bee: /ара |еңбек|ұжым|ынтымақ|пчел|труд|коллектив|bee|teamwork|labou?r|hive/i,
  apple: /алма|денсаулық|тамақтану|жеміс|яблок|здоров|питан|фрукт|apple|health|nutrition|fruit/i,
  medicine: /медицина|дәрі|емдеу|фармацевт|аурухана|медицин|лекарств|лечен|фармац|больниц|medic|drug|treatment|pharma|hospital/i,
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

// Композициялық жұп: бірге «бір натюрморт» құрайтын заттар (кітап + қаламұш, карта + компас…)
const PAIRS = {
  book: 'quill', quill: 'book', scroll: 'quill', pen: 'letter', letter: 'quill', typewriter: 'letter',
  map: 'compass', compass: 'map', globe: 'telescope', telescope: 'globe', ship: 'anchor', anchor: 'ship',
  crown: 'coins', coins: 'abacus', abacus: 'coins', scales: 'column', column: 'laurel', laurel: 'column',
  hourglass: 'scroll', clock: 'hourglass', kazakh: 'horse', music: 'kazakh', horse: 'kazakh',
  flask: 'microscope', microscope: 'flask', heart: 'medicine', medicine: 'heart', brain: 'book',
  bulb: 'gears', gears: 'bulb', tree: 'bird', flora: 'butterfly', butterfly: 'flora', wheat: 'sun', sun: 'wheat',
  bee: 'flora', apple: 'flora', owl: 'book', candle: 'book', theater: 'flora', violin: 'flora',
};

/**
 * Слайдқа әшекей ТОБЫ: негізгі зат + (мағынасы сай болса) серігі — мәтіндегі екінші тақырып не композициялық жұбы.
 * @returns {Array<{file:string, tag:string, role:'main'|'pair'}>} бос массив — әшекей жоқ
 */
function pickDecorSet(text, used, seed = 0, max = 2) {
  const main = pickDecor(text, used, seed);
  if (!main) return [];
  const out = [{ ...main, role: 'main' }];
  if (max < 2) return out;
  const idx = index();
  const t = ' ' + String(text || '') + ' ';
  const second = Object.keys(THEMES)
    .filter((tag) => tag !== main.tag && idx[tag] && idx[tag].length && !(used && used.has('tag:' + tag)))
    .map((tag) => ({ tag, n: (t.match(new RegExp(THEMES[tag].source, 'gi')) || []).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)[0];
  const tag = second ? second.tag : PAIRS[main.tag];
  if (tag && idx[tag]) {
    const files = idx[tag].filter((f) => !(used && used.has(f)));
    if (files.length) {
      const file = files[Math.abs(seed + 3) % files.length];
      if (used) { used.add(file); used.add('tag:' + tag); }
      out.push({ file, tag, role: 'pair' });
    }
  }
  return out;
}


// ── Заманауи жүйелер үшін: мағынасына сай ірі жіңішке белгіше (Lucide, ISC) ──
const ICON_THEMES = [
  [/бағдарлама|код|программ|код |software|code|programming|developer/i, ['code-xml', 'braces', 'terminal']],
  [/жасанды интеллект|нейрон|машиналық оқыту|ии |искусственн|нейросет|машинн|artificial intelligence|\bai\b|neural|machine learning/i, ['brain-circuit', 'bot', 'cpu']],
  [/дерек|база|деректер|данн|база данных|data|database|big data/i, ['database', 'chart-scatter', 'server']],
  [/желі|интернет|бұлт|сеть|интернет|облак|network|internet|cloud/i, ['network', 'cloud', 'globe']],
  [/қауіпсіздік|киберқауіп|шифр|безопасн|кибер|шифр|security|cyber|encrypt/i, ['shield-check', 'lock-keyhole', 'fingerprint']],
  [/робот|автоматтандыру|автоматизац|robot|automation/i, ['bot', 'cog', 'workflow']],
  [/инженер|құрылыс|механика|жобалау|инженер|строител|механик|проектир|engineer|construction|mechanic|design/i, ['drafting-compass', 'ruler', 'hard-hat']],
  [/энергия|электр|мұнай|газ|энерг|электр|нефт|energy|electric|oil|gas|power/i, ['zap', 'fuel', 'battery-charging']],
  [/теңіз|кеме|порт|навигация|море|судно|корабл|порт|навигац|sea|ship|maritime|port|navigation/i, ['ship', 'anchor', 'compass']],
  [/ғарыш|спутник|космос|спутник|space|satellite|rocket/i, ['rocket', 'satellite', 'orbit']],
  [/нарық|бәсеке|маркетинг|сату|рынок|конкурен|маркетинг|продаж|market|competit|marketing|sales/i, ['target', 'megaphone', 'chart-pie']],
  [/қаржы|табыс|пайда|инвестиция|бюджет|финанс|доход|прибыл|инвестиц|бюджет|financ|revenue|profit|invest|budget/i, ['trending-up', 'wallet', 'coins']],
  [/бизнес|кәсіпкер|компания|стартап|бизнес|предприним|компани|стартап|business|entrepreneur|company|startup/i, ['briefcase-business', 'rocket', 'building-2']],
  [/менеджмент|басқару|ұйым|команда|менеджмент|управлен|организац|команд|management|leadership|organization|team/i, ['users', 'network', 'layers']],
  [/туризм|саяхат|маршрут|туризм|путешеств|маршрут|tourism|travel|route/i, ['map', 'plane', 'mountain-snow']],
  [/логистика|жеткізу|көлік|логистик|достав|транспорт|logistic|delivery|transport/i, ['truck', 'package', 'route']],
  [/экономика|жіө|инфляция|экономик|ввп|инфляц|econom|gdp|inflation/i, ['chart-line', 'landmark', 'scale']],
  [/статистика|талдау|зерттеу|статист|анализ|исследован|statistic|analys|research/i, ['chart-column', 'search', 'microscope']],
  [/медицина|денсаулық|ауру|медицин|здоров|болезн|medic|health|disease/i, ['heart-pulse', 'stethoscope', 'pill']],
  [/экология|қоршаған орта|климат|эколог|окружающ|климат|ecolog|environment|climate/i, ['leaf', 'sprout', 'recycle']],
  [/білім|оқу|сабақ|университет|образован|обучен|урок|университет|education|learning|university/i, ['graduation-cap', 'book-open', 'school']],
  [/идея|инновация|шешім|идея|инновац|решени|idea|innovation|solution/i, ['lightbulb', 'sparkles', 'puzzle']],
];
const ICON_DIR = path.join(A, 'icons', 'lucide.json');
let LUC = null;
/** Мағынасына сай белгішелер (1–2): [{name}] не бос */
function pickIconDecor(text, used, max = 2) {
  const t = String(text || '');
  if (!LUC) { try { LUC = JSON.parse(fs.readFileSync(ICON_DIR, 'utf8')); } catch { LUC = {}; } }
  const out = [];
  for (const [re, names] of ICON_THEMES) {
    if (!re.test(t)) continue;
    const name = names.find((n) => LUC[n] && !(used && used.has('ic:' + n)));
    if (!name) continue;
    if (used) used.add('ic:' + name);
    out.push({ name, role: out.length ? 'pair' : 'main' });
    if (out.length >= max) break;
  }
  return out;
}
/** Белгіше → data URI (жіңішке сызық, берілген түс) */
function iconUri(name, color, stroke = 1.1) {
  if (!LUC) { try { LUC = JSON.parse(fs.readFileSync(ICON_DIR, 'utf8')); } catch { LUC = {}; } }
  const body = LUC[name];
  if (!body) return '';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="480" height="480" fill="none" stroke="' + color + '" stroke-width="' + stroke + '" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

const cache = new Map();
function decorUri(file) {
  if (cache.has(file)) return cache.get(file);
  let uri = '';
  try { uri = 'data:' + (/\.svg$/i.test(file) ? 'image/svg+xml' : 'image/webp') + ';base64,' + fs.readFileSync(file).toString('base64'); } catch { /* жоқ */ }
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
    blocks.forEach(function (b) { if (b.h < 40 && b.w < 260 && b.y > 960) b.m = 10; }); // бет нөмірі — кішкене шегініс жеткілікті
    var E = slide.querySelector('.cover-frame') ? 110 : 60; // қос жиектемелі мұқабада жиектеменің ішінде
    var mainBox = null;
    [].forEach.call(imgs, function (img) {
      var ar = (img.naturalWidth || 1) / (img.naturalHeight || 1);
      var M = 36; var placed = null;
      var free = function (x, y, w, h) {
        return !blocks.some(function (b) { var m = b.m || M; return x < b.x + b.w + m && x + w + m > b.x && y < b.y + b.h + m && y + h + m > b.y; });
      };
      // жұп: негізгі заттың қасына, сәл қабаттасып, кішірек — бір «натюрморт» болып тұрсын
      if (!full && img.getAttribute('data-decor') === 'pair' && mainBox) {
        var L = Math.max(mainBox.w, mainBox.h) * 0.62; var pw = ar >= 1 ? L : L * ar; var ph = pw / ar;
        var others = blocks.filter(function (b) { return b !== mainBox; });
        var fits = function (x, y) {
          return x >= E - 20 && y >= E - 30 && x + pw <= 1920 - E + 20 && y + ph <= 1080 - E + 30 &&
            !others.some(function (b) { var m = b.m || M; return x < b.x + b.w + m && x + pw + m > b.x && y < b.y + b.h + m && y + ph + m > b.y; });
        };
        var spots = [
          [mainBox.x - pw * 0.72, mainBox.y + mainBox.h - ph], [mainBox.x + mainBox.w - pw * 0.28, mainBox.y + mainBox.h - ph],
          [mainBox.x + mainBox.w * 0.1, mainBox.y - ph * 0.6], [mainBox.x - pw * 0.6, mainBox.y],
        ];
        for (var q = 0; q < spots.length; q++) if (fits(spots[q][0], spots[q][1])) { placed = { x: spots[q][0], y: spots[q][1], w: pw, h: ph }; break; }
      }
      if (!full && !placed) {
        var mx = parseFloat(img.getAttribute('data-max')) || 400;
        var sizes = [400, 340, 280, 220, 170].filter(function (v) { return v <= mx; });
        outer: for (var s = 0; s < sizes.length; s++) {
          var h = sizes[s]; var w = Math.min(h * ar, 560); h = w / ar;
          // бұрыштарға жақын орындар бірінші (оң-төмен → оң-жоғары → сол-төмен → сол-жоғары), сосын шеттер бойымен
          var cand = [];
          for (var gx = 0; gx <= 12; gx++) {
            for (var gy = 0; gy <= 8; gy++) {
              var x = E + (1920 - 2 * E - w) * (gx / 12); var y = E - 10 + (1080 - 2 * E + 20 - h) * (gy / 8);
              var dx = Math.min(x - E, 1920 - E - (x + w)); var dy = Math.min(y - E + 10, 1080 - E + 10 - (y + h));
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
      if (img.getAttribute('data-decor') === 'main') mainBox = placed;
      img.style.cssText += ';position:absolute;left:' + placed.x + 'px;top:' + placed.y + 'px;width:' + placed.w + 'px;height:' + placed.h + 'px;visibility:visible';
      blocks.push(placed);
      out.push({ slide: si + 1, placed: Math.round(placed.x) + ',' + Math.round(placed.y) });
    });
    slide.style.display = prevDisp;
  });
  return out;
}
/* eslint-enable no-var */

module.exports = { pickDecor, pickDecorSet, decorUri, placeDecor, pickIconDecor, iconUri, THEMES, PAIRS };
