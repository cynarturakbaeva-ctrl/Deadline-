'use strict';
/**
 * Reference PPTX → "Design DNA".
 * PPTX — ішінде XML бар zip, сондықтан дизайнды vision-моделсіз, кодпен тікелей оқимыз (тегін, дәл):
 *   палитра (фон/мәтін/акцент), шрифттер, тығыздық (слайдтағы сөз саны), композиция (сурет қай жақта,
 *   орталықтандыру), бос орын, бұрыштардың дөңгелектігі, кесте/диаграмма үлесі.
 * Принцип: "Copy the design principles, not the pixels".
 * Тәуелсіз: сыртқы пакет керек емес (zip оқуы + regex XML).
 */
const zlib = require('zlib');

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_MEDIA = 8 * 1024 * 1024;

// ─── ZIP оқу ──────────────────────────────────────────────────────────────
function readZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('not a zip');
  if (buf.length > MAX_BYTES) throw new Error('pptx too large');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  files.media = new Map(); // ppt/media/* суреттері (Buffer) — безендіру үшін
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    const isMedia = /^ppt\/media\/[^/]+\.(png|jpe?g|gif|webp|svg)$/i.test(name);
    if (!isMedia && !/\.(xml|rels)$/i.test(name)) continue;
    if (isMedia && csize > MAX_MEDIA) continue;
    const dn = buf.readUInt16LE(lho + 26);
    const de = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + dn + de;
    const raw = buf.subarray(start, start + csize);
    try {
      const data = method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: isMedia ? 16 * 1024 * 1024 : 8 * 1024 * 1024 }) : raw;
      if (isMedia) files.media.set(name, Buffer.from(data)); else files.set(name, data.toString('utf8'));
    } catch { /* зақымдалған бөлікті өткізіп жібереміз */ }
  }
  return files;
}

// ─── Түс көмекшілері ──────────────────────────────────────────────────────
const hex6 = (h) => '#' + String(h).replace('#', '').slice(0, 6).toLowerCase();
function rgb(h) { const n = parseInt(String(h).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lum(h) {
  const [r, g, b] = rgb(h).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function dist(a, b) { const A = rgb(a); const B = rgb(b); return Math.sqrt((A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2); }
function sat(h) { const [r, g, b] = rgb(h); const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; }

function parseTheme(xml) {
  const t = {};
  if (!xml) return t;
  const re = /<a:(dk1|lt1|dk2|lt2|accent[1-6])>\s*<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|sysClr [^>]*?lastClr="([0-9A-Fa-f]{6})")/g;
  let m;
  while ((m = re.exec(xml))) t[m[1]] = hex6(m[2] || m[3]);
  const maj = xml.match(/<a:majorFont>\s*<a:latin typeface="([^"]*)"/);
  const min = xml.match(/<a:minorFont>\s*<a:latin typeface="([^"]*)"/);
  t.majorFont = maj ? maj[1] : null;
  t.minorFont = min ? min[1] : null;
  return t;
}
function parseClrMap(xml) {
  const map = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' };
  const m = (xml || '').match(/<p:clrMap ([^>]*)\/?>/);
  if (m) { const re = /(\w+)="(\w+)"/g; let x; while ((x = re.exec(m[1]))) map[x[1]] = x[2]; }
  return map;
}
/** XML бөліктегі бірінші түсті шешу (srgbClr немесе schemeClr). */
function firstColor(xml, theme, clrMap) {
  if (!xml) return null;
  const m = xml.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"|<a:schemeClr val="(\w+)"/);
  if (!m) return null;
  if (m[1]) return hex6(m[1]);
  const key = clrMap[m[2]] || m[2];
  return theme[key] || null;
}

// ─── Слайдты талдау ───────────────────────────────────────────────────────
function blocksOf(xml, tag) {
  const out = [];
  const re = new RegExp('<p:' + tag + '[ >][\\s\\S]*?</p:' + tag + '>', 'g');
  let m;
  while ((m = re.exec(xml))) out.push(m[0]);
  return out;
}
function xfrmOf(block) {
  const m = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
}
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);

