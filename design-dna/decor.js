'use strict';
/**
 * Референс PPTX → безендіру қабаты (decor): фон суреті, қайталанатын/безендіру суреттері (жолақ, панель, мәрмәр),
 * векторлық пішіндер (custGeom → SVG path), нүктелер/сызықтар, дөңгелек фото пішіні және әр слайдтың мазмұн аумағы.
 * Принцип: мәтін мен мазмұн көшірілмейді; тек "қағаз" — фон мен безендіру — нақты референстен алынады.
 */
const { firstColor } = require('./pptxDna');
const S = require('./structure');

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
const BUDGET = Number(process.env.DECOR_MAX_BYTES) || 14 * 1024 * 1024;
const num = (v, d = 0) => (v == null || v === '' || Number.isNaN(+v) ? d : +v);
const r4 = (v) => Math.round(v * 10000) / 10000;

function xfrmFull(block, W, H) {
  const m = block.match(/<a:xfrm([^>]*)>\s*<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  if (!m) return null;
  const at = m[1];
  return {
    x: +m[2], y: +m[3], w: +m[4], h: +m[5],
    rot: num((at.match(/rot="(-?\d+)"/) || [])[1]) / 60000,
    fh: /flipH="1"/.test(at), fv: /flipV="1"/.test(at), W, H,
  };
}

function groupRanges(tree) {
  const out = [];
  for (const m of tree.matchAll(/<p:grpSp>[\s\S]*?<\/p:grpSp>/g)) {
    const gp = (m[0].match(/<p:grpSpPr>[\s\S]*?<\/p:grpSpPr>/) || [''])[0];
    const g = gp.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>\s*<a:chOff x="(-?\d+)" y="(-?\d+)"\/>\s*<a:chExt cx="(\d+)" cy="(\d+)"\/>/);
    if (g) out.push({ s: m.index, e: m.index + m[0].length, off: { x: +g[1], y: +g[2] }, ext: { w: +g[3], h: +g[4] }, ch: { x: +g[5], y: +g[6] }, che: { w: +g[7] || 1, h: +g[8] || 1 } });
  }
  return out;
}

function applyGroup(t, g) {
  if (!g) return t;
  const sx = g.ext.w / g.che.w; const sy = g.ext.h / g.che.h;
  return { ...t, x: g.off.x + (t.x - g.ch.x) * sx, y: g.off.y + (t.y - g.ch.y) * sy, w: t.w * sx, h: t.h * sy };
}

function colorOf(frag, resolve) {
  if (!frag) return null;
  const c = resolve(frag);
  if (!c) return null;
  const a = frag.match(/<a:alpha val="(\d+)"/);
  return { c, a: a ? +a[1] / 100000 : 1 };
}

/** custGeom → SVG path (path өлшемі бірлікпен) */
function custPath(sp) {
  const cg = (sp.match(/<a:custGeom>[\s\S]*?<\/a:custGeom>/) || [''])[0];
  if (!cg) return null;
  const parts = []; let vw = 0; let vh = 0;
  for (const pm of cg.matchAll(/<a:path\b([^>]*)>([\s\S]*?)<\/a:path>/g)) {
    const w = num((pm[1].match(/\bw="(\d+)"/) || [])[1]); const h = num((pm[1].match(/\bh="(\d+)"/) || [])[1]);
    vw = Math.max(vw, w); vh = Math.max(vh, h);
    let d = '';
    const re = /<a:(moveTo|lnTo|cubicBezTo|quadBezTo|close)\b[^>]*?(?:\/>|>([\s\S]*?)<\/a:\1>)/g;
    let m;
    while ((m = re.exec(pm[2]))) {
      const pts = [...String(m[2] || '').matchAll(/<a:pt x="(-?\d+)" y="(-?\d+)"\/>/g)].map((p) => p[1] + ' ' + p[2]);
      if (m[1] === 'moveTo' && pts[0]) d += 'M' + pts[0];
      else if (m[1] === 'lnTo' && pts[0]) d += 'L' + pts[0];
      else if (m[1] === 'cubicBezTo' && pts.length >= 3) d += 'C' + pts.slice(0, 3).join(' ');
      else if (m[1] === 'quadBezTo' && pts.length >= 2) d += 'Q' + pts.slice(0, 2).join(' ');
      else if (m[1] === 'close') d += 'Z';
    }
    if (d) parts.push({ d, w, h });
  }
  if (!parts.length) return null;
  if (!vw || !vh) { vw = 100; vh = 100; }
  // әр path өз w/h-мен масштабталады → ортақ vw/vh-ға келтіреміз
  const d = parts.map((p) => (p.w && p.h && (p.w !== vw || p.h !== vh) ? scalePath(p.d, vw / p.w, vh / p.h) : p.d)).join('');
  return { d, vw, vh };
}
function scalePath(d, sx, sy) {
  return d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, a, b) => (+a * sx).toFixed(1) + ' ' + (+b * sy).toFixed(1));
}

