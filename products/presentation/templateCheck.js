'use strict';
/**
 * Толтырудан КЕЙІНГІ геометриялық тексеруші (QA) және түзетуші.
 *
 * Әр мәтіннің слайдтағы НАҚТЫ көрінетін аумағын (глиф қорабы) есептейді:
 * қорап орны + anchor + ішкі өріс + кегль + қатар аралығы + сөз бойынша жол бөлу.
 * Содан тексереді:
 *   • мәтін ↔ мәтін қабаттасуы;
 *   • мәтін ↔ «таблетка»/рамка (ішінде басқа мәтіні бар пішін) қабаттасуы;
 *   • мәтін ↔ сурет/пішін қабаттасуы (шаблонда әуелден болмаса);
 *   • сөз ортасынан бөлінуі (бір сөз қорап енінен кең);
 *   • слайд шетінен шығуы.
 * Ақау болса — мәтінді кішкене жылжытады және/немесе кегльді кішірейтеді (ең аз өзгерісті нұсқа таңдалады).
 * Шаблонда әуелден бар қабаттасу (дизайнер әдейі қойған) ақау саналмайды.
 */
const { scanChildren } = require('../../design-dna/learnReader');
const { tagBlocks, xfrmOf } = require('../../design-dna/structure');
const { opaqueRatio } = require('./pngAlpha');

const PT = 12700;
const GAP = 10;                // pt: мәтін мен көрші арасындағы ең аз ара
const MIN_OV = 3;              // pt: осыдан кіші қиылысу елеусіз
const SEE_THROUGH = 0.2;       // мөлдір емес пиксел үлесі осыдан аз сурет — безендіру (жарқыл, дақ)

let TW = null;
const textWidth = (...a) => { if (!TW) TW = require('./templateFill').textWidthPt; return TW(...a); };

const isSerif = (f) => /serif|times|georgia|cambria|garamond|didot|bodoni|playfair|palatino|cormorant|baskerville|caslon|canela|lora|merriweather|libre|antiqua|roman/i.test(f || '') && !/sans/i.test(f || '');
// Енсіз (condensed) қаріптер Times/Arial өлшемінен әлдеқайда тар — әйтпесе жол санын асыра есептейміз
// (қаріп файлы ендірілмеген жағдайда ғана; ендірілген болса — нақты hmtx өлшемі қолданылады)
const widthFactor = (f) => (/extra.?condensed|ultra.?condensed|compressed/i.test(f || '') ? 0.8 : /condensed|narrow|gothic|bebas|oswald|anton/i.test(f || '') ? 0.88 : 1);

