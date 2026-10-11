'use strict';
/**
 * Шаблонды «дизайнер көзімен» терең оқу (үйрену жүйесінің 1-қабаты).
 *
 * Не алынады (бәрі слайд ені/биіктігіне шаққанда 0..1, сондықтан әртүрлі өлшемдегі шаблондар салыстырылады):
 *   • шаблон: слайд өлшемі, тақырып түстері мен шрифттері, қолданылған шрифттер мен түстер (рөлімен), типографика сатысы;
 *   • слайд: фон, шеттер, бос орын, мәтін/сурет үлесі, иерархия (тақырып/мәтін қаріп арақатынасы), туралау,
 *     бағандар, қайталанатын элементтер (карточкалар), макет «қолтаңбасы», рөлі мен макет түрі;
 *   • элемент: түрі, орны мен өлшемі, қабаты, бұрылысы, түсі; мәтін болса — рөлі, қаріп өлшемі/түрі/салмағы,
 *     туралау, жол аралығы, әріп аралығы, таңба/сөз/абзац САНЫ; сурет болса — пішіні, кесілуі, векторлығы.
 *
 * Не АЛЫНБАЙДЫ: мәтіннің өзі, суреттер, файл. Мәтін тек рөлін анықтау үшін (сан ба, қысқа белгі ме) уақытша оқылады.
 * Нәтиже JSON-қауіпсіз, сақтауға дайын.
 */

const crypto = require('crypto');
const { readZip, parseTheme, parseClrMap } = require('./pptxDna');
const { orderedSlides, relsMap, resolvePath, analyzeStructure, MAX_REFERENCE_SLIDES } = require('./structure');

const READER_VERSION = 1;
const MAX_ELEMENTS_PER_SLIDE = 80;
const EMU_PER_PT = 12700;

const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const hex = (h) => '#' + String(h).slice(0, 6).toLowerCase();

// ─── XML ағашы ────────────────────────────────────────────────────────────
const CHILD_TAGS = ['p:grpSp', 'p:sp', 'p:pic', 'p:cxnSp', 'p:graphicFrame'];
const OPEN_RE = /<(p:grpSp|p:sp|p:pic|p:cxnSp|p:graphicFrame)(?=[\s>/])/g;

/** Контейнердің ТІКЕЛЕЙ балалары (ішкі топтар бір блок болып қайтады). */
function scanChildren(xml) {
  const out = [];
  OPEN_RE.lastIndex = 0;
  let m;
  while ((m = OPEN_RE.exec(xml))) {
    const tag = m[1];
    const start = m.index;
    const re = new RegExp(`<${tag}(?=[\\s>/])|</${tag}>`, 'g');
    re.lastIndex = start;
    let depth = 0; let end = -1; let t;
    while ((t = re.exec(xml))) {
      if (t[0][1] === '/') { depth -= 1; if (depth === 0) { end = t.index + t[0].length; break; } } else depth += 1;
    }
    if (end < 0) break;
    out.push({ tag, block: xml.slice(start, end) });
    OPEN_RE.lastIndex = end;
  }
  return out;
}

function innerOf(block, tag) {
  const open = block.indexOf('>') + 1;
  const close = block.lastIndexOf(`</${tag}>`);
  return close > open ? block.slice(open, close) : '';
}

/** <a:xfrm> ішіндегі off/ext (+ chOff/chExt топ үшін). */
function readXfrm(part) {
  if (!part) return null;
  const off = part.match(/<a:off x="(-?\d+)" y="(-?\d+)"\s*\/>/);
  const ext = part.match(/<a:ext cx="(\d+)" cy="(\d+)"\s*\/>/);
  if (!off || !ext) return null;
  const chOff = part.match(/<a:chOff x="(-?\d+)" y="(-?\d+)"\s*\/>/);
  const chExt = part.match(/<a:chExt cx="(\d+)" cy="(\d+)"\s*\/>/);
  const rot = part.match(/<a:xfrm[^>]*\srot="(-?\d+)"/);
  return {
    x: +off[1], y: +off[2], w: +ext[1], h: +ext[2],
    chX: chOff ? +chOff[1] : null, chY: chOff ? +chOff[2] : null, chW: chExt ? +chExt[1] : null, chH: chExt ? +chExt[2] : null,
    rot: rot ? +rot[1] / 60000 : 0,
  };
}

