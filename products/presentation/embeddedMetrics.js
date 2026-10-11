'use strict';
/**
 * Шаблонға ендірілген қаріптердің НАҚТЫ әріп ендері (hmtx + cmap).
 * Болжамды коэффициент орнына қаріп файлының өзінен өлшейміз: енсіз (condensed),
 * кең, декоративтік қаріптер — бәрі дәл есептеледі.
 *
 *   const M = embeddedMetrics(files);   // Map<typeface, { width(str, szPt, spcPt) }>
 */

function ttfOf(buf) {
  let fd = buf;
  if (buf.length > 36 && buf.readUInt32LE(0) === buf.length && buf.readUInt16LE(34) === 0x504C) {      // EOT
    const eot = buf.readUInt32LE(0); const size = buf.readUInt32LE(4); const flags = buf.readUInt32LE(12);
    if (flags & 0x4) return null;                                                                       // MTX сығылған
    fd = buf.subarray(eot - size, eot);
    if (flags & 0x10000000) fd = Buffer.from(fd.map((b) => b ^ 0x50));
  }
  return fd;
}

function tables(fd) {
  const n = fd.readUInt16BE(4); const t = {};
  for (let i = 0; i < n; i++) t[fd.toString('latin1', 12 + i * 16, 16 + i * 16)] = fd.readUInt32BE(20 + i * 16);
  return t;
}

/** Қаріп буферінен: { upm, adv(codepoint) → advance (font units) | null }. */
function parseFont(buf) {
  try {
    const fd = ttfOf(buf);
    if (!fd || fd.length < 12) return null;
    const t = tables(fd);
    if (t.head == null || t.hhea == null || t.hmtx == null || t.cmap == null) return null;
    const upm = fd.readUInt16BE(t.head + 18);
    const nH = fd.readUInt16BE(t.hhea + 34);
    const advOfGlyph = (g) => fd.readUInt16BE(t.hmtx + Math.min(g, nH - 1) * 4);
    // cmap: format 12 (толық) немесе format 4 (BMP)
    let f4 = null; let f12 = null;
    const nt = fd.readUInt16BE(t.cmap + 2);
    for (let i = 0; i < nt; i++) {
      const off = t.cmap + fd.readUInt32BE(t.cmap + 4 + i * 8 + 4);
      const fmt = fd.readUInt16BE(off);
      if (fmt === 12 && !f12) f12 = off;
      if (fmt === 4 && !f4) f4 = off;
    }
    const glyphOf = (c) => {
      if (f12 != null) {
        const ng = fd.readUInt32BE(f12 + 12);
        for (let k = 0; k < ng; k++) {
          const st = fd.readUInt32BE(f12 + 16 + k * 12); const e = fd.readUInt32BE(f12 + 20 + k * 12);
          if (c >= st && c <= e) return fd.readUInt32BE(f12 + 24 + k * 12) + (c - st);
        }
        return 0;
      }
      if (f4 != null && c <= 0xffff) {
        const sc = fd.readUInt16BE(f4 + 6) / 2;
        const endO = f4 + 14; const startO = endO + sc * 2 + 2; const deltaO = startO + sc * 2; const rangeO = deltaO + sc * 2;
        for (let k = 0; k < sc; k++) {
          const e = fd.readUInt16BE(endO + k * 2);
          if (c > e) continue;
          const st = fd.readUInt16BE(startO + k * 2);
          if (c < st) return 0;
          const delta = fd.readInt16BE(deltaO + k * 2); const ro = fd.readUInt16BE(rangeO + k * 2);
          if (!ro) return (c + delta) & 0xffff;
          const g = fd.readUInt16BE(rangeO + k * 2 + ro + (c - st) * 2);
          return g ? (g + delta) & 0xffff : 0;
        }
      }
      return 0;
    };
    const cache = new Map();
    const adv = (c) => {
      if (cache.has(c)) return cache.get(c);
      const g = glyphOf(c);
      const v = g ? advOfGlyph(g) : null;
      cache.set(c, v);
      return v;
    };
    if (!upm || !adv(0x41)) return null;
    return { upm, adv };
  } catch (e) {
    return null;
  }
}

/** Ендірілген (regular) қаріптер: Map<typeface, { width(str, szPt, spcPt) }>. */
function embeddedMetrics(files) {
  const out = new Map();
  const pres = files.get('ppt/presentation.xml');
  const relsXml = files.get('ppt/_rels/presentation.xml.rels');
  if (typeof pres !== 'string' || typeof relsXml !== 'string') return out;
  const rels = {};
  for (const m of relsXml.matchAll(/<Relationship [^>]*>/g)) {
    const id = (m[0].match(/Id="([^"]+)"/) || [])[1]; const tg = (m[0].match(/Target="([^"]+)"/) || [])[1];
    if (id && tg) rels[id] = tg;
  }
  for (const m of pres.matchAll(/<p:embeddedFont>([\s\S]*?)<\/p:embeddedFont>/g)) {
    const face = (m[1].match(/<p:font typeface="([^"]+)"/) || [])[1];
    const rid = (m[1].match(/<p:regular r:id="([^"]+)"/) || m[1].match(/<p:(?:bold|italic|boldItalic) r:id="([^"]+)"/) || [])[1];
    const tg = rid && rels[rid];
    const data = tg && files.get(tg.startsWith('/') ? tg.slice(1) : 'ppt/' + tg.replace(/^\.?\//, ''));
    if (!face || !Buffer.isBuffer(data) || out.has(face)) continue;
    const f = parseFont(data);
    if (!f) continue;
    const avgLow = f.adv(0x43e) || f.adv(0x6f) || f.upm * 0.5;      // «о» — белгісіз таңбаға орташа
    out.set(face, {
      width(str, szPt, spcPt = 0) {
        let u = 0; let n = 0;
        for (const ch of String(str)) { n++; const v = f.adv(ch.codePointAt(0)); u += v != null ? v : avgLow; }
        return (u / f.upm) * szPt * 1.02 + spcPt * n;                  // 2% қор (кернинг/рендер айырмасы)
      },
    });
  }
  return out;
}

module.exports = { embeddedMetrics, parseFont, ttfOf };