function analyzeSlide(xml, ctx) {
  const { theme, clrMap, W, H } = ctx;
  const area = W * H;
  const s = { words: 0, pics: [], textBoxes: 0, textArea: 0, titleSize: null, bodySizes: [], fills: [], bg: null,
    textColors: [], tables: 0, charts: 0, round: 0, rect: 0, ellipse: 0, algnCtr: 0, algnLeft: 0, fonts: [], shapes: 0 };

  const bgM = xml.match(/<p:bg>([\s\S]*?)<\/p:bg>/);
  if (bgM) { if (/<a:blip\b/.test(bgM[1])) s.bgImage = true; else s.bg = firstColor(bgM[1], theme, clrMap); }

  s.tables = (xml.match(/<a:tbl>/g) || []).length;
  s.charts = (xml.match(/drawingml\/2006\/chart/g) || []).length;

  for (const pic of blocksOf(xml, 'pic')) {
    const x = xfrmOf(pic);
    if (x) s.pics.push(x);
  }
  for (const sp of blocksOf(xml, 'sp')) {
    s.shapes++;
    const x = xfrmOf(sp);
    const spPr = (sp.match(/<p:spPr[\s\S]*?<\/p:spPr>/) || [''])[0];
    const prst = (spPr.match(/prst="(\w+)"/) || [])[1];
    if (prst === 'roundRect') s.round++; else if (prst === 'ellipse') s.ellipse++; else if (prst === 'rect') s.rect++;
    // тегіс түс (фон/акцент плашка)
    const fillM = spPr.match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/);
    const fill = fillM ? firstColor(fillM[1], theme, clrMap) : null;
    const texts = [...sp.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ').trim();
    const words = texts ? texts.split(/\s+/).length : 0;
    if (fill && x) {
      const cover = (x.w * x.h) / area;
      if (cover >= 0.9 && !words) s.bg = s.bg || fill; // бүкіл слайдты жабатын төртбұрыш = фон
      else if (cover > 0.002) s.fills.push({ color: fill, weight: cover });
    }
    if (words) {
      s.words += words;
      s.textBoxes++;
      if (x) s.textArea += (x.w * x.h) / area;
      const isTitle = /<p:ph type="(?:title|ctrTitle)"/.test(sp);
      const sizes = [...sp.matchAll(/ sz="(\d{3,4})"/g)].map((m) => +m[1] / 100);
      if (sizes.length) {
        if (isTitle) s.titleSize = Math.max(s.titleSize || 0, ...sizes);
        else s.bodySizes.push(...sizes);
      }
      s.algnCtr += (sp.match(/algn="ctr"/g) || []).length;
      s.algnLeft += (sp.match(/algn="l"/g) || []).length;
      for (const f of sp.matchAll(/<a:latin typeface="([^"]+)"/g)) s.fonts.push(f[1]);
      for (const rp of sp.matchAll(/<a:rPr([^>]*)>([\s\S]*?)<\/a:rPr>/g)) {
        const z = +((rp[1].match(/\bsz="(\d+)"/) || [])[1] || 0); const f = (rp[2].match(/<a:latin typeface="([^"]+)"/) || [])[1];
        if (z && f) (s.runs || (s.runs = [])).push({ z, f });
      }
      // мәтін түсі (run деңгейінде)
      for (const rp of sp.matchAll(/<a:rPr[^>]*>([\s\S]*?)<\/a:rPr>/g)) {
        const sf = rp[1].match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/);
        const c = sf ? firstColor(sf[1], theme, clrMap) : null;
        if (c) s.textColors.push(c);
      }
      if (sizes.length) s.maxSz = Math.max(s.maxSz || 0, ...sizes);
    }
  }
  if (s.titleSize == null && s.maxSz) { s.titleSize = s.maxSz; s.bodySizes = s.bodySizes.filter((v) => v < s.maxSz); }
  return s;
}