function sectionItems(xml, basePath, files, W, H, level, resolve) {
  const out = [];
  if (!xml) return out;
  const tree = (xml.match(/<p:spTree>[\s\S]*<\/p:spTree>/) || [xml])[0];
  const groups = groupRanges(tree);
  const rels = S.relsMap(files.get(basePath.replace(/([^/]+)$/, '_rels/$1') + '.rels'));
  const re = /<p:(pic|sp|cxnSp)[ >][\s\S]*?<\/p:\1>/g;
  let m;
  while ((m = re.exec(tree))) {
    const blk = m[0]; const kind = m[1];
    if (/<p:ph[ />]/.test(blk)) continue;
    const spPr = (blk.match(/<p:spPr[\s\S]*?<\/p:spPr>/) || [''])[0];
    let t = xfrmFull(spPr, W, H);
    if (!t) continue;
    const g = groups.find((gr) => m.index > gr.s && m.index < gr.e);
    t = applyGroup(t, g);
    const geo = { x: r4(t.x / W), y: r4(t.y / H), w: r4(t.w / W), h: r4(t.h / H), rot: t.rot, fh: t.fh, fv: t.fv, level };
    const isLine = kind === 'cxnSp' || /prst="line"/.test(spPr);
    if (isLine ? (geo.w <= 0 && geo.h <= 0) : (geo.w <= 0 || geo.h <= 0)) continue;
    const prst = (spPr.match(/<a:prstGeom prst="(\w+)"/) || [])[1] || null;
    const words = [...blk.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1]).join('').trim();
    if (kind === 'pic') {
      const id = (blk.match(/<a:blip\b[^>]*r:embed="([^"]+)"/) || [])[1];
      const rel = id && rels[id];
      const media = rel && S.resolvePath(basePath, rel.target);
      if (!media) continue;
      const sr = blk.match(/<a:srcRect([^>]*)\/>/);
      const crop = sr ? { l: num((sr[1].match(/\bl="(-?\d+)"/) || [])[1]) / 100000, t: num((sr[1].match(/\bt="(-?\d+)"/) || [])[1]) / 100000, r: num((sr[1].match(/\br="(-?\d+)"/) || [])[1]) / 100000, b: num((sr[1].match(/\bb="(-?\d+)"/) || [])[1]) / 100000 } : null;
      out.push({ t: 'img', media, prst, crop, ...geo });
      continue;
    }
    if (words) continue; // мәтіні бар пішін — мазмұн
    const fillPart = spPr.split(/<a:ln[ >]/)[0];
    const noFill = /<a:noFill\s*\/>/.test(fillPart);
    let fill = null;
    const sf = fillPart.match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/);
    const gf = fillPart.match(/<a:gradFill[\s\S]*?<a:gs [^>]*>([\s\S]*?)<\/a:gs>/);
    if (!noFill) fill = colorOf(sf ? sf[1] : gf ? gf[1] : null, resolve);
    const lnM = spPr.match(/<a:ln\b([^>]*)>([\s\S]*?)<\/a:ln>/);
    const stroke = lnM && !/<a:noFill/.test(lnM[2]) ? colorOf((lnM[2].match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/) || [])[1], resolve) : null;
    const sw = lnM ? Math.max(1, Math.round(num((lnM[1].match(/\bw="(\d+)"/) || [])[1], 12700) * 1920 / W)) : 0;
    if (!fill && !stroke) continue;
    const cp = custPath(blk);
    if (cp) { out.push({ t: 'path', ...cp, fill, stroke, sw, ...geo }); continue; }
    out.push({ t: 'shape', prst: kind === 'cxnSp' ? 'line' : (prst || 'rect'), fill, stroke, sw, ...geo });
  }
  return out;
}