const IDENTITY = { sx: 1, sy: 1, tx: 0, ty: 0 };
/** Топ түрлендіруін ата-ана түрлендіруімен біріктіру. */
function composeGroup(T, g) {
  const kx = g.chW ? g.w / g.chW : 1;
  const ky = g.chH ? g.h / g.chH : 1;
  const cx0 = g.chX == null ? g.x : g.chX;
  const cy0 = g.chY == null ? g.y : g.chY;
  return { sx: T.sx * kx, sy: T.sy * ky, tx: T.tx + T.sx * (g.x - cx0 * kx), ty: T.ty + T.sy * (g.y - cy0 * ky) };
}
const applyT = (T, b) => ({ x: T.tx + T.sx * b.x, y: T.ty + T.sy * b.y, w: T.sx * b.w, h: T.sy * b.h });

// ─── Түс пен шрифт ────────────────────────────────────────────────────────
function makeColor(ctx) {
  return (frag) => {
    if (!frag) return null;
    const m = frag.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"|<a:schemeClr val="(\w+)"|<a:sysClr [^>]*lastClr="([0-9A-Fa-f]{6})"/);
    if (!m) return null;
    if (m[1]) return hex(m[1]);
    if (m[3]) return hex(m[3]);
    const key = ctx.clrMap[m[2]] || m[2];
    return ctx.theme[key] || null;
  };
}
/** spPr ішіндегі ТІКЕЛЕЙ толтыру (сызықтың түсін емес). */
function fillOf(spPr, color) {
  if (!spPr) return null;
  const body = spPr.split(/<a:ln[\s>]/)[0]; // <a:lnTo> (custGeom жолы) сызық емес
  if (/<a:noFill\/>/.test(body) && !/<a:solidFill>|<a:gradFill|<a:blipFill/.test(body)) return { type: 'none' };
  if (/<a:blipFill/.test(body)) return { type: 'image', vector: /svgBlip/.test(body) };
  const g = body.match(/<a:gradFill[\s\S]*?<\/a:gradFill>/);
  if (g) return { type: 'gradient', color: color(g[0]) };
  const s = body.match(/<a:solidFill>[\s\S]*?<\/a:solidFill>/);
  if (s) {
    const alpha = s[0].match(/<a:alpha val="(\d+)"/);
    return { type: 'solid', color: color(s[0]), alpha: alpha ? r3(+alpha[1] / 100000) : 1 };
  }
  return null;
}
function lineOf(spPr, color) {
  const m = spPr && spPr.match(/<a:ln(?: [^>]*)?>[\s\S]*?<\/a:ln>|<a:ln [^>]*\/>/);
  if (!m || /<a:noFill\/>/.test(m[0])) return null;
  const w = m[0].match(/<a:ln [^>]*w="(\d+)"/);
  const c = color(m[0]);
  if (!c && !w) return null;
  return { color: c, widthPt: w ? r1(+w[1] / EMU_PER_PT) : null };
}

const SERIF = /times|georgia|garamond|playfair|merriweather|lora|lustria|baskerville|cormorant|pt serif|noto serif|bodoni|didot|dm serif|cambria|book antiqua|palatino|crimson|source serif|spectral|abril|libre caslon|eb garamond|prata|cinzel|old standard|vollkorn|alegreya(?! sans)|zilla|roboto slab|bitter|arvo|rockwell|slab/i;
const SCRIPT = /script|brush|pacifico|dancing|great vibes|allura|sacramento|caveat|lobster|satisfy|parisienne|kaushan|handwrit|amatic|shadows into|indie flower|marck/i;
const DISPLAY = /league gothic|bebas|anton|oswald|impact|alfa slab|bungee|archivo black|fredoka|chewy|righteous|black ops|monoton|bowlby|titan one|luckiest|bangers|staatliches|teko|six caps|fjalla|passion one|squada/i;
const MONO = /mono|courier|consolas|menlo|inconsolata/i;
function fontClass(name) {
  if (!name) return null;
  if (MONO.test(name)) return 'mono';
  if (SCRIPT.test(name)) return 'script';
  if (DISPLAY.test(name)) return 'display';
  if (SERIF.test(name)) return 'serif';
  return 'sans';
}