// ─── Негізгі функция ──────────────────────────────────────────────────────
function extractDna(buf) {
  const files = readZip(buf);
  const pres = files.get('ppt/presentation.xml') || '';
  const sz = pres.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  const W = sz ? +sz[1] : 12192000;
  const H = sz ? +sz[2] : 6858000;

  const themeName = [...files.keys()].find((k) => /^ppt\/theme\/theme\d+\.xml$/.test(k));
  const theme = parseTheme(files.get(themeName));
  const masterName = [...files.keys()].find((k) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(k));
  const masterXml = files.get(masterName) || '';
  const clrMap = parseClrMap(masterXml);
  const masterBgM = masterXml.match(/<p:bg>([\s\S]*?)<\/p:bg>/);
  const masterBgImage = !!(masterBgM && /<a:blip\b/.test(masterBgM[1]));
  const masterBg = masterBgM && !masterBgImage ? firstColor(masterBgM[1], theme, clrMap) : null;

  const slideNames = [...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1], 10) - parseInt(b.match(/(\d+)\.xml/)[1], 10));
  if (!slideNames.length) throw new Error('no slides');

  const ctx = { theme, clrMap, W, H };
  const slides = slideNames.map((n) => analyzeSlide(files.get(n), ctx));
  const n = slides.length;

  // Фон: слайдтардағы ең жиі фон → master фоны → тақырыптың lt1
  const bgCount = {};
  slides.forEach((s) => { const b = s.bg || masterBg || theme[clrMap.bg1] || theme.lt1 || '#ffffff'; bgCount[b] = (bgCount[b] || 0) + 1; });
  let bg = Object.entries(bgCount).sort((a, b) => b[1] - a[1])[0][0];
  // Сурет фон: нақты түсті пикселден оқи алмаймыз → мәтін түсінен шығарамыз (қара мәтін = ашық фон)
  const imgBgShare = slides.filter((s) => s.bgImage).length + (masterBgImage ? slides.filter((s) => !s.bg && !s.bgImage).length : 0);
  const imageBg = imgBgShare >= n * 0.5;
  if (imageBg) {
    const rc = {};
    slides.forEach((s) => s.textColors.forEach((c) => { rc[c] = (rc[c] || 0) + 1; }));
    const top = Object.entries(rc).sort((a, b) => b[1] - a[1])[0];
    if (top) bg = lum(top[0]) < 0.4 ? '#f4f4f4' : '#1a1a1a';
    else bg = '#f4f4f4';
  }
  const dark = lum(bg) < 0.25;

  // Мәтін түсі: тақырыптың dk1/lt1 ішінен фонмен контрасы жақсысы
  const cands = [theme[clrMap.tx1], theme.dk1, theme.lt1].filter(Boolean);
  const runC = {};
  slides.forEach((s) => s.textColors.forEach((c) => { runC[c] = (runC[c] || 0) + 1; }));
  const runTop = Object.entries(runC).filter(([c]) => dist(c, bg) > 150).sort((a, b) => b[1] - a[1])[0];
  const text = (runTop && runTop[0]) || cands.sort((a, b) => dist(b, bg) - dist(a, bg))[0] || (dark ? '#f5f5f5' : '#111111');

  // Акцент: ауданы бойынша ең үлкен «түсті» плашка → әйтпесе theme accent1..6 ішіндегі ең қанығы
  const fillW = {};
  slides.forEach((s) => s.fills.forEach((f) => {
    if (dist(f.color, bg) < 45 || dist(f.color, text) < 45) return;
    fillW[f.color] = (fillW[f.color] || 0) + f.weight;
  }));
  let accent = Object.entries(fillW).filter(([c]) => sat(c) > 0.25).sort((a, b) => b[1] - a[1])[0];
  accent = accent ? accent[0] : null;
  if (!accent) {
    const th = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map((k) => theme[k]).filter(Boolean);
    accent = th.filter((c) => dist(c, bg) > 60).sort((a, b) => sat(b) - sat(a))[0] || th[0] || '#1f6fd1';
  }
  const secondary = Object.entries(fillW).filter(([c]) => c !== accent && sat(c) > 0.2 && dist(c, accent) > 60).sort((a, b) => b[1] - a[1])[0];

  // Шрифттер
  const fontCount = {};
  slides.forEach((s) => s.fonts.forEach((f) => { fontCount[f] = (fontCount[f] || 0) + 1; }));
  const usedFonts = Object.entries(fontCount).sort((a, b) => b[1] - a[1]).map(([f]) => f).filter((f) => !/^\+/.test(f));
  const bigFont = {};
  slides.forEach((sl) => { const r = (sl.runs || []).sort((a, b) => b.z - a.z)[0]; if (r && !/^\+/.test(r.f)) bigFont[r.f] = (bigFont[r.f] || 0) + 1; });
  const bigTop = Object.entries(bigFont).sort((a, b) => b[1] - a[1])[0];
  const headingFont = (bigTop && bigTop[0]) || usedFonts[0] || theme.majorFont || null;
  const bodyFont = usedFonts.find((f) => f !== headingFont) || usedFonts[0] || theme.minorFont || headingFont;
  const SERIF = /(georgia|times|garamond|cambria|palatino|baskerville|playfair|merriweather|book antiqua|serif|\blora\b|baskerville|cormorant|crimson|spectral|cinzel|marcellus|bitter|libre caslon|abril|bodoni|didot|prata|domine|vollkorn|eb garamond)/i;
  const MONO = /(mono|consolas|courier|code)/i;
  const tone = SERIF.test(headingFont || '') ? 'editorial' : MONO.test(headingFont || '') ? 'technical' : 'modern';

  // Тығыздық
  const wordsPer = slides.map((s) => s.words);
  const avgWords = avg(wordsPer);
  const densityLevel = avgWords < 28 ? 'minimal' : avgWords < 70 ? 'medium' : 'high';

  // Композиция
  const withPic = slides.filter((s) => s.pics.length).length;
  let left = 0; let right = 0; let full = 0;
  slides.forEach((s) => s.pics.forEach((p) => {
    const cover = (p.w * p.h) / (W * H);
    if (cover > 0.7) full++;
    else if (p.x + p.w / 2 < W / 2) left++;
    else right++;
  }));
  const ctr = slides.reduce((a, s) => a + s.algnCtr, 0);
  const lft = slides.reduce((a, s) => a + s.algnLeft, 0);
  const coverage = slides.map((s) => Math.min(1, s.textArea + s.pics.reduce((a, p) => a + (p.w * p.h) / (W * H), 0)));
  const whitespace = 1 - avg(coverage);
  const shapes = slides.reduce((a, s) => a + s.round + s.rect + s.ellipse, 0);
  const roundShare = shapes ? slides.reduce((a, s) => a + s.round + s.ellipse, 0) / shapes : 0;
  const radius = !shapes ? 'sm' : roundShare > 0.5 ? 'lg' : roundShare > 0.15 ? 'md' : 'sm';

  const titleSizes = slides.map((s) => s.titleSize).filter(Boolean);
  const bodySizes = slides.flatMap((s) => s.bodySizes);

  const dna = {
    slides: n,
    palette: { bg, text, accent, secondary: secondary ? secondary[0] : null, dark },
    fonts: { heading: headingFont, body: bodyFont },
    tone,
    radius,
    density: { avgWords: Math.round(avgWords), maxWords: Math.max(...wordsPer), level: densityLevel },
    typography: { titlePt: median(titleSizes), bodyPt: median(bodySizes) },
    composition: {
      picShare: +(withPic / n).toFixed(2),
      picSide: left > right ? 'left' : right > left ? 'right' : (full ? 'full' : 'none'),
      fullBleedShare: +(full / n).toFixed(2),
      alignment: ctr > lft * 1.3 ? 'centered' : lft > ctr * 1.3 ? 'left' : 'mixed',
      whitespace: +whitespace.toFixed(2),
      tablesPerSlide: +(slides.reduce((a, s) => a + s.tables, 0) / n).toFixed(2),
      chartsPerSlide: +(slides.reduce((a, s) => a + s.charts, 0) / n).toFixed(2),
    },
  };
  dna.summary = describeDna(dna);
  return dna;
}