function spTreeInner(xml) {
  const m = String(xml).match(/<p:spTree>([\s\S]*)<\/p:spTree>/);
  return m ? m[1] : '';
}
const textOf = (blk) => [...blk.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('');
const blipIds = (blk) => [...blk.matchAll(/<a:blip [^>]*r:embed="([^"]+)"/g)].map((m) => m[1]);

/** Слайдтағы мөлдір PNG безендірулердің r:embed идентификаторлары. */
function seeThroughIds(files, slidePath, cache = new Map()) {
  const out = new Set();
  const relsPath = slidePath.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels');
  const rels = files.get(relsPath);
  if (typeof rels !== 'string') return out;
  for (const m of rels.matchAll(/<Relationship [^>]*>/g)) {
    const id = (m[0].match(/Id="([^"]+)"/) || [])[1];
    const t = (m[0].match(/Target="([^"]+)"/) || [])[1];
    if (!id || !t || !/\.png$/i.test(t) || /TargetMode="External"/.test(m[0])) continue;
    const p = t.startsWith('/') ? t.slice(1) : 'ppt/' + t.replace(/^\.\.\//, '');
    if (!cache.has(p)) { const b = files.get(p); cache.set(p, Buffer.isBuffer(b) ? opaqueRatio(b) : null); }
    const r = cache.get(p);
    if (r != null && r < SEE_THROUGH) out.add(id);
  }
  return out;
}

/** Мәтіні жоқ, тек мөлдір суреттен тұратын жоғарғы деңгейлі элемент пе. */
function isDecoBlock(blk, ids) {
  if (!ids || !ids.size || textOf(blk).trim()) return false;
  const b = blipIds(blk);
  return b.length > 0 && b.every((id) => ids.has(id));
}

/**
 * Мөлдір безендірулерді толтыру кезінде уақытша жасырады (кедергі деп саналмасын), кейін орнына қайтарады.
 * @returns {{ xml, restore(xml) }}
 */
function hideDeco(xml, ids) {
  const hidden = [];
  if (!ids || !ids.size) return { xml, restore: (x) => x, count: 0 };
  let out = xml;
  for (const k of scanChildren(spTreeInner(xml))) {
    if ((k.tag === 'p:pic' || k.tag === 'p:sp') && isDecoBlock(k.block, ids)) {
      const mark = `<!--dl-deco-${hidden.length}-->`;
      const i = out.indexOf(k.block);
      if (i < 0) continue;
      out = out.slice(0, i) + mark + out.slice(i + k.block.length);
      hidden.push({ mark, block: k.block });
    }
  }
  const restore = (x) => hidden.reduce((acc, h) => acc.replace(h.mark, () => h.block), x);
  return { xml: out, restore, count: hidden.length };
}

// ─── Мәтін пішінін оқу ───────────────────────────────────────────────────
const attr = (s, n) => { const m = (s || '').match(new RegExp(` ${n}="([^"]*)"`)); return m ? m[1] : null; };

function readText(blk) {
  if (!/<p:txBody>/.test(blk)) return null;
  const x = xfrmOf(blk);
  if (!x || !x.w) return null;
  const xf = (blk.match(/<a:xfrm[^>]*>/) || [''])[0];
  const rot = +(attr(xf, 'rot') || 0);
  const bodyPr = (blk.match(/<a:bodyPr[^>]*\/?>/) || [''])[0];
  if (attr(bodyPr, 'vert') && attr(bodyPr, 'vert') !== 'horz') return null;
  const paras = [];
  for (const p of tagBlocks(blk, 'a:p')) {
    const t = textOf(p);
    const rPr = (p.match(/<a:rPr[^>]*\/?>/) || p.match(/<a:endParaRPr[^>]*\/?>/) || [''])[0];
    const pPr = (p.match(/<a:pPr[\s\S]*?(?:<\/a:pPr>|\/>)/) || [''])[0];
    const face = (p.match(/<a:latin [^>]*typeface="([^"]+)"/) || [])[1] || '';
    const sz = (+(attr(rPr, 'sz') || 1800)) / 100;
    const ln = pPr.match(/<a:lnSpc>\s*<a:(spcPts|spcPct) val="(-?\d+)"/);
    const bef = pPr.match(/<a:spcBef>\s*<a:(spcPts|spcPct) val="(-?\d+)"/);
    paras.push({
      text: t, sz, face, bold: /^(1|true)$/.test(attr(rPr, 'b') || '') || /bold|black|heavy/i.test(face),
      italic: /^(1|true)$/.test(attr(rPr, 'i') || '') || /italic|oblique/i.test(face),
      spc: (+(attr(rPr, 'spc') || 0)) / 100,
      lineH: !ln ? sz * 1.2 : ln[1] === 'spcPts' ? +ln[2] / 100 : sz * 1.2 * (+ln[2] / 100000),
      bef: !bef ? 0 : bef[1] === 'spcPts' ? +bef[2] / 100 : sz * (+bef[2] / 100000),
      algn: attr(pPr, 'algn') || 'l',
      marL: (+(attr(pPr, 'marL') || 0)) / PT,
    });
  }
  if (!paras.some((p) => p.text.trim())) return null;
  const ins = (n, d) => (attr(bodyPr, n) != null ? +attr(bodyPr, n) : d) / PT;
  return {
    block: blk, name: (blk.match(/<p:cNvPr [^>]*name="([^"]*)"/) || [])[1] || '',
    box: { x: x.x / PT, y: x.y / PT, w: x.w / PT, h: x.h / PT }, rot,
    anchor: attr(bodyPr, 'anchor') || 't', noWrap: attr(bodyPr, 'wrap') === 'none',
    ins: { l: ins('lIns', 91440), r: ins('rIns', 91440), t: ins('tIns', 45720), b: ins('bIns', 45720) },
    paras,
  };
}

/** Сөз бойынша жол бөлу: [{ w }] + бөлінген сөз бар ма. */
function wrap(p, avail, s, noWrap, metrics) {
  const sz = p.sz * s; const spc = p.spc * s; const k = widthFactor(p.face); const serif = isSerif(p.face);
  const em = metrics && metrics.get(p.face);
  // ірі/көлбеу мәтін: рендерлер арасындағы айырма және көлбеу әріптің «ұшы» үшін қор
  const safety = 1 + (sz >= 30 ? 0.03 : 0) + (p.italic ? 0.03 : 0);
  const W = em ? (str) => em.width(str, sz, spc) * safety : (str) => textWidth(str, sz, serif, p.bold, spc) * k * safety;
  const words = p.text.split(/\s+/).filter(Boolean);
  if (!words.length) return { lines: [0], broken: false };
  if (noWrap) return { lines: [W(p.text)], broken: false };
  const sp = W(' ');
  const lines = []; let cur = -1; let broken = false;
  for (const w of words) {
    const ww = W(w);
    if (ww > avail * 0.94) broken = true;                                   // 6% қор: PowerPoint/LibreOffice/телефон ені әртүрлі
    if (cur < 0) cur = ww;
    else if (cur + sp + ww <= avail) cur += sp + ww;
    else { lines.push(cur); cur = ww; }
  }
  lines.push(cur);
  return { lines, broken };
}

/** Мәтіннің көрінетін аумағы (pt): s — кегль коэфф., dy — тік жылжу. */
function glyphRect(t, s = 1, dy = 0, dx = 0) {
  const avail = Math.max(4, t.box.w - t.ins.l - t.ins.r);
  let h = 0; let maxW = 0; let broken = false; let first = null; let last = null;
  t.paras.forEach((p, i) => {
    const r = wrap(p, Math.max(4, avail - (p.marL || 0)), s, t.noWrap, t.metrics);
    if (r.broken && p.text.trim()) broken = true;
    const lh = p.lineH * s;
    if (i) h += p.bef * s;
    if (!first) first = { lh, sz: p.sz * s };
    last = { lh, sz: p.sz * s, at: h + (r.lines.length - 1) * lh };
    h += r.lines.length * lh;
    for (const w of r.lines) maxW = Math.max(maxW, w);
    if (p.algn === 'just' && r.lines.length > 1) maxW = avail;
  });
  const bx = t.box; const y0 = bx.y + dy;
  const start = t.anchor === 'b' ? y0 + bx.h - t.ins.b - h : t.anchor === 'ctr' ? y0 + (bx.h - h) / 2 : y0 + t.ins.t;
  // таңба үсті/асты: базалық сызық ≈ жол биіктігінің 85%-ы, бас әріп ≈ 0.75·кегль, құйрық ≈ 0.22·кегль
  const top = start + first.lh * 0.85 - first.sz * 0.75;
  const bottom = start + last.at + last.lh * 0.85 + last.sz * 0.22;
  const algn = (t.paras.find((p) => p.text.trim()) || {}).algn || 'l';
  const ax = bx.x + t.ins.l;
  const w = Math.min(maxW, Math.max(avail, maxW));
  const left = (algn === 'ctr' ? ax + (avail - w) / 2 : algn === 'r' ? ax + avail - w : ax) + dx;
  return { x: left, y: top, w, h: Math.max(1, bottom - top), broken };
}

const inter = (a, b) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > MIN_OV && h > MIN_OV ? w * h : 0;
};
const contains = (o, i, tol = 4) => o.x <= i.x + tol && o.y <= i.y + tol && o.x + o.w >= i.x + i.w - tol && o.y + o.h >= i.y + i.h - tol;
const area = (r) => r.w * r.h;
/** Шаблонда әуелден бар әдейі қабаттасу: кішісінің ≥30%-ы жабылған. */
const designed = (a, b) => { const v = inter(a, b); return v > 0 && v >= 0.3 * Math.min(area(a), area(b)); };
/** Қабаттасу үлесі (кішісінің ауданынан). */
const fracOf = (a, b) => { const v = inter(a, b); return v > 0 ? v / Math.max(1, Math.min(area(a), area(b))) : 0; };
/** Кедергіге тию: шаблонда рұқсат етілген үлестен +12%-дан асса ғана. */
const PAD = 5;   // pt: мәтін суретке/пішінге «тиіп» тұрмасын
const padded = (r) => ({ x: r.x - PAD, y: r.y - PAD, w: r.w + 2 * PAD, h: r.h + 2 * PAD });
const hits = (r, ob) => (ob.allow ? inter(r, ob.r) > (ob.allow + 0.12) * Math.min(area(r), area(ob.r)) : inter(r, ob.kind === 'text' || ob.pad === false ? ob.r : padded(ob.r)) > 0);

/** Слайдтың жоғарғы деңгейлі элементтері: мәтіндер және мәтінсіз элементтер (pt). */
function layout(xml, ids) {
  const texts = []; const things = [];
  for (const k of scanChildren(spTreeInner(xml))) {
    if (k.tag === 'p:sp') {
      const t = readText(k.block);
      if (t) { texts.push(t); continue; }
    }
    if (!/^p:(sp|pic|grpSp|graphicFrame|cxnSp)$/.test(k.tag)) continue;
    if (isDecoBlock(k.block, ids)) continue;
    const x = k.tag === 'p:grpSp' ? xfrmOf((k.block.match(/<p:grpSpPr>[\s\S]*?<\/p:grpSpPr>/) || [''])[0]) : xfrmOf(k.block);
    if (!x || !x.w || !x.h) continue;
    things.push({ tag: k.tag, block: k.block, r: { x: x.x / PT, y: x.y / PT, w: x.w / PT, h: x.h / PT } });
  }
  return { texts, things };
}

/** Логотиптің бас әрпі: 1–2 әріп, ≥60pt. */
const isInitial = (t) => { const txt = t.paras.map((p) => p.text).join('').replace(/\s/g, ''); return txt.length <= 2 && Math.max(...t.paras.map((p) => p.sz)) >= 60; };

function scaleBlock(blk, s) {
  if (s === 1) return blk;
  const sc = (v) => String(Math.max(100, Math.round(+v * s)));
  return blk
    .replace(/(<a:(?:rPr|endParaRPr|defRPr)\b[^>]*? sz=")(\d+)(")/g, (m, a, v, c) => a + sc(v) + c)
    .replace(/(<a:(?:rPr|endParaRPr|defRPr)\b[^>]*? spc=")(-?\d+)(")/g, (m, a, v, c) => a + Math.round(+v * s) + c)
    .replace(/(<a:(?:lnSpc|spcBef|spcAft)>\s*<a:spcPts val=")(\d+)(")/g, (m, a, v, c) => a + Math.round(+v * s) + c);
}
function shiftBlock(blk, dyPt, dxPt = 0) {
  if (!dyPt && !dxPt) return blk;
  return blk.replace(/<a:off x="(-?\d+)" y="(-?\d+)"/, (m, x, y) => `<a:off x="${Math.round(+x + dxPt * PT)}" y="${Math.round(+y + dyPt * PT)}"`);
}

/**
 * @param {string} origXml — шаблонның түпнұсқа слайды (әдейі қабаттасуды тану үшін; жоқ болса filled)
 * @param {string} xml — толтырылған слайд
 * @param {{W:number,H:number,ids?:Set}} o — слайд өлшемі (EMU) және мөлдір безендіру id-лері
 * @returns {{ xml, issues: Array<{code, shape, fixed, how?}> }}
 */
function checkSlide(origXml, xml, o = {}) {
  const SW = (o.W || 12192000) / PT; const SH = (o.H || 6858000) / PT;
  const ids = o.ids || new Set();
  const issues = [];
  const metrics = o.metrics || null;
  const pinned = o.pinned || new Set();
  const lay = (x) => { const L = layout(x, ids); for (const t of L.texts) t.metrics = metrics; return L; };
  const orig = lay(origXml || xml);
  const origRect = new Map();
  for (const t of orig.texts) origRect.set(t.name + '|' + Math.round(t.box.x) + '|' + Math.round(t.box.w), glyphRect(t));
  const keyOf = (t) => t.name + '|' + Math.round(t.box.x) + '|' + Math.round(t.box.w);

  let out = xml;
  const gaveUp = new Set();
  for (let pass = 0; pass < 8; pass++) {
    const { texts, things } = lay(out);
    const rects = texts.map((t) => glyphRect(t));
    // «таблетка»: ішінде басқа мәтін тұрған мәтінсіз элемент
    const holders = things.filter((th) => !/<a:blip\b/.test(th.block) && area(th.r) < SW * SH * 0.4 && texts.some((t) => contains(th.r, t.box, 8)));
    const obstaclesFor = (i) => {
      const t = texts[i]; const ob = []; const or = origRect.get(keyOf(t));
      texts.forEach((u, j) => {
        if (j === i) return;
        if (isInitial(u) || isInitial(t)) return;                             // «К|ино» логотипі: әріп пен сөз әдейі жанасады
        const ou = origRect.get(keyOf(u));
        // шаблонда әдейі қабаттасқан болса — сол ДЕҢГЕЙДЕГІ қабаттасуға рұқсат; айтарлықтай көбейсе ақау
        ob.push({ r: rects[j], kind: 'text', j, allow: or && ou ? fracOf(or, ou) : 0 });
      });
      for (const th of things) {
        if (contains(th.r, t.box, 8)) continue;                                  // мәтін осы элементтің ІШІНДЕ (фон/таблетка/карточка)
        if (area(th.r) > SW * SH * 0.45 || (th.r.w > SW * 0.95 && th.r.h > SH * 0.3)) continue;   // фон/жолақ
        const isHolder = holders.includes(th);
        const allow = !isHolder && or ? fracOf(or, th.r) : 0;                   // шаблонда әуелден үстінде тұрған — сол деңгейге дейін рұқсат
        if (allow >= 0.9) continue;                                              // мәтін әдейі суреттің/пішіннің үстінде (толық)
        // шаблонда да осы аралықта тұрса (5pt-тен жақын) — қосымша ара талап етілмейді
        const pad = !(or && inter(or, padded(th.r)) > 0);
        ob.push({ r: th.r, kind: isHolder ? 'holder' : th.tag === 'p:pic' ? 'image' : 'shape', allow, pad });
      }
      return ob;
    };
    const outside = (r) => r.y < -1 || r.y + r.h > SH + 1 || r.x < -1 || r.x + r.w > SW + 1;
    const problemOf = (i, r) => {
      if (r.broken) return { code: 'word_split' };
      if (outside(r)) {
        const or = origRect.get(keyOf(texts[i]));
        if (!(or && outside(or))) return { code: 'off_slide' };                  // шаблонда әуелден шетке шыққан — әдейі
      }
      for (const ob of obstaclesFor(i)) if (hits(r, ob)) return { code: ob.kind === 'text' ? 'text_overlap' : ob.kind === 'holder' ? 'holder_overlap' : 'element_overlap', ob };
      return null;
    };

    let changed = false;
    for (let i = 0; i < texts.length && !changed; i++) {
      const t = texts[i];
      if (isInitial(t)) continue;
      const pr = problemOf(i, rects[i]);
      if (!pr) continue;
      // мәтін↔мәтін: үлкен кегльдісін (тақырыпты) түзетеміз; кішісі таблетка ішінде болса — сөзсіз үлкенін
      let v = i;
      if (pr.code === 'text_overlap') {
        const j = pr.ob.j; const u = texts[j];
        const inHolder = (z) => holders.some((h) => contains(h.r, z.box, 8));
        const szOf = (z) => Math.max(...z.paras.map((p) => p.sz));
        if (inHolder(t) && !inHolder(u)) v = j;
        else if (!(inHolder(u) && !inHolder(t)) && szOf(u) > szOf(t)) v = j;
      }
      // бекітілген (логотип) мәтінді жылжытпаймыз — екіншісін түзетеміз
      if (pinned.has(texts[v].name) && pr.code === 'text_overlap' && !pinned.has(texts[pr.ob.j === v ? i : pr.ob.j].name)) v = pr.ob.j === v ? i : pr.ob.j;
      const T = texts[v];
      if (pinned.has(T.name)) continue;
      if (gaveUp.has(keyOf(T))) continue;
      if (T.rot) { gaveUp.add(keyOf(T)); issues.push({ code: pr.code, shape: T.name, fixed: false }); continue; }
      const maxSz = Math.max(...T.paras.map((p) => p.sz));
      const minS = maxSz >= 30 ? Math.max(0.45, 20 / maxSz) : Math.max(0.7, Math.min(1, 9 / maxSz));
      const best = { cost: Infinity };
      const scales = [];
      for (let k = 1; k > minS + 1e-6; k = Math.round((k - 0.04) * 1000) / 1000) scales.push(k);
      scales.push(minS);                                                          // ең кіші рұқсат етілген кегль де тексеріледі
      for (const s of scales) {
        const base = glyphRect(T, s, 0);
        const obs = obstaclesFor(v);
        const dys = [0]; const dxs = [0];
        let down = 0; let up = 0; let left = 0; let right = 0;
        for (const ob of obs) {
          if (!hits(base, ob)) continue;
          const obMid = ob.r.y + ob.r.h / 2; const myMid = base.y + base.h / 2;
          if (obMid <= myMid) down = Math.max(down, ob.r.y + ob.r.h + GAP - base.y);
          else up = Math.max(up, base.y + base.h - (ob.r.y - GAP));
          const obMidX = ob.r.x + ob.r.w / 2; const myMidX = base.x + base.w / 2;
          if (obMidX >= myMidX) left = Math.max(left, base.x + base.w - (ob.r.x - GAP));
          else right = Math.max(right, ob.r.x + ob.r.w + GAP - base.x);
        }
        if (base.y + base.h > SH - 2) up = Math.max(up, base.y + base.h - (SH - 2));
        if (base.y < 2) down = Math.max(down, 2 - base.y);
        if (down > 0) dys.push(down);
        if (up > 0) dys.push(-up);
        // көлденең: тек шағын жылжу (≤12% ені) және слайд шетінен 3% ішінде қалатындай
        if (left > 0 && left < SW * 0.12 && base.x - left >= SW * 0.03) dxs.push(-left);
        if (right > 0 && right < SW * 0.12 && base.x + base.w + right <= SW * 0.97) dxs.push(right);
        for (const dy of dys) {
          for (const dx of dxs) {
            if (Math.abs(dy) > SH * 0.35) continue;
            const r = glyphRect(T, s, dy, dx);
            if (problemOf(v, r)) continue;                                       // анықтаумен БІРДЕЙ ереже
            const cost = (1 - s) + Math.abs(dy) / SH * 2 + Math.abs(dx) / SW * 2;
            if (cost < best.cost) Object.assign(best, { cost, s, dy, dx });
          }
        }
        if (best.cost <= (1 - s)) break;           // кішірейту бұдан әрі тек қымбаттайды
      }
      if (Number.isFinite(best.cost)) {
        const nb = shiftBlock(scaleBlock(T.block, best.s), best.dy, best.dx || 0);
        out = out.replace(T.block, () => nb);
        issues.push({ code: pr.code, shape: T.name, fixed: true, how: { scale: Math.round(best.s * 100) / 100, dyPt: Math.round(best.dy), dxPt: Math.round(best.dx || 0) } });
        changed = true;
      } else {
        issues.push({ code: pr.code, shape: T.name, fixed: false });
        gaveUp.add(keyOf(T));
      }
    }
    if (!changed) break;
  }
  return { xml: out, issues };
}

module.exports = { checkSlide, hideDeco, seeThroughIds, glyphRect, readText, isDecoBlock, SEE_THROUGH };
