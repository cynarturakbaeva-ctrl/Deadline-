'use strict';
/**
 * PPTX құрылымын толық талдау: слайд реті, рөлдері, макет түрлері (архетип), тор, қайталанатын элементтер.
 * Тәуелсіз (zip + regex XML). Нәтиже: { outline, archetypes, grid, recurring, warnings }.
 * Принцип: құрылым мен ережені аламыз, мазмұн мен логотип пиксельдерін емес.
 */

const MAX_REFERENCE_SLIDES = Number(process.env.MAX_REFERENCE_SLIDES) || 25;

const ROLE_RE = [
  ['thanks', /рахмет|спасибо|thank\s*you|назар\s*аудар|внимание/i],
  ['references', /әдебиет|пайдаланылған|дереккөз|источник|литератур|список|references|bibliograph|sources/i],
  ['conclusion', /қорытынды|тұжырым|вывод|заключени|итог|conclusion|summary/i],
  ['agenda', /мазмұн|жоспар|содержани|план\b|agenda|contents|outline/i],
  ['relevance', /өзектілік|актуальн|relevance/i],
  ['goal', /мақсат|цел[ьи]|\bgoals?\b|\baims?\b|objective/i],
  ['tasks', /міндет|задач|\btasks\b/i],
  ['intro', /кіріспе|введени|introduction|\bintro\b/i],
];

const px = (v) => +v.toFixed(3);
const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

function xfrmOf(block) {
  const m = block.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  return m ? { x: +m[1], y: +m[2], w: +m[3], h: +m[4] } : null;
}
function tagBlocks(xml, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '[ >/][\\s\\S]*?</' + tag + '>', 'g');
  let m; while ((m = re.exec(xml))) out.push(m[0]);
  return out;
}
function relsMap(xml) {
  const map = {};
  for (const m of String(xml || '').matchAll(/<Relationship [^>]*>/g)) {
    const id = (m[0].match(/Id="([^"]+)"/) || [])[1];
    const target = (m[0].match(/Target="([^"]+)"/) || [])[1];
    const type = (m[0].match(/Type="[^"]*\/([^"/]+)"/) || [])[1];
    if (id) map[id] = { target, type };
  }
  return map;
}
function resolvePath(base, target) {
  if (!target) return null;
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/'); parts.pop();
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
}

/** Слайд файлдарының НАҚТЫ көрсету реті (sldIdLst), файл атауы бойынша емес */
function orderedSlides(files) {
  const pres = files.get('ppt/presentation.xml') || '';
  const rels = relsMap(files.get('ppt/_rels/presentation.xml.rels'));
  const ids = [...pres.matchAll(/<p:sldId [^>]*r:id="([^"]+)"/g)].map((m) => m[1]);
  const list = ids.map((id) => rels[id] && resolvePath('ppt/presentation.xml', rels[id].target)).filter((p) => p && files.has(p));
  if (list.length) return list;
  return [...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1], 10) - parseInt(b.match(/(\d+)\.xml/)[1], 10));
}