function describeDna(d) {
  const p = d.palette;
  return [
    `${p.dark ? 'dark' : 'light'} background ${p.bg}, accent ${p.accent}`,
    `${d.tone} typography${d.fonts.heading ? ' (' + d.fonts.heading + ')' : ''}`,
    `${d.density.level} text density (~${d.density.avgWords} words/slide)`,
    `${d.composition.alignment} alignment, whitespace ${Math.round(d.composition.whitespace * 100)}%`,
    d.composition.picShare >= 0.3 ? `images on ${Math.round(d.composition.picShare * 100)}% of slides${d.composition.picSide !== 'none' ? ' (mostly ' + d.composition.picSide + ')' : ''}` : 'few images',
  ].join('; ');
}

/** DNA → біздің дизайн қозғалтқышы қабылдайтын тема. */
function dnaToTheme(dna) {
  return {
    bg: dna.palette.bg,
    text: dna.palette.text,
    accent: dna.palette.accent,
    tone: dna.tone,
    radius: dna.radius,
    deco: 'none', // референс безендіруі қайталанатын элементтер (skin) арқылы беріледі
    maxWordsPerSlide: dna.density.level === 'minimal' ? 28 : dna.density.level === 'medium' ? 60 : 110,
  };
}

module.exports = { firstColor, extractDna, dnaToTheme, readZip, describeDna, parseTheme, parseClrMap };