function backgroundOf(xml, basePath, files, resolve) {
  const bg = xml && (xml.match(/<p:bg>([\s\S]*?)<\/p:bg>/) || [])[1];
  if (!bg) return null;
  const id = (bg.match(/<a:blip\b[^>]*r:embed="([^"]+)"/) || [])[1];
  if (id) {
    const rels = S.relsMap(files.get(basePath.replace(/([^/]+)$/, '_rels/$1') + '.rels'));
    const media = rels[id] && S.resolvePath(basePath, rels[id].target);
    if (media) return { media };
  }
  const c = colorOf((bg.match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/) || [])[1], resolve);
  return c ? { color: c.c } : null;
}

const q = (v) => Math.round(v / 0.03);
const shapeKey = (e) => [e.t, e.prst || '', q(e.x), q(e.y), q(e.w), q(e.h)].join('|');

/**
 * files — readZip нәтижесі (files.media бар). Қайтарады { slides:[{bg,items,box,pics}], media:{path:{uri,bytes}}, warnings }.
 */
function extractDecor(files, W, H, ctx) {
  const resolve = (frag) => firstColor(frag, ctx.theme || {}, ctx.clrMap || {});
  const paths = S.orderedSlides(files);
  const n = paths.length;
  const cacheLM = new Map();
  const lmItems = (path, level) => {
    if (!cacheLM.has(path)) cacheLM.set(path, files.has(path) ? sectionItems(files.get(path), path, files, W, H, level, resolve) : []);
    return cacheLM.get(path);
  };

  const raw = paths.map((sp) => {
    const xml = files.get(sp);
    const rels = S.relsMap(files.get(sp.replace('slides/', 'slides/_rels/') + '.rels'));
    const layRel = Object.values(rels).find((r) => r.type === 'slideLayout');
    const layPath = layRel && S.resolvePath(sp, layRel.target);
    let mPath = null;
    if (layPath && files.has(layPath)) {
      const lr = S.relsMap(files.get(layPath.replace('slideLayouts/', 'slideLayouts/_rels/') + '.rels'));
      const mr = Object.values(lr).find((r) => r.type === 'slideMaster');
      mPath = mr && S.resolvePath(layPath, mr.target);
    }
    let bg = backgroundOf(xml, sp, files, resolve);
    if (!bg && layPath) bg = backgroundOf(files.get(layPath), layPath, files, resolve);
    if (!bg && mPath) bg = backgroundOf(files.get(mPath), mPath, files, resolve);
    const items = [
      ...(mPath ? lmItems(mPath, 'master') : []),
      ...(layPath ? lmItems(layPath, 'layout') : []),
      ...sectionItems(xml, sp, files, W, H, 'slide', resolve),
    ];
    return { sp, xml, bg, items };
  });

  // Қолданылу санағы
  const usage = new Map(); const keyUse = new Map(); const posUse = new Map();
  raw.forEach((s) => {
    const seenM = new Set(); const seenK = new Set();
    s.items.filter((i) => i.level === 'slide').forEach((i) => {
      if (i.t === 'img' && !seenM.has(i.media)) { seenM.add(i.media); usage.set(i.media, (usage.get(i.media) || 0) + 1); const pk = i.media + '|' + q(i.x) + '|' + q(i.y) + '|' + q(i.w) + '|' + q(i.h); posUse.set(pk, (posUse.get(pk) || 0) + 1); }
      if (i.t !== 'img') { const k = shapeKey(i); if (!seenK.has(k)) { seenK.add(k); keyUse.set(k, (keyUse.get(k) || 0) + 1); } }
    });
  });
  const recurMin = n >= 3 ? 2 : 99;

  const slides = raw.map((s) => {
    const body = S.elementsOf(s.xml, W, H, 'slide');
    const items = []; const pics = [];
    for (const it of s.items) {
      const area = it.w * it.h;
      if (it.t === 'img') {
        const decor = it.level !== 'slide' || (posUse.get(it.media + '|' + q(it.x) + '|' + q(it.y) + '|' + q(it.w) + '|' + q(it.h)) || 0) >= recurMin;
        if (decor) items.push(it); else pics.push({ x: it.x, y: it.y, w: it.w, h: it.h, shape: it.prst === 'ellipse' ? 'circle' : /round|snip|plaque/i.test(it.prst || '') ? 'round' : null, media: it.media });
        continue;
      }
      if (it.t === 'path') { items.push(it); continue; }
      // prst пішін
      const edge = it.x < 0.02 || it.y < 0.02 || it.x + it.w > 0.98 || it.y + it.h > 0.98;
      const recur = it.level !== 'slide' || (keyUse.get(shapeKey(it)) || 0) >= recurMin;
      const small = area < 0.012;
      if (recur || (edge && area >= 0.03) || it.prst === 'line') items.push(it);
      else if (small && (it.y < 0.14 || it.y > 0.86)) items.push(it);
    }
    // мазмұн аумағы: мәтін/кесте/диаграмма + мазмұн суреттері
    const boxes = body.filter((e) => e.level === 'slide' && e.x != null && ((e.kind === 'text' && e.words > 0) || e.kind === 'table' || e.kind === 'chart' || e.kind === 'frame' || (e.kind === 'group' && e.words > 0))
      && !['sldNum', 'ftr', 'dt'].includes(e.ph) && !(e.words <= 6 && e.y > 0.9))
      .map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));
    const union = (bs) => {
      if (!bs.length) return null;
      const x0 = Math.max(0, Math.min(...bs.map((b) => b.x))); const y0 = Math.max(0, Math.min(...bs.map((b) => b.y)));
      const x1 = Math.min(1, Math.max(...bs.map((b) => b.x + b.w))); const y1 = Math.min(1, Math.max(...bs.map((b) => b.y + b.h)));
      return { x: r4(x0), y: r4(y0), w: r4(x1 - x0), h: r4(y1 - y0) };
    };
    const tbox = union(boxes);
    pics.forEach((p) => boxes.push({ x: p.x, y: p.y, w: p.w, h: p.h }));
    const inkC = {};
    for (const rp of s.xml.matchAll(/<a:rPr[^>]*>([\s\S]*?)<\/a:rPr>/g)) {
      const sf = rp[1].match(/<a:solidFill>([\s\S]*?)<\/a:solidFill>/);
      const c = sf ? resolve(sf[1]) : null; if (c) inkC[c] = (inkC[c] || 0) + 1;
    }
    const inkTop = Object.entries(inkC).sort((a, b) => b[1] - a[1])[0];
    return { bg: s.bg, items, box: union(boxes), tbox, pics, hasText: !!tbox, ink: inkTop ? inkTop[0] : null };
  });

  // Медианы: бюджет
  const warnings = [];
  const used = new Map();
  slides.forEach((s) => {
    if (s.bg && s.bg.media) used.set(s.bg.media, true);
    s.items.forEach((i) => { if (i.t === 'img') used.set(i.media, true); });
  });
  const media = {}; let total = 0;
  [...used.keys()].map((k) => ({ k, buf: files.media && files.media.get(k) })).filter((x) => x.buf).sort((a, b) => a.buf.length - b.buf.length).forEach(({ k, buf }) => {
    if (total + buf.length > BUDGET) { warnings.push('decor_too_big'); return; }
    const ext = (k.match(/\.(\w+)$/) || [])[1];
    media[k] = { uri: 'data:' + (MIME[String(ext).toLowerCase()] || 'image/png') + ';base64,' + buf.toString('base64'), bytes: buf.length };
    total += buf.length;
  });
  // жоқ суреттерді тазалау
  slides.forEach((s) => {
    if (s.bg && s.bg.media && !media[s.bg.media]) s.bg = null;
    s.items = s.items.filter((i) => i.t !== 'img' || media[i.media]);
  });
  return { slides, media, warnings, bytes: total };
}

module.exports = { extractDecor };