// ─── Плейсхолдер мұрасы (layout → master) ──────────────────────────────────
function phKeyOf(block) {
  const ph = block.match(/<p:ph(?:\s[^>]*)?\/?>/);
  if (!ph) return null;
  return { type: (ph[0].match(/type="(\w+)"/) || [])[1] || 'body', idx: (ph[0].match(/idx="(\d+)"/) || [])[1] || null };
}
function phIndex(xml) {
  const map = { byIdx: new Map(), byType: new Map() };
  if (!xml) return map;
  const tree = (xml.match(/<p:spTree>[\s\S]*<\/p:spTree>/) || [''])[0];
  for (const { tag, block } of scanChildren(innerOf(tree, 'p:spTree'))) {
    if (tag !== 'p:sp') continue;
    const k = phKeyOf(block);
    if (!k) continue;
    if (k.idx && !map.byIdx.has(k.idx)) map.byIdx.set(k.idx, block);
    if (!map.byType.has(k.type)) map.byType.set(k.type, block);
  }
  return map;
}
const TYPE_ALIAS = { ctrTitle: 'title', subTitle: 'body', obj: 'body' };
function findPh(maps, k) {
  for (const m of maps) {
    if (!m) continue;
    if (k.idx && m.byIdx.has(k.idx)) return m.byIdx.get(k.idx);
    if (m.byType.has(k.type)) return m.byType.get(k.type);
    const alias = TYPE_ALIAS[k.type];
    if (alias && m.byType.has(alias)) return m.byType.get(alias);
  }
  return null;
}

