'use strict';
/**
 * Шаблон қаріптерінің СТИЛІ: script (қолжазба/каллиграфия) | serif | sans | display (тар/плакаттық) | mono.
 *
 * Дереккөз (сенімділік ретімен):
 *   1) шаблонға ендірілген қаріп файлының OS/2 кестесі: PANOSE (bFamilyType, bSerifStyle), sFamilyClass,
 *      usWeightClass, usWidthClass, fsSelection (italic) + «о/н» әріптерінің нақты ені (тарлық);
 *   2) қаріп атауы (Canva PANOSE-ты көбіне нөлмен жазады, ендірілмеген қаріптер де болады).
 * Бұл қазақ әріптері жоқ қаріптің орнына стилі ұқсас қаріп таңдау және «сәндік жазу сөзін» тану үшін керек.
 */
const { ttfOf } = require('./embeddedMetrics');

const SCRIPT_RE = /script|vibes|ballet|hand|signat|brush|callig|allura|pacifico|dancing|satisfy|parisienne|sacramento|tangerine|pinyon|italianno|marck|herr von|monsieur|mrs |petit formal|rouge|allison|birthstone|alex brush|great vibes|lobster|kaushan|yellowtail|cookie|meddon|qwigley|whisper|mea culpa|ephesis|corinthia|lovers|windsong|imperial|bilbo|caveat|amatic|shadows into|indie flower|gloria|homemade|nothing you could|reenie|rock salt|sue ellen|mr dafoe|mr de haviland|halimun|playball|clicker|euphoria|engagement|seaweed|style script|fleur|grand hotel|norican|niconne|aguafina|arizonia|bad script|berkshire|calligraffitti|cedarville|charm|cherish|comforter|dawning|felipa|fondamento|griffy|kristi|la belle aurore|league script|love light|loved by|miss fajardose|montez|moon dance|mrs saint|my soul|neonderthaw|oooh baby|princess sofia|puppies|quintessential|ruthie|sevillana|smooch|stalemate|sunshiney|the nautigal|tillana|twinkle star|vujahday|waterfall|yesteryear|zeyada|bonheur|gwendolyn|island moments|licorice|ballerina|beautique|dream avenue|moontime|signerica|thesignature|ambassador|amsterdam|autography|brittany|glacial/i;
const DISPLAY_RE = /gothic|bebas|oswald|anton|league|display|poster|headline|impact|condensed|compressed|narrow|archivo black|bungee|staatliches|fjalla|teko|six caps|abril|alfa slab|bowlby|ultra|black ops|chango|dela gothic|passion one|paytone|righteous|russo|squada|monoton|lilita|titan|luckiest|bangers|boogaloo|sensei|agrandir|canva sans display|garet heavy|horizon|kollektif|more sugar|now|glacial|codec|coco gothic/i;
const SERIF_RE = /serif|times|georgia|garamond|didot|bodoni|playfair|palatino|cormorant|baskerville|caslon|canela|lora|merriweather|libre|antiqua|roman|lustria|zilla|slab|cambria|caladea|bitter|crimson|prata|spectral|vollkorn|marcellus|cinzel|trajan|noto serif|pt serif|source serif|ibm plex serif|eb |dm serif|gilda|yeseva|rufina|alice|abhaya|domine|frank ruhl|literata|newsreader|fraunces|young serif|bona nova|cardo|gentium|old standard|sorts mill|glacial/i;
const MONO_RE = /mono|courier|consolas|code|typewriter/i;

/** OS/2 кестесінен және ендерден стиль. */
function styleFromFile(buf) {
  try {
    const fd = ttfOf(buf);
    if (!fd || fd.length < 12) return null;
    const n = fd.readUInt16BE(4); const t = {};
    for (let i = 0; i < n; i++) t[fd.toString('latin1', 12 + i * 16, 16 + i * 16)] = fd.readUInt32BE(20 + i * 16);
    if (t['OS/2'] == null) return null;
    const o = t['OS/2'];
    const weight = fd.readUInt16BE(o + 4);
    const width = fd.readUInt16BE(o + 6);
    const famClass = fd.readInt16BE(o + 30) >> 8;
    const panose = [...fd.subarray(o + 32, o + 42)];
    const fsSel = fd.readUInt16BE(o + 62);
    return { weight, width, famClass, panose, italic: !!(fsSel & 1) };
  } catch (e) {
    return null;
  }
}

