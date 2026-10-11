'use strict';
/**
 * PNG суретінің мөлдір ЕМЕС пикселдер үлесі (0..1). Тәуелділіксіз (тек zlib).
 * Шаблондағы «жарқыл», «дақ», жұлынған қағаз шеті сияқты мөлдір безендірулерді
 * мәтінге кедергі (сурет) деп қабылдамау үшін керек.
 * Қолдау: 8-битті RGBA (colorType 6) және GA (4), interlace жоқ. Басқасы → null (белгісіз = тұтас деп саналады).
 */
const zlib = require('zlib');

function opaqueRatio(buf, alphaMin = 128) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 33) return null;
    if (buf.readUInt32BE(0) !== 0x89504e47) return null;
    let pos = 8; let w = 0; let h = 0; let depth = 0; let type = 0; let inter = 0;
    const idat = [];
    while (pos + 8 <= buf.length) {
      const len = buf.readUInt32BE(pos);
      const tag = buf.toString('latin1', pos + 4, pos + 8);
      const data = buf.subarray(pos + 8, pos + 8 + len);
      if (tag === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; inter = data[12]; }
      else if (tag === 'IDAT') idat.push(data);
      else if (tag === 'IEND') break;
      pos += 12 + len;
    }
    if (depth !== 8 || inter !== 0 || (type !== 6 && type !== 4) || !w || !h) return null;
    if (w * h > 40e6) return null;
    const bpp = type === 6 ? 4 : 2;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * bpp;
    if (raw.length < h * (stride + 1)) return null;
    let prev = Buffer.alloc(stride);
    let cur = Buffer.alloc(stride);
    let opaque = 0;
    for (let y = 0; y < h; y++) {
      const f = raw[y * (stride + 1)];
      const off = y * (stride + 1) + 1;
      for (let i = 0; i < stride; i++) {
        const x = raw[off + i];
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v;
        if (f === 0) v = x;
        else if (f === 1) v = x + a;
        else if (f === 2) v = x + b;
        else if (f === 3) v = x + ((a + b) >> 1);
        else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        else return null;
        cur[i] = v & 255;
      }
      for (let i = bpp - 1; i < stride; i += bpp) if (cur[i] >= alphaMin) opaque++;
      const t = prev; prev = cur; cur = t;
    }
    return opaque / (w * h);
  } catch (e) {
    return null;
  }
}

module.exports = { opaqueRatio };