// ─── Мәтін қасиеттері (мазмұнсыз) ──────────────────────────────────────────
function textInfo(block, ctx, inherited) {
  const tx = block.match(/<p:txBody>[\s\S]*?<\/p:txBody>/);
  if (!tx) return null;
  const body = tx[0];
  const runs = [...body.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
  const text = runs.join('').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const paras = [...body.matchAll(/<a:p>[\s\S]*?<\/a:p>|<a:p\s[\s\S]*?<\/a:p>/g)]
    .map((p) => [...p[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('').trim()).filter(Boolean);
  const sizes = [...body.matchAll(/<a:rPr[^>]*\ssz="(\d+)"/g)].map((m) => +m[1] / 100);
  let sizePt = sizes.length ? Math.max(...sizes) : null; let sizeSrc = sizes.length ? 'run' : null;
  if (!sizePt && inherited.sizePt) { sizePt = inherited.sizePt; sizeSrc = 'inherit'; }
  if (!sizePt) { sizePt = 18; sizeSrc = 'default'; }
  const faceRaw = (body.match(/<a:latin typeface="([^"]+)"/) || [])[1] || inherited.face || null;
  const face = faceRaw === '+mj-lt' ? ctx.theme.majorFont : faceRaw === '+mn-lt' ? ctx.theme.minorFont : faceRaw;
  const color = makeColor(ctx)((body.match(/<a:rPr[\s\S]*?<\/a:rPr>/) || [''])[0]) || inherited.color || null;
  const digits = (text.match(/[\d%$€₸.,+\-]/g) || []).length;
  const spc = body.match(/<a:rPr[^>]*\sspc="(-?\d+)"/);
  const lnPct = body.match(/<a:lnSpc>\s*<a:spcPct val="(\d+)"/);
  const lnPts = body.match(/<a:lnSpc>\s*<a:spcPts val="(\d+)"/);
  const bp = (body.match(/<a:bodyPr[^>]*>/) || [''])[0];
  const autofit = /<a:normAutofit/.test(body) ? 'shrink' : /<a:spAutoFit/.test(body) ? 'grow' : 'none';
  const words = text.split(/\s+/).filter(Boolean).length;
  return {
    chars: text.length,
    words,
    paras: paras.length,
    maxParaChars: paras.reduce((m, p) => Math.max(m, p.length), 0),
    numeric: text.length <= 12 && digits / text.length >= 0.5,
    sizePt: r1(sizePt), sizeSrc,
    font: face || null, fontClass: fontClass(face),
    bold: /<a:rPr[^>]*\sb="1"/.test(body) || /bold|black|heavy/i.test(face || ''),
    italic: /<a:rPr[^>]*\si="1"/.test(body),
    caps: /<a:rPr[^>]*\scap="all"/.test(body),
    align: ((body.match(/<a:pPr[^>]*\salgn="(\w+)"/) || [])[1]) || inherited.align || 'l',
    anchor: (bp.match(/anchor="(\w+)"/) || [])[1] || null,
    color,
    letterSpacingPt: spc ? r1(+spc[1] / 100) : 0,
    lineSpacing: lnPct ? r3(+lnPct[1] / 100000) : lnPts && sizePt ? r3((+lnPts[1] / 100) / sizePt) : null,
    bullets: /<a:buChar|<a:buAutoNum/.test(body),
    autofit,
  };
}

function inheritedText(phBlock, ctx, phType) {
  const out = { sizePt: null, face: null, color: null, align: null };
  if (phBlock) {
    const d = phBlock.match(/<a:lvl1pPr[\s\S]*?<\/a:lvl1pPr>/);
    const part = d ? d[0] : phBlock;
    const sz = part.match(/<a:defRPr[^>]*\ssz="(\d+)"/) || phBlock.match(/<a:rPr[^>]*\ssz="(\d+)"/);
    if (sz) out.sizePt = +sz[1] / 100;
    out.face = (part.match(/<a:latin typeface="([^"]+)"/) || [])[1] || null;
    out.align = (part.match(/algn="(\w+)"/) || [])[1] || null;
  }
  if (!out.sizePt && ctx.masterStyles) {
    const st = /title/i.test(phType || '') ? ctx.masterStyles.title : phType ? ctx.masterStyles.body : ctx.masterStyles.other;
    if (st) { out.sizePt = out.sizePt || st.sizePt; out.face = out.face || st.face; out.align = out.align || st.align; }
  }
  if (!out.face) out.face = /title/i.test(phType || '') ? '+mj-lt' : '+mn-lt';
  return out;
}

function masterStyles(masterXml) {
  const read = (tag) => {
    const m = (masterXml || '').match(new RegExp(`<p:${tag}>[\\s\\S]*?<\\/p:${tag}>`));
    if (!m) return null;
    const l1 = (m[0].match(/<a:lvl1pPr[\s\S]*?<\/a:lvl1pPr>/) || [''])[0];
    const sz = l1.match(/<a:defRPr[^>]*\ssz="(\d+)"/);
    return { sizePt: sz ? +sz[1] / 100 : null, face: (l1.match(/<a:latin typeface="([^"]+)"/) || [])[1] || null, align: (l1.match(/algn="(\w+)"/) || [])[1] || null };
  };
  return { title: read('titleStyle'), body: read('bodyStyle'), other: read('otherStyle') };
}

// ─── Элементтерді жинау ────────────────────────────────────────────────────
function shapeGeom(spPr) {
  const p = (spPr || '').match(/<a:prstGeom prst="(\w+)"/);
  if (p) return p[1];
  return /<a:custGeom/.test(spPr || '') ? 'custom' : null;
}
const PIC_SHAPE = (g) => (g === 'ellipse' ? 'circle' : g === 'roundRect' || g === 'round2SameRect' ? 'rounded' : g && g !== 'rect' && g !== 'custom' ? g : 'rect');

function collect(container, T, depth, ctx, out, level) {
  for (const { tag, block } of scanChildren(container)) {
    if (out.length >= MAX_ELEMENTS_PER_SLIDE) return;
    if (tag === 'p:grpSp') {
      const gx = readXfrm((block.match(/<p:grpSpPr>[\s\S]*?<\/p:grpSpPr>/) || [''])[0]);
      const T2 = gx && gx.w && gx.h ? composeGroup(T, gx) : T;
      collect(innerOf(block, 'p:grpSp').replace(/^[\s\S]*?<\/p:grpSpPr>/, ''), T2, depth + 1, ctx, out, level);
      continue;
    }
    const spPr = (block.match(/<p:spPr(?:\s[^>]*)?>[\s\S]*?<\/p:spPr>/) || [''])[0];
    const ph = tag === 'p:sp' ? phKeyOf(block) : null;
    if (level !== 'slide' && ph) continue; // layout/master плейсхолдерлері — бос орын, дизайн емес
    let xf = tag === 'p:graphicFrame'
      ? readXfrm((block.match(/<p:xfrm>[\s\S]*?<\/p:xfrm>/) || [''])[0])
      : readXfrm(spPr);
    let phBlock = null;
    if (ph) {
      phBlock = findPh([ctx.layoutPh, ctx.masterPh], ph);
      if (!xf && phBlock) xf = readXfrm((phBlock.match(/<p:spPr(?:\s[^>]*)?>[\s\S]*?<\/p:spPr>/) || [''])[0]);
    }
    if (!xf) continue;
    const b = applyT(T, xf);
    const box = { x: b.x / ctx.W, y: b.y / ctx.H, w: b.w / ctx.W, h: b.h / ctx.H };
    const area = clamp01(box.w) * clamp01(box.h);
    const color = makeColor(ctx);
    const base = { level, depth, z: out.length, x: r3(box.x), y: r3(box.y), w: r3(box.w), h: r3(box.h), rot: r1(xf.rot) || 0 };

    if (tag === 'p:graphicFrame') {
      const kind = /<a:tbl>/.test(block) ? 'table' : /drawingml\/2006\/chart/.test(block) ? 'chart' : 'frame';
      const el = { ...base, kind };
      if (kind === 'table') {
        el.rows = (block.match(/<a:tr[\s>]/g) || []).length;
        el.cols = (block.match(/<a:gridCol[\s>/]/g) || []).length;
      }
      out.push(el);
      continue;
    }
    if (tag === 'p:cxnSp') {
      const ln = lineOf(spPr, color);
      if (ln) out.push({ ...base, kind: 'line', line: ln });
      continue;
    }
    if (tag === 'p:pic') {
      const g = shapeGeom(spPr);
      out.push({
        ...base, kind: area < 0.02 ? 'icon' : 'pic', shape: PIC_SHAPE(g), cropped: /<a:srcRect\s[^>]*[ltrb]="-?[1-9]/.test(block),
        vector: /svgBlip/.test(block), fullBleed: area >= 0.9,
      });
      continue;
    }
    // p:sp
    const fill = fillOf(spPr, color);
    const ln = lineOf(spPr, color);
    const inh = inheritedText(phBlock, ctx, ph && ph.type);
    const ti = textInfo(block, ctx, inh);
    const g = shapeGeom(spPr);
    if (fill && fill.type === 'image') {
      out.push({ ...base, kind: area < 0.02 ? 'icon' : 'pic', shape: PIC_SHAPE(g), cropped: /<a:srcRect\s[^>]*[ltrb]="-?[1-9]/.test(spPr), vector: !!fill.vector, fullBleed: area >= 0.9 });
      if (!ti) continue;
    }
    if (ti) {
      out.push({ ...base, kind: 'text', ph: ph ? ph.type : null, geom: g, fill: fill && fill.type !== 'none' && fill.type !== 'image' ? fill : null, line: ln, text: ti });
      continue;
    }
    const visible = (fill && fill.type !== 'none') || ln;
    if (!visible) continue;
    if (g === 'line' || (box.h < 0.004 || box.w < 0.004)) { out.push({ ...base, kind: 'line', line: ln || { color: fill && fill.color, widthPt: null } }); continue; }
    out.push({ ...base, kind: 'shape', geom: g, fill: fill && fill.type !== 'none' ? fill : null, line: ln, fullBleed: area >= 0.9 });
  }
}

// ─── Слайд деңгейіндегі есептер ────────────────────────────────────────────
/** Подзаголовок: тақырыптың астында/қасында жалғыз тұрған, денеден үлкен қысқа мәтін. Қатар тұрған бірдей мәтіндер — белгілер. */
function isSubtitle(e, title, pool, bodyRef) {
  if (bodyRef && e.text.sizePt <= bodyRef * 1.15) return false;
  const twins = pool.filter((o) => o !== e && o !== title && Math.abs(o.text.sizePt - e.text.sizePt) < 0.5 && o.text.words <= 25);
  if (twins.length >= 2) return false; // 3+ бірдей мәтін — тізім/белгілер
  const below = e.y >= title.y && e.y - (title.y + title.h) < 0.25;
  return below;
}

function assignTextRoles(els) {
  const texts = els.filter((e) => e.kind === 'text' && e.level === 'slide');
  if (!texts.length) return;
  for (const e of texts) {
    const t = e.text;
    if (['ftr', 'sldNum', 'dt'].includes(e.ph) || (e.y > 0.9 && t.words <= 6 && t.sizeRel < 0.03)) e.role = 'footer';
  }
  const pool = texts.filter((e) => !e.role);
  let title = pool.find((e) => e.ph === 'title' || e.ph === 'ctrTitle');
  if (!title) {
    const cands = pool.filter((e) => e.text.words <= 15 && !e.text.numeric && e.y < 0.65);
    title = cands.sort((a, b) => b.text.sizePt - a.text.sizePt || a.y - b.y)[0] || null;
  }
  if (title) title.role = 'title';
  const bodySizes = pool.filter((e) => e !== title && e.text.words >= 8).map((e) => e.text.sizePt);
  const bodyRef = median(bodySizes);
  for (const e of pool) {
    if (e.role) continue;
    const t = e.text;
    if (t.numeric) e.role = 'number';
    else if (e.ph === 'subTitle') e.role = 'subtitle';
    else if (t.words >= 12 || t.paras >= 2) e.role = 'body';
    else if (title && t.sizePt < title.text.sizePt && t.words <= 25 && isSubtitle(e, title, pool, bodyRef)) e.role = 'subtitle';
    else if (bodyRef && t.sizePt <= bodyRef * 0.75) e.role = 'caption';
    else if (t.words <= 4) e.role = 'label';
    else e.role = 'text';
  }
}

function signatureOf(els) {
  // Қолтаңба — құрылым: кішкене векторлық безендіру (иконка, иллюстрация бұрышта) кірмейді
  const major = els.filter((e) => !e.fullBleed && e.role !== 'footer' && e.w * e.h >= 0.015 && ['text', 'pic', 'shape', 'table', 'chart'].includes(e.kind)
    && !(e.kind === 'pic' && e.vector && e.w * e.h < 0.08));
  const q = (v) => Math.max(0, Math.min(5, Math.floor(clamp01(v) * 6)));
  const letter = (e) => (e.kind === 'text' ? (e.role === 'title' ? 'T' : e.role === 'number' ? 'N' : 'B') : e.kind === 'pic' ? 'P' : e.kind === 'table' ? 'G' : e.kind === 'chart' ? 'C' : 'S');
  return major
    .map((e) => `${letter(e)}${q(e.x)}${q(e.y)}${q(e.x + e.w - 0.001)}${q(e.y + e.h - 0.001)}`)
    .sort()
    .join('.');
}

function repeatsOf(els) {
  const cand = els.filter((e) => !e.fullBleed && e.role !== 'footer' && e.w * e.h >= 0.008 && ['text', 'pic', 'shape'].includes(e.kind) && e.level === 'slide');
  let best = { count: 1, axis: null, kind: null, w: null, h: null };
  for (const a of cand) {
    const same = cand.filter((b) => b.kind === a.kind && Math.abs(b.w - a.w) < 0.03 && Math.abs(b.h - a.h) < 0.03);
    if (same.length < 2 || same.length <= best.count) continue;
    const row = same.every((b) => Math.abs(b.y - a.y) < 0.03);
    const col = same.every((b) => Math.abs(b.x - a.x) < 0.03);
    best = { count: same.length, axis: row ? 'row' : col ? 'column' : 'grid', kind: a.kind, w: a.w, h: a.h };
  }
  return best.count >= 2 ? best : null;
}

function columnsOf(els) {
  const lefts = els.filter((e) => !e.fullBleed && e.role !== 'footer' && e.w * e.h >= 0.01 && ['text', 'pic', 'table', 'chart'].includes(e.kind) && e.w < 0.9
    && !(e.kind === 'pic' && e.vector && e.w * e.h < 0.08))
    .map((e) => e.x).sort((a, b) => a - b);
  let n = 0; let prev = -1;
  for (const x of lefts) { if (x - prev > 0.06) n += 1; prev = x; }
  return n;
}

function slideBackground(slideXml, layoutXml, masterXml, els, color) {
  // Үстіңгі толық экранды элемент (Canva көбіне фонды осылай салады) <p:bg>-ті жабады
  const full = els.filter((e) => e.fullBleed && (e.kind === 'pic' || (e.fill && e.fill.color))).sort((a, b) => b.z - a.z)[0];
  if (full) {
    if (full.kind === 'pic') return { type: 'image', color: null, source: 'element' };
    return { type: full.fill.type, color: full.fill.color, source: 'element' };
  }
  for (const xml of [slideXml, layoutXml, masterXml]) {
    const bg = (xml || '').match(/<p:bg>[\s\S]*?<\/p:bg>/);
    if (!bg) continue;
    if (/<a:blipFill/.test(bg[0])) return { type: 'image', color: null, source: 'bg' };
    if (/<a:gradFill/.test(bg[0])) return { type: 'gradient', color: color(bg[0]), source: 'bg' };
    const c = color(bg[0]);
    if (c) return { type: 'solid', color: c, source: 'bg' };
  }
  return { type: 'default', color: '#ffffff', source: 'default' };
}

function readSlide(path, files, ctx) {
  const xml = files.get(path) || '';
  const rels = relsMap(files.get(path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels')));
  const layoutRel = Object.values(rels).find((r) => r.type === 'slideLayout');
  const layoutPath = layoutRel ? resolvePath(path, layoutRel.target) : null;
  const layoutXml = layoutPath ? files.get(layoutPath) : null;
  const lrels = layoutPath ? relsMap(files.get(layoutPath.replace(/slideLayouts\/(slideLayout\d+\.xml)$/, 'slideLayouts/_rels/$1.rels'))) : {};
  const masterRel = Object.values(lrels).find((r) => r.type === 'slideMaster');
  const masterPath = masterRel ? resolvePath(layoutPath, masterRel.target) : ctx.defaultMasterPath;
  const masterXml = masterPath ? files.get(masterPath) : null;
  const sctx = { ...ctx, layoutPh: phIndex(layoutXml), masterPh: phIndex(masterXml), masterStyles: masterStyles(masterXml), clrMap: parseClrMap(masterXml) };
  const color = makeColor(sctx);

  const els = [];
  const showMaster = !/<p:sld [^>]*showMasterSp="0"/.test(xml);
  const treeOf = (x) => innerOf((String(x || '').match(/<p:spTree>[\s\S]*<\/p:spTree>/) || [''])[0], 'p:spTree');
  if (showMaster && masterXml) collect(treeOf(masterXml), IDENTITY, 0, sctx, els, 'master');
  if (showMaster && layoutXml && !/<p:sldLayout [^>]*showMasterSp="0"/.test(layoutXml)) { /* layout-тың өзі де төменде */ }
  if (layoutXml) collect(treeOf(layoutXml), IDENTITY, 0, sctx, els, 'layout');
  collect(treeOf(xml), IDENTITY, 0, sctx, els, 'slide');
  els.forEach((e, i) => { e.z = i; });

  const Hpt = ctx.H / EMU_PER_PT;
  for (const e of els) if (e.kind === 'text') e.text.sizeRel = r3(e.text.sizePt / Hpt);
  assignTextRoles(els);

  const content = els.filter((e) => !e.fullBleed && e.role !== 'footer' && e.w * e.h >= 0.002);
  const minX = Math.min(...content.map((e) => e.x), 1); const minY = Math.min(...content.map((e) => e.y), 1);
  const maxX = Math.max(...content.map((e) => e.x + e.w), 0); const maxY = Math.max(...content.map((e) => e.y + e.h), 0);
  const areaOf = (k) => clamp01(els.filter((e) => k(e)).reduce((s, e) => s + clamp01(e.w) * clamp01(e.h), 0));
  const texts = els.filter((e) => e.kind === 'text' && e.level === 'slide');
  const title = texts.find((e) => e.role === 'title');
  // Негізгі мәтін өлшемі: абзац бар болса — соның өлшемі, болмаса қысқа мәтін, ең соңында белгілер
  const bodyPool = ['body', 'text', 'label'].map((r) => texts.filter((e) => e.role === r)).find((a) => a.length) || [];
  const bodySize = median(bodyPool.map((e) => e.text.sizeRel));
  const sizes = [...new Set(texts.map((e) => e.text.sizeRel))].sort((a, b) => b - a);
  const sharedLeft = texts.filter((a) => texts.some((b) => b !== a && Math.abs(b.x - a.x) < 0.01)).length;
  const aligns = texts.map((e) => e.text.align);
  const domAlign = ['l', 'ctr', 'r', 'just'].map((a) => [a, aligns.filter((x) => x === a).length]).sort((a, b) => b[1] - a[1])[0];

  return {
    background: slideBackground(xml, layoutXml, masterXml, els, color),
    margins: content.length ? { left: r3(clamp01(minX)), top: r3(clamp01(minY)), right: r3(clamp01(1 - maxX)), bottom: r3(clamp01(1 - maxY)) } : null,
    coverage: {
      text: r3(areaOf((e) => e.kind === 'text' && e.level === 'slide')),
      pic: r3(areaOf((e) => (e.kind === 'pic') && !e.fullBleed)),
      shape: r3(areaOf((e) => e.kind === 'shape' && !e.fullBleed)),
    },
    counts: els.reduce((m, e) => { m[e.kind] = (m[e.kind] || 0) + 1; return m; }, {}),
    textRoles: texts.reduce((m, e) => { m[e.role] = (m[e.role] || 0) + 1; return m; }, {}),
    typography: {
      titleSizeRel: title ? title.text.sizeRel : null,
      bodySizeRel: bodySize,
      hierarchy: title && bodySize ? r1(title.text.sizeRel / bodySize) : null,
      ladder: sizes.slice(0, 6),
    },
    title: title ? { x: title.x, y: title.y, w: title.w, h: title.h, align: title.text.align } : null,
    alignment: { dominant: domAlign && domAlign[1] ? domAlign[0] : null, sharedLeftEdges: sharedLeft },
    columns: columnsOf(els),
    repeat: repeatsOf(els),
    wordCount: texts.reduce((s, e) => s + e.text.words, 0),
    signature: signatureOf(els),
    elements: els,
  };
}

// ─── Шаблон деңгейі ───────────────────────────────────────────────────────
function summarizeTemplate(slides, theme) {
  const fonts = new Map(); const roleFonts = { title: new Map(), body: new Map() };
  const colors = new Map(); const textColors = new Map();
  const inc = (m, k, d = 1) => { if (k) m.set(k, (m.get(k) || 0) + d); };
  for (const s of slides) {
    if (s.background && s.background.color) inc(colors, s.background.color, 1);
    for (const e of s.elements) {
      if (e.kind === 'text') {
        inc(fonts, e.text.font);
        if (e.role === 'title') inc(roleFonts.title, e.text.font); else if (['body', 'text', 'label'].includes(e.role)) inc(roleFonts.body, e.text.font);
        inc(textColors, e.text.color);
      }
      if ((e.kind === 'shape' || e.kind === 'text') && e.fill && e.fill.color && !e.fullBleed) inc(colors, e.fill.color, clamp01(e.w) * clamp01(e.h) * 4);
    }
  }
  const top = (m, n = 6) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, n: r3(v) }));
  const titleFont = top(roleFonts.title, 1)[0];
  const bodyFont = top(roleFonts.body, 1)[0];
  return {
    fonts: top(fonts, 8).map((f) => ({ ...f, cls: fontClass(f.k) })),
    pairing: { title: titleFont ? titleFont.k : null, titleClass: titleFont ? fontClass(titleFont.k) : null, body: bodyFont ? bodyFont.k : null, bodyClass: bodyFont ? fontClass(bodyFont.k) : null },
    fillColors: top(colors, 8),
    textColors: top(textColors, 5),
    themeColors: Object.fromEntries(Object.entries(theme).filter(([k]) => /^(dk|lt|accent)\d$/.test(k))),
    themeFonts: { major: theme.majorFont || null, minor: theme.minorFont || null },
    typography: {
      titleSizeRel: median(slides.map((s) => s.typography.titleSizeRel)),
      bodySizeRel: median(slides.map((s) => s.typography.bodySizeRel)),
      hierarchy: median(slides.map((s) => s.typography.hierarchy)),
    },
    margins: {
      left: median(slides.map((s) => s.margins && s.margins.left)), top: median(slides.map((s) => s.margins && s.margins.top)),
      right: median(slides.map((s) => s.margins && s.margins.right)), bottom: median(slides.map((s) => s.margins && s.margins.bottom)),
    },
    avgWords: Math.round(slides.reduce((a, s) => a + s.wordCount, 0) / Math.max(1, slides.length)),
    picSlides: slides.filter((s) => (s.counts.pic || 0) > 0).length,
    darkBackgrounds: slides.filter((s) => s.background && s.background.color && lumOf(s.background.color) < 0.35).length,
  };
}
function lumOf(h) {
  const n = parseInt(String(h).replace('#', ''), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * @param {Buffer} buf — .pptx
 * @returns {{readerVersion, fingerprint, slide, template, slides}}
 */
function readTemplate(buf) {
  const files = readZip(buf);
  const pres = files.get('ppt/presentation.xml') || '';
  const sz = pres.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  const W = sz ? +sz[1] : 12192000; const H = sz ? +sz[2] : 6858000;
  const themeName = [...files.keys()].find((k) => /^ppt\/theme\/theme\d+\.xml$/.test(k));
  const theme = themeName ? parseTheme(files.get(themeName)) : {};
  const defaultMasterPath = [...files.keys()].find((k) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(k)) || null;
  const ctx = { W, H, theme, clrMap: parseClrMap(defaultMasterPath ? files.get(defaultMasterPath) : ''), defaultMasterPath };

  const order = orderedSlides(files).slice(0, MAX_REFERENCE_SLIDES);
  let st = null;
  try { st = analyzeStructure(files, W, H); } catch { st = null; }
  const slides = order.map((p, i) => {
    const s = readSlide(p, files, ctx);
    const o = st && st.outline && st.outline.slides[i];
    return { index: i + 1, role: o ? o.role : null, archetype: o ? o.archetype : null, ...s };
  });
  return {
    readerVersion: READER_VERSION,
    fingerprint: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16),
    slide: { wIn: r1(W / 914400), hIn: r1(H / 914400), aspect: r3(W / H) },
    template: { slideCount: slides.length, ...summarizeTemplate(slides, theme), recurring: st ? [...new Set((st.recurring || []).map((r) => r.type))] : [] },
    slides,
  };
}

module.exports = { readTemplate, READER_VERSION, fontClass, scanChildren, composeGroup };