/** Бір XML бөлімнен (slide/layout/master) элементтер тізімі, геометрия 0..1 */
function elementsOf(xml, W, H, level) {
  const els = [];
  const tree = (xml.match(/<p:spTree>[\s\S]*<\/p:spTree>/) || [xml])[0];
  const groups = tagBlocks(tree, 'p:grpSp');
  let rest = tree;
  for (const g of groups) rest = rest.replace(g, '');
  const push = (e) => els.push({ level, ...e });

  for (const g of groups) {
    const x = xfrmOf(g);
    const texts = [...g.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ').trim();
    if (x) push({ kind: 'group', x: x.x / W, y: x.y / H, w: x.w / W, h: x.h / H, words: texts ? texts.split(/\s+/).length : 0, text: texts.slice(0, 120), ph: null, sz: null, fill: null, prst: null, algn: null });
  }
  for (const gf of tagBlocks(rest, 'p:graphicFrame')) {
    const x = xfrmOf(gf) || (gf.match(/<p:xfrm>[\s\S]*?<\/p:xfrm>/) && xfrmOf(gf.match(/<p:xfrm>[\s\S]*?<\/p:xfrm>/)[0]));
    if (!x) continue;
    const kind = /<a:tbl>/.test(gf) ? 'table' : /drawingml\/2006\/chart/.test(gf) ? 'chart' : 'frame';
    const texts = [...gf.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ').trim();
    push({ kind, x: x.x / W, y: x.y / H, w: x.w / W, h: x.h / H, words: texts ? texts.split(/\s+/).length : 0, text: texts.slice(0, 120), ph: null, sz: null, fill: null, prst: null, algn: null });
  }
  for (const pic of tagBlocks(rest, 'p:pic')) {
    const x = xfrmOf(pic); if (!x) continue;
    push({ kind: 'pic', x: x.x / W, y: x.y / H, w: x.w / W, h: x.h / H, words: 0, text: '', ph: (pic.match(/<p:ph [^>]*type="(\w+)"/) || [])[1] || null, sz: null, fill: null, prst: null, algn: null });
  }
  for (const sp of tagBlocks(rest, 'p:sp')) {
    const ph = (sp.match(/<p:ph(?: [^>]*)?\/?>/) || [''])[0];
    const phType = ph ? ((ph.match(/type="(\w+)"/) || [])[1] || 'body') : null;
    const spPr = (sp.match(/<p:spPr[\s\S]*?<\/p:spPr>|<p:spPr\/>/) || [''])[0];
    const x = xfrmOf(spPr) || xfrmOf(sp);
    const texts = [...sp.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ').trim();
    const sizes = [...sp.matchAll(/ sz="(\d{3,4})"/g)].map((m) => +m[1] / 100);
    const fillPart = spPr.split('<a:ln')[0];
    const fillM = fillPart.match(/<a:solidFill>\s*<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|schemeClr val="(\w+)")/);
    const hasFill = !!fillM;
    const algn = (sp.match(/algn="(ctr|l|r|just)"/) || [])[1] || null;
    if (!x && !phType) continue;
    push({
      kind: texts ? 'text' : 'shape',
      x: x ? x.x / W : null, y: x ? x.y / H : null, w: x ? x.w / W : null, h: x ? x.h / H : null,
      words: texts ? texts.split(/\s+/).length : 0, text: texts.slice(0, 160), ph: phType,
      sz: sizes.length ? Math.max(...sizes) : null,
      fill: hasFill ? (fillM[1] ? '#' + fillM[1].toLowerCase() : 'scheme:' + fillM[2]) : null,
      prst: (spPr.match(/prst="(\w+)"/) || [])[1] || null, algn,
    });
  }
  return els;
}

function slideTitle(els) {
  const t = els.find((e) => e.level === 'slide' && (e.ph === 'title' || e.ph === 'ctrTitle') && e.text);
  if (t) return t;
  const texts = els.filter((e) => e.level === 'slide' && e.kind === 'text' && e.words > 0 && e.words <= 18 && e.y != null && e.ph !== 'sldNum' && e.ph !== 'ftr' && e.ph !== 'dt');
  if (!texts.length) return null;
  const top = texts.filter((e) => e.y < 0.35);
  const pool = top.length ? top : texts;
  return pool.sort((a, b) => (b.sz || 0) - (a.sz || 0) || a.y - b.y)[0];
}

function similar(a, b, tol = 0.18) { return Math.abs(a - b) <= tol * Math.max(a, b, 0.01); }

/** placeholder жоқ слайдта тақырып = ең жоғары/үлкен қысқа мәтін: оның сөздерін денеден шегереміз */
function slideTitleWords(texts) {
  const t = [...texts].filter((e) => e.words <= 18).sort((a, b) => (a.y - b.y) || ((b.sz || 0) - (a.sz || 0)))[0];
  return t ? t.words : 0;
}

function classifyArchetype(els, idx, role) {
  const body = els.filter((e) => e.level === 'slide' && !e.recurring && e.x != null);
  const cover = (e) => e.w * e.h;
  if (idx === 0 || role === 'title') return 'title';
  if (body.some((e) => e.kind === 'chart')) return 'chart';
  if (body.some((e) => e.kind === 'table')) return 'table';
  const pics = body.filter((e) => e.kind === 'pic');
  if (pics.some((p) => cover(p) >= 0.65)) return 'full-image';
  const texts = body.filter((e) => e.kind === 'text' && e.words > 0);
  const words = texts.reduce((a, e) => a + e.words, 0);
  if (texts.some((e) => (e.sz || 0) >= 54 && e.words <= 6) && words <= 30) return 'big-number';
  // карточкалар: ұқсас өлшемді ≥3 бояулы блок
  const cards = body.filter((e) => (e.kind === 'shape' || e.kind === 'text' || e.kind === 'group') && e.fill && cover(e) > 0.02 && cover(e) < 0.4);
  const grp = body.filter((e) => e.kind === 'group' && cover(e) > 0.02 && cover(e) < 0.4);
  for (const pool of [cards, grp]) {
    for (const c of pool) {
      const same = pool.filter((o) => similar(o.w, c.w) && similar(o.h, c.h));
      if (same.length >= 3) return 'cards-' + Math.min(6, same.length);
    }
  }
  const big = pics.filter((p) => cover(p) >= 0.07).sort((a, b) => cover(b) - cover(a))[0];
  if (big) {
    const cx = big.x + big.w / 2; const cy = big.y + big.h / 2;
    if (big.w < 0.7 && big.h > 0.5) return cx < 0.5 ? 'text-image-left' : 'text-image-right';
    if (big.w >= 0.7 && big.h < 0.5) return cy < 0.5 ? 'image-strip-top' : 'image-strip-bottom';
    return cx < 0.5 ? 'text-image-left' : 'text-image-right';
  }
  const body2 = texts.filter((e) => e.ph !== 'title' && e.ph !== 'ctrTitle' && e.words >= 6);
  if (body2.length >= 2) {
    const L = body2.filter((e) => e.x + e.w / 2 < 0.5); const R = body2.filter((e) => e.x + e.w / 2 >= 0.5);
    if (L.length && R.length && L.some((l) => R.some((r) => Math.abs(l.y - r.y) < 0.12))) return 'two-column';
  }
  const bodyWords = texts.filter((e) => e.ph !== 'title' && e.ph !== 'ctrTitle').reduce((a, e) => a + e.words, 0) - (texts.some((e) => e.ph === 'title') ? 0 : (texts.length ? (slideTitleWords(texts)) : 0));
  const listy = ['conclusion', 'references', 'agenda', 'goal', 'tasks', 'relevance', 'intro'].includes(role);
  if (bodyWords <= 6 && !listy) return 'statement';
  return 'text';
}

function zoneOf(e) {
  const cx = e.x + e.w / 2; const cy = e.y + e.h / 2;
  const v = cy > 0.8 ? 'bottom' : cy < 0.2 ? 'top' : '';
  const h = cx > 0.8 ? 'right' : cx < 0.2 ? 'left' : '';
  if (v && h) return v + '-' + h;
  return v || h || 'center';
}

/** Негізгі функция: files = readZip(...) нәтижесі, W/H слайд өлшемі (EMU) */
function analyzeStructure(files, W, H) {
  const slidePaths = orderedSlides(files);
  const warnings = [];
  if (!slidePaths.length) throw new Error('no slides');

  const layouts = new Map(); // layoutPath → els
  const slides = slidePaths.map((sp) => {
    const xml = files.get(sp);
    const els = elementsOf(xml, W, H, 'slide');
    const relPath = sp.replace('slides/', 'slides/_rels/') + '.rels';
    const rels = relsMap(files.get(relPath));
    const layRel = Object.values(rels).find((r) => r.type === 'slideLayout');
    const layPath = layRel && resolvePath(sp, layRel.target);
    if (layPath && files.has(layPath)) {
      if (!layouts.has(layPath)) {
        const lx = files.get(layPath);
        let lels = elementsOf(lx, W, H, 'layout').filter((e) => !e.ph && e.x != null);
        const lrels = relsMap(files.get(layPath.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels'));
        const mRel = Object.values(lrels).find((r) => r.type === 'slideMaster');
        const mPath = mRel && resolvePath(layPath, mRel.target);
        if (mPath && files.has(mPath)) lels = lels.concat(elementsOf(files.get(mPath), W, H, 'master').filter((e) => !e.ph && e.x != null));
        layouts.set(layPath, lels);
      }
      layouts.get(layPath).forEach((e) => els.push({ ...e }));
    }
    return { path: sp, els };
  });
  const n = slides.length;

  // ── Қайталанатын элементтер (слайдтар бойынша + layout/master) ──
  const q = (v) => Math.round(v / 0.03);
  const keyOf = (e) => [e.kind === 'text' && /^\d{1,3}$/.test(e.text || '') ? 'num' : e.kind, q(e.x), q(e.y), q(e.w), q(e.h)].join('|');
  const counts = new Map();
  const sample = new Map();
  const considered = n >= 4 ? slides.slice(1) : slides;
  considered.forEach((s) => {
    const seen = new Set();
    s.els.filter((e) => e.x != null && e.level === 'slide' && !['title', 'ctrTitle', 'body', 'subTitle'].includes(e.ph) && !(e.kind === 'text' && e.words > 8)).forEach((e) => {
      const k = keyOf(e); if (seen.has(k)) return; seen.add(k);
      counts.set(k, (counts.get(k) || 0) + 1); if (!sample.has(k)) sample.set(k, e);
    });
  });
  const need = Math.max(2, Math.ceil(considered.length * 0.6));
  const recurKeys = new Set();
  const recurring = [];
  for (const [k, c] of counts) {
    if (c < need) continue;
    recurKeys.add(k);
    const e = sample.get(k);
    const area = e.w * e.h;
    const type = e.kind === 'pic' ? (area < 0.1 ? 'logo' : 'image-band')
      : e.kind === 'text' ? (/^\d{1,3}$/.test(e.text || '') || e.ph === 'sldNum' ? 'slide-number' : 'footer-text')
        : (e.w > 0.6 && e.h < 0.12 ? 'bar' : e.h > 0.6 && e.w < 0.12 ? 'side-bar' : 'accent-shape');
    recurring.push({ key: k, type, zone: zoneOf(e), x: px(e.x), y: px(e.y), w: px(e.w), h: px(e.h), fill: e.fill, share: +(c / considered.length).toFixed(2) });
  }
  // layout/master деңгейіндегі логотип/жолақтар да қайталанатын болып саналады
  slides[0].els.filter((e) => e.level !== 'slide' && e.x != null).forEach((e) => {
    const k = keyOf(e);
    if (recurKeys.has(k)) return;
    recurKeys.add(k);
    const area = e.w * e.h;
    recurring.push({ key: k, type: e.kind === 'pic' ? (area < 0.1 ? 'logo' : 'image-band') : (e.w > 0.6 && e.h < 0.12 ? 'bar' : 'accent-shape'), zone: zoneOf(e), x: px(e.x), y: px(e.y), w: px(e.w), h: px(e.h), fill: e.fill, share: 1, from: e.level });
  });
  slides.forEach((s) => s.els.forEach((e) => { if (e.x != null && recurKeys.has(keyOf(e))) e.recurring = true; }));
  // әр қайталанатын элемент қай слайдтарда нақты бар (0-based)
  recurring.forEach((r) => { r.present = slides.map((s, i) => (s.els.some((e) => e.x != null && keyOf(e) === r.key) ? i : -1)).filter((i) => i >= 0); });

  // ── Рөлдер, тақырыптар, архетиптер ──
  const outlineSlides = slides.map((s, i) => {
    const t = slideTitle(s.els);
    const title = t ? t.text.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
    let role = null;
    if (i === 0) role = 'title';
    else {
      const hit = ROLE_RE.find(([, re]) => re.test(title));
      if (hit) role = hit[0];
    }
    const arche = classifyArchetype(s.els, i, role);
    const words = s.els.filter((e) => e.level === 'slide' && !e.recurring).reduce((a, e) => a + (e.words || 0), 0);
    if (!role) role = arche === 'statement' && words <= 8 ? 'section' : 'content';
    let cardFill = null; let cardH = null;
    if (/^cards-/.test(arche)) {
      const c = s.els.find((e) => e.level === 'slide' && !e.recurring && e.fill && e.w * e.h > 0.02 && e.w * e.h < 0.4);
      cardFill = c ? c.fill : null;
      cardH = c ? c.h : null;
    }
    return { n: i + 1, role, title, archetype: arche, words, cardFill, cardH };
  });

  const imageOnly = slides.filter((s) => {
    const body = s.els.filter((e) => e.level === 'slide');
    return body.some((e) => e.kind === 'pic' && e.w * e.h >= 0.85) && !body.some((e) => e.words > 0);
  }).length;
  if (imageOnly >= Math.ceil(n / 2)) warnings.push('image_only');
  if (outlineSlides.filter((s) => s.title).length < n * 0.5) warnings.push('few_titles');
  if (n > MAX_REFERENCE_SLIDES) warnings.push('too_large');

  // ── Архетиптер үлесі ──
  const aCount = {};
  outlineSlides.forEach((s) => { aCount[s.archetype] = (aCount[s.archetype] || 0) + 1; });
  const archetypes = Object.entries(aCount).map(([id, count]) => ({ id, count, share: +(count / n).toFixed(2) })).sort((a, b) => b.count - a.count);

  // ── Тор: жиектер және тақырып аумағы ──
  const content = slides.slice(1).flatMap((s) => s.els.filter((e) => e.level === 'slide' && !e.recurring && e.kind === 'text' && e.x != null && e.words > 0));
  const lefts = content.map((e) => e.x); const rights = content.map((e) => 1 - (e.x + e.w)); const bottoms = content.map((e) => 1 - (e.y + e.h));
  const titleEls = slides.slice(1).map((s) => slideTitle(s.els)).filter((e) => e && e.x != null);
  const grid = {
    marginX: lefts.length ? px(Math.max(0, median(lefts))) : null,
    marginRight: rights.length ? px(Math.max(0, median(rights))) : null,
    marginBottom: bottoms.length ? px(Math.max(0, median(bottoms))) : null,
    titleBox: titleEls.length ? { x: px(median(titleEls.map((e) => e.x))), y: px(median(titleEls.map((e) => e.y))), w: px(median(titleEls.map((e) => e.w))), h: px(median(titleEls.map((e) => e.h))) } : null,
    titleTop: !!(titleEls.length >= 2 && median(titleEls.map((e) => e.y)) < 0.2 && median(titleEls.map((e) => e.w)) > 0.5),
    bodyAlign: (() => { const b = content.filter((e) => e.words >= 12 && e.algn); const j = b.filter((e) => e.algn === 'just').length; const c = b.filter((e) => e.algn === 'ctr').length; return b.length && j > b.length / 2 ? 'justify' : b.length && c > b.length / 2 ? 'center' : 'left'; })(),
    titleAlign: (() => { const a = titleEls.map((e) => e.algn || 'l'); const c = a.filter((x) => x === 'ctr').length; return c > a.length / 2 ? 'center' : 'left'; })(),
  };

  return {
    outline: { slideCount: n, slides: outlineSlides, roles: outlineSlides.map((s) => s.role) },
    archetypes, recurring, grid, warnings,
  };
}

module.exports = { analyzeStructure, orderedSlides, MAX_REFERENCE_SLIDES, ROLE_RE, relsMap, resolvePath, tagBlocks, xfrmOf, elementsOf, slideTitle };