/**
 * @param {string} face — typeface атауы
 * @param {object|null} file — styleFromFile нәтижесі (ендірілген болса)
 * @param {{width:Function}|null} metrics — embeddedMetrics жазбасы (тарлықты өлшеу үшін)
 */
function classifyFace(face, file, metrics) {
  const name = String(face || '');
  let cls = null;
  const p = file && file.panose;
  if (p && p[0] === 3) cls = 'script';
  else if (file && file.famClass === 10) cls = 'script';
  else if (SCRIPT_RE.test(name)) cls = 'script';
  else if (MONO_RE.test(name) || (p && p[0] === 2 && p[3] === 9)) cls = 'mono';
  else if (p && p[0] === 4) cls = 'display';
  else if (p && p[0] === 2 && p[1] >= 2 && p[1] <= 10) cls = 'serif';
  else if (p && p[0] === 2 && p[1] >= 11) cls = 'sans';
  else if (file && file.famClass >= 1 && file.famClass <= 7) cls = 'serif';
  else if (file && file.famClass === 8) cls = 'sans';
  else if (DISPLAY_RE.test(name)) cls = 'display';
  else if (SERIF_RE.test(name) && !/sans/i.test(name)) cls = 'serif';
  else cls = 'sans';
  // тарлық: «нонна» сөзінің ені / кегль — Arial ≈ 2.8, тар қаріптер < 2.2
  let narrow = false;
  if (metrics) {
    const w = metrics.width('nonna', 100, 0) / 100;
    if (w > 0 && w < 2.25) narrow = true;
  } else if (file && file.width && file.width <= 3) narrow = true;
  if (narrow && cls === 'sans') cls = 'display';
  const weight = (file && file.weight) || (/black|heavy/i.test(name) ? 900 : /extra.?bold/i.test(name) ? 800 : /bold/i.test(name) ? 700 : /semi.?bold|demi/i.test(name) ? 600 : /medium/i.test(name) ? 500 : /extra.?light|thin|hairline/i.test(name) ? 200 : /light/i.test(name) ? 300 : 400);
  const italic = !!((file && file.italic) || /italic|oblique/i.test(name));
  return { cls, weight, italic, narrow };
}

/** Шаблонның барлық қаріптері: Map<typeface, {cls, weight, italic, narrow}>. Ендірілмеген қаріп — атауы бойынша. */
function templateFontStyles(files, metrics) {
  const out = new Map();
  const pres = files.get('ppt/presentation.xml');
  const relsXml = files.get('ppt/_rels/presentation.xml.rels');
  const rels = {};
  if (typeof relsXml === 'string') {
    for (const m of relsXml.matchAll(/<Relationship [^>]*>/g)) {
      const id = (m[0].match(/Id="([^"]+)"/) || [])[1]; const tg = (m[0].match(/Target="([^"]+)"/) || [])[1];
      if (id && tg) rels[id] = tg;
    }
  }
  if (typeof pres === 'string') {
    for (const m of pres.matchAll(/<p:embeddedFont>([\s\S]*?)<\/p:embeddedFont>/g)) {
      const face = (m[1].match(/<p:font typeface="([^"]+)"/) || [])[1];
      const rid = (m[1].match(/<p:(?:regular|bold|italic|boldItalic) r:id="([^"]+)"/) || [])[1];
      const tg = rid && rels[rid];
      const data = tg && files.get(tg.startsWith('/') ? tg.slice(1) : 'ppt/' + tg.replace(/^\.?\//, ''));
      if (!face || out.has(face)) continue;
      out.set(face, classifyFace(face, Buffer.isBuffer(data) ? styleFromFile(data) : null, metrics && metrics.get(face)));
    }
  }
  return out;
}

/** Атауы бойынша стиль (кэшпен): ендірілмеген қаріптер үшін. */
function styleOf(styles, face) {
  if (!face) return { cls: 'sans', weight: 400, italic: false, narrow: false };
  if (styles && styles.has(face)) return styles.get(face);
  const s = classifyFace(face, null, null);
  if (styles) styles.set(face, s);
  return s;
}

module.exports = { classifyFace, styleFromFile, templateFontStyles, styleOf, SCRIPT_RE };
