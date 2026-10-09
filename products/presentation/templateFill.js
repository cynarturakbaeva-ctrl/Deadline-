'use strict';
/**
 * Template-Fill (Mode 3 — Template → Content).
 *
 * ҚАҒИДА: пайдаланушының дайын шаблонын (PPTX) МҮЛДЕМ ӨЗГЕРТПЕЙ, тек ішіндегі
 * мәтінді жаңа тақырыптың мәтінімен ауыстырамыз. Фон, суреттер, пішіндер, түстер,
 * шрифттер, макеттер — бәрі бастапқы қалпында қалады (адам қолмен мәтін ауыстырғандай).
 *
 * Жұмыс істеу жолы:
 *   1) PPTX (zip) толық оқылады (барлық файлдар, media қоса).
 *   2) Әр слайдтағы мәтін пішіндері ретімен табылады (жоғарыдан төмен).
 *   3) Бірінші мәтін пішіні = тақырып, қалғандары = дене (subtitle/bullets бөлінеді).
 *   4) Әр пішіннің ішіндегі <a:p> абзацтары жаңа жолдармен ауыстырылады,
 *      бірақ бірінші абзацтың <a:pPr>/<a:rPr> (шрифт, өлшем, түс, әріп аралығы) сақталады.
 *   5) Өзгертілген zip қайта жиналады → дайын PPTX.
 */

const zlib = require('zlib');
const { makeZip } = require('../referat/zipmin');
const { orderedSlides, tagBlocks, xfrmOf } = require('../../design-dna/structure');
const L = require('./templateLayout');
const { slotKind } = require('./templateStory');

const MAX_BYTES = 80 * 1024 * 1024;

// ─── ZIP: толық оқу (барлық файлдар) ───────────────────────────────────────
function readZipAll(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('zip емес');
  if (buf.length > MAX_BYTES) throw new Error('файл тым үлкен');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip емес');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
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
    if (name.endsWith('/')) continue; // каталог жазбалары
    const dn = buf.readUInt16LE(lho + 26);
    const de = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + dn + de;
    const raw = buf.subarray(start, start + csize);
    let data;
    try {
      data = method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw);
    } catch {
      data = Buffer.from(raw);
    }
    if (/\.(xml|rels)$/i.test(name)) files.set(name, data.toString('utf8'));
    else files.set(name, Buffer.from(data));
  }
  return files;
}

/** Тәуелсіз минимал XML well-formed тексерісі (тег стегі). Қате болса мәтін қайтарады, дұрыс болса null. */
function xmlProblem(xml) {
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/([\w:.-]+)\s*>|<([\w:.-]+)(?:\s[^<>]*?)?(\/?)>/g;
  const stack = [];
  let m;
  while ((m = re.exec(xml))) {
    if (m[1]) {
      if (stack.pop() !== m[1]) return `жабу тегі сәйкес емес: </${m[1]}>`;
    } else if (m[2] && !m[3]) stack.push(m[2]);
  }
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml)) return 'жарамсыз control таңба';
  return stack.length ? `жабылмаған тег: <${stack[stack.length - 1]}>` : null;
}

function writeZipAll(files) {
  const arr = [];
  for (const [name, data] of files.entries()) arr.push({ name, data });
  return makeZip(arr);
}

// ─── Мәтін пішіндерін табу/ауыстыру ─────────────────────────────────────────
const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function txBodyOf(block) {
  return (block.match(/<p:txBody[\s\S]*?<\/p:txBody>/) || [null])[0];
}

function textOfBlock(block) {
  const tx = txBodyOf(block);
  if (!tx) return '';
  return [...tx.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('').replace(/\s+/g, ' ').trim();
}


// ─── Қаріп қамтуы (кирилл/қазақ әріптері) ───────────────────────────────────
const KK_PROBE = [0x410, 0x430, 0x4D8, 0x4D9, 0x492, 0x493, 0x49A, 0x49B, 0x4A2, 0x4A3, 0x4E8, 0x4E9, 0x4B0, 0x4B1, 0x4AE, 0x4AF, 0x4BA, 0x4BB, 0x406, 0x456];
const SAFE_FALLBACK = 'Times New Roman';
const SAFE_SANS = 'Arial';
const hasCyr = (t) => /[\u0400-\u04FF]/.test(t || '');

/** EOT/TTF/OTF буфердің cmap-ынан кодпоинттер жиынын шығарады (format 4 және 12). */
function cmapOf(buf) {
  let fd = buf;
  if (buf.length > 36 && buf.readUInt32LE(0) === buf.length && buf.readUInt16LE(34) === 0x504C) {
    const eot = buf.readUInt32LE(0), size = buf.readUInt32LE(4), flags = buf.readUInt32LE(12);
    if (flags & 0x4) return null;                       // MTX сығылған — оқи алмаймыз
    fd = buf.subarray(eot - size, eot);
    if (flags & 0x10000000) fd = Buffer.from(fd.map((b) => b ^ 0x50));
  }
  try {
    const n = fd.readUInt16BE(4);
    let cmapOff = -1;
    for (let i = 0; i < n; i++) if (fd.toString('latin1', 12 + i * 16, 16 + i * 16) === 'cmap') cmapOff = fd.readUInt32BE(20 + i * 16);
    if (cmapOff < 0) return null;
    const set = new Set();
    const nt = fd.readUInt16BE(cmapOff + 2);
    for (let i = 0; i < nt; i++) {
      const off = cmapOff + fd.readUInt32BE(cmapOff + 4 + i * 8 + 4);
      const fmt = fd.readUInt16BE(off);
      if (fmt === 4) {
        const sc = fd.readUInt16BE(off + 6) / 2;
        const endO = off + 14, startO = endO + sc * 2 + 2;
        for (let k = 0; k < sc; k++) {
          const e = fd.readUInt16BE(endO + k * 2), st = fd.readUInt16BE(startO + k * 2);
          for (const c of KK_PROBE) if (c >= st && c <= e) set.add(c);
        }
      } else if (fmt === 12) {
        const ng = fd.readUInt32BE(off + 12);
        for (let k = 0; k < ng; k++) {
          const st = fd.readUInt32BE(off + 16 + k * 12), e = fd.readUInt32BE(off + 20 + k * 12);
          for (const c of KK_PROBE) if (c >= st && c <= e) set.add(c);
        }
      }
    }
    return set;
  } catch { return null; }
}

/** Шаблонда ЕНГІЗІЛГЕН, бірақ кирилл/қазақ әріптерін қамтымайтын қаріптер атауы. */
function uncoveredFonts(files) {
  const bad = new Set();
  const pres = files.get('ppt/presentation.xml') || '';
  const rels = relsOf(files.get('ppt/_rels/presentation.xml.rels') || '');
  for (const m of pres.matchAll(/<p:embeddedFont>([\s\S]*?)<\/p:embeddedFont>/g)) {
    const face = (m[1].match(/<p:font typeface="([^"]+)"/) || [])[1];
    const rid = (m[1].match(/<p:(?:regular|bold|italic|boldItalic) r:id="([^"]+)"/) || [])[1];
    const target = rid && rels[rid];
    const data = target && files.get('ppt/' + target.replace(/^\.?\//, ''));
    if (!face || !Buffer.isBuffer(data)) continue;
    const cm = cmapOf(data);
    if (cm && KK_PROBE.some((c) => !cm.has(c))) bad.add(face);
  }
  return bad;
}
function relsOf(xml) {
  const o = {};
  for (const m of xml.matchAll(/<Relationship [^>]*>/g)) {
    const id = (m[0].match(/Id="([^"]+)"/) || [])[1], t = (m[0].match(/Target="([^"]+)"/) || [])[1];
    if (id) o[id] = t;
  }
  return o;
}

// ─── Мәтінді қорапқа ӨЛШЕП орналастыру қозғалтқышы ──────────────────────────
const W_SANS = { low: 0.575, up: 0.703, dig: 0.573, sp: 0.272, pun: 0.336 };   // Inter Light өлшемінен
const W_SERIF = { low: 0.515, up: 0.704, dig: 0.5, sp: 0.25, pun: 0.32 };      // Times өлшемінен
const isSerifFace = (f) => /serif|times|georgia|cambria|garamond|didot|bodoni|playfair|jour|palatino|book|cormorant|baskerville|caslon|canela|lora|merriweather|libre|antiqua|roman/i.test(f || '') && !/sans/i.test(f || '');
/** Кирилл қамтымайтын қаріптің орнына: кескінді (≥30pt) және serif қаріптер → Times; қалған мәтін (sans) → Arial (түпнұсқадағыдай sans көрінісі). */
const fallbackFace = (face, szPt) => (isSerifFace(face) || (szPt || 0) >= 30 ? SAFE_FALLBACK : SAFE_SANS);

function textWidthPt(str, szPt, serif, bold, spcPt) {
  const W = serif ? W_SERIF : W_SANS;
  let w = 0;
  for (const ch of String(str)) {
    if (ch === ' ') w += W.sp;
    else if (/\d/.test(ch)) w += W.dig;
    else if (/\p{Lu}/u.test(ch)) w += W.up;
    else if (/\p{L}/u.test(ch)) w += W.low;
    else w += W.pun;
  }
  // spcPt — әріп аралығы (a:rPr spc): әр таңбаға қосылады, әйтпесе кең аралықты тақырып өлшемнен кең шығады
  return w * szPt * (bold ? 1.07 : 1) * 1.04 + (spcPt || 0) * [...String(str)].length;   // 4% қор
}

/** Жолды енге қарай бөліп, қатар санын қайтарады (ұзын сөз бірнеше қатарға бөлінеді). */
function countLines(str, szPt, widthPt, serif, bold, spcPt) {
  if (!str) return 1;
  const words = String(str).split(/\s+/).filter(Boolean);
  const spW = textWidthPt(' ', szPt, serif, bold, spcPt);
  let lines = 1, cur = 0;
  for (const w of words) {
    const ww = textWidthPt(w, szPt, serif, bold, spcPt);
    if (ww > widthPt) {                       // сөздің өзі сыймайды
      lines += Math.ceil(ww / widthPt) - (cur === 0 ? 1 : 0);
      cur = ww % widthPt;
      continue;
    }
    if (cur === 0) cur = ww;
    else if (cur + spW + ww <= widthPt) cur += spW + ww;
    else { lines++; cur = ww; }
  }
  return lines;
}

function spacingOf(pPr, tag) {
  const m = (pPr || '').match(new RegExp('<a:' + tag + '>\\s*<a:(spcPts|spcPct) val="(-?\\d+)"'));
  return m ? { kind: m[1], val: +m[2] } : null;
}

/** Мәтін қорапқа сыюы үшін кегль мен қатар аралығын таңдайды; сыймаса жолдарды қысқартады. */
function fitLines(lines, o) {
  const { box, pPr, rPr, serif, bold, single } = o;
  const origSz100 = (rPr.match(/ sz="(\d+)"/) || [])[1];
  if (!origSz100 || !box || !box.w || !box.h) return { lines, sz: null, lnPts: null, ok: true };
  const orig = +origSz100 / 100;
  const insets = o.insets || { l: 0, r: 0, t: 0, b: 0 };
  const wPt = Math.max(10, box.w / 12700 - insets.l - insets.r) / (single ? DISPLAY_SAFETY : 1);
  // box.h — шаблон қорабының биіктігі; o.grow — оның ТӨМЕНІНДЕГІ бос орын (келесі пішінге/слайд шетіне дейін)
  // 6% рұқсат тек қорап өз орнында қалғанда; қорап төмен өссе (grow) — рұқсат жоқ, әйтпесе мәтін көршіге/жылжытылған элементке түседі
  const hPt = Math.max(8, (box.h + (o.grow || 0)) / 12700 - insets.t - insets.b) * (o.grow ? 1 : 1.06);
  const ln = spacingOf(pPr, 'lnSpc');
  const bef = spacingOf(pPr, 'spcBef'), aft = spacingOf(pPr, 'spcAft');
  const gapOf = (sp, sz) => (!sp ? 0 : sp.kind === 'spcPts' ? sp.val / 100 : (sp.val / 100000) * sz);
  const origRatio = !ln ? 1.2 : ln.kind === 'spcPts' ? ln.val / 100 / orig : (ln.val / 100000) * 1.2;
  const spcOrig = (+((rPr.match(/ spc="(-?\d+)"/) || [])[1]) || 0) / 100;     // әріп аралығы (pt)
  const isTitle = orig >= 30;
  // relax — соңғы сатылар: қаріпті әдеттегіден да кішірек етуге рұқсат (бірақ оқылатын шектен төмен емес)
  const minSz = isTitle ? (o.relax ? Math.max(16, orig * 0.3) : Math.max(20, orig * 0.35)) : (o.relax ? Math.max(9.5, orig * 0.5) : Math.max(11, orig * 0.6));
  // minScale — осы сатыда қаріп түпнұсқаның ең болмағанда осынша бөлігі болсын (кішірейгенше басқа жолдарды — қорапты үлкейту/кедергіні жылжыту — қолданамыз)
  const floor = Math.min(Math.max(minSz, orig * (o.minScale || 0)), orig);

  const measure = (arr, sz) => {
    const scale = sz / orig;
    const spc = spcOrig * scale;                                            // кішірейгенде аралық та пропорционалды кішірейеді
    let total = 0, wrapped = false;
    const counts = arr.map((l) => { const c = countLines(l, sz, wPt, serif, bold, spc); if (c > 1) wrapped = true; return c; });
    // көп қатарлы мәтінде үлкен қатар аралығы (spcPts) қысқарады — шаблон бір қатарға арналған
    const ratio = wrapped ? Math.min(origRatio, 1.25) : origRatio;
    const lineH = ratio * sz;
    arr.forEach((l, i) => { total += counts[i] * lineH + (i ? gapOf(bef, sz) + gapOf(aft, sz) : 0); });
    const oneWordOk = !single || arr.every((l) => textWidthPt(l, sz, serif, bold, spc) <= wPt);
    const wordsOk = arr.every((l) => l.split(/\s+/).every((w) => textWidthPt(w, sz, serif, bold, spc) <= wPt));   // сөз ортасынан үзілмейді
    return { total, lineH, ratio, ok: total <= hPt && oneWordOk && wordsOk, scale, wrapped, lines: counts.reduce((a, b) => a + b, 0) };
  };

  let arr = lines.slice();
  // LLM таңдаған кегль (fontPt): іздеу осыдан басталады; түпнұсқа қатар санына/толтыруға бейімдеу өтпейді
  const startSz = o.fontPt ? Math.min(Math.max(o.fontPt, floor), orig * 1.6) : orig;
  const search = () => {
    for (let sz = startSz; sz >= floor - 0.01; sz = sz * 0.95) {
      const m = measure(arr, sz);
      if (m.ok) return { sz, m };
    }
    return null;
  };
  // Түпнұсқа мәтін қанша қатар болса (тақырып ≤3, қалғаны ≤2), жаңа мәтін де сонша қатарға (тақырыпқа +1) сыйғызылады:
  // «Еуропа / 20 / ғасыр» сияқты 3 қатарлы алып тақырып орнына таза 2 қатар.
  let hit = null;
  const origEst = (o.origTexts || []).reduce((n, t) => n + countLines(t, orig, wPt, serif, bold, spcOrig), 0);
  // Тақырыпта біздің (кеңірек) өлшем түпнұсқаның қатар санын асыра санауы мүмкін — сондықтан ≥2 болса мақсат 2 қатар.
  const prefLines = isTitle ? (origEst === 1 ? 1 : 2) : (origEst && origEst <= 2 ? origEst : 0);
  if (prefLines && !single && !o.fontPt) {
    const fl = Math.min(orig, Math.max(orig * (isTitle ? 0.55 : 0.75), floor));
    const Ls = isTitle ? [prefLines, prefLines + 1] : [prefLines];
    for (const L of Ls) {
      for (let sz = orig; sz >= fl - 0.01; sz *= 0.97) {
        const m = measure(arr, sz);
        if (m.ok && m.lines <= Math.max(L, arr.length)) { hit = { sz, m }; break; }
      }
      if (hit) break;
    }
  }
  if (!hit) hit = search();
  // Сыймаса — ең ұзын жолды ТОЛЫҚ сөйлем/бөлік болып қалатындай қысқартамыз (шешім: shortenLine)
  let guard = 0;
  while (!hit && guard++ < 40 && !single && !o.noShorten) {
    let k = 0;
    arr.forEach((l, i) => { if (l.length > arr[k].length) k = i; });
    const cur = arr[k];
    if (cur.length <= 12) break;
    const next = shortenLine(cur);
    if (next === cur) break;
    arr[k] = next;
    hit = search();
  }
  if (!hit) hit = { sz: floor, m: measure(arr, floor) };
  // Мәтін қорапты толтырмаса (қысқа мәтін үлкен қорапта) — кегль 1.5×-ке дейін (≤30pt) өседі, қорап ≤80% толғанша.
  if (!isTitle && !single && !o.noFill && !o.fontPt && hit.sz >= orig - 0.01) {
    const target = Math.max(8, box.h / 12700 - insets.t - insets.b) * 0.8;
    const maxUp = Math.min(orig * 1.5, Math.max(orig, 30));
    for (let sz = orig + 0.5; sz <= maxUp + 0.01; sz += 0.5) {
      const m = measure(arr, sz);
      if (m.ok && m.total <= target) hit = { sz, m }; else break;
    }
  }
  const szOut = Math.round(hit.sz * 100);
  const lnPts = (!ln || ln.kind === 'spcPts') ? Math.round(hit.m.ratio * hit.sz * 100) : null;
  return { lines: arr, sz: szOut, lnPts, usedH: hit.m.total, ok: !!hit.m.ok, shortened: arr.some((l, i) => l !== lines[i]) };
}

/**
 * Ұзын жолды қысқартады. «…» қоймай, МАҒЫНАЛЫҚ шекарада қияды:
 *   1) соңғы үтір/нүктелі үтір/сызықша/нүктеден (жолдың ≥45%-ы қалатындай);
 *   2) болмаса — сөз шекарасынан, соңына нүкте қойып (сөйлем аяқталған болып көрінеді, үзік «…» емес).
 * Жол «: » арқылы «Белгі: түсініктеме» болса, белгісі сақталады.
 */
function shortenLine(cur) {
  const minKeep = Math.ceil(cur.length * 0.25);
  const maxKeep = Math.floor(cur.length * 0.85);
  const FUNC = /^(және|мен|бен|пен|ал|да|де|та|те|бұл|ол|осы|мына|сол|үшін|а|и|в|на|с|по|что|как|но|the|and|or|of|to|in)$/iu;
  const tidy = (t) => {                                        // жалғаулық/шылау сөзбен аяқталмасын
    const w = t.trim().split(/\s+/);
    while (w.length > 3 && (FUNC.test(w[w.length - 1].replace(/[,;:—–]/g, '')) || w[w.length - 1].length <= 2)) w.pop();
    return w.join(' ').replace(/[,;:—–\s]+$/u, '');
  };
  for (let i = maxKeep; i >= minKeep; i--) {                   // соңғы мағыналық шекара (үтір, ;, —, нүкте)
    if (/[,;—–.]/.test(cur[i])) return tidy(cur.slice(0, i)).replace(/\.$/, '') + '.';
  }
  const word = cur.slice(0, maxKeep).replace(/\s+\S*$/, '');
  return (tidy(word) || word) + '.';
}

/** rPr ішінде: қаріпті ауыстыру (кирилл қамтымаса) және тіл. Кегль fitLines-та қойылады. */
function adaptRPr(rPr, lines, ctx) {
  if (!rPr) return rPr;
  let r = rPr;
  if (hasCyr(lines.join(' '))) {
    const bad = (ctx && ctx.badFonts) || new Set();
    const szPt = (+((r.match(/ sz="(\d+)"/) || [])[1] || 0)) / 100;
    r = r.replace(/(<a:(?:latin|ea|cs|sym) [^>]*?typeface=")([^"]+)(")/g, (m, a, face, c) => (bad.has(face) ? a + fallbackFace(face, szPt) + c : m));
    if (/ lang="[^"]*"/.test(r)) r = r.replace(/ lang="[^"]*"/, ' lang="kk-KZ"');
    else r = r.replace(/^<a:rPr/, '<a:rPr lang="kk-KZ"');
  }
  return r;
}

/** Бір тегтің толық элементін (self-closing НЕМЕСЕ ашық+жабық) қауіпсіз табады. */
function elemOf(xml, tag) {
  const open = new RegExp('<' + tag + '(?=[\\s/>])[^>]*>');
  const m = open.exec(xml);
  if (!m) return '';
  if (m[0].endsWith('/>')) return m[0];            // <a:rPr .../>
  const close = '</' + tag + '>';
  const end = xml.indexOf(close, m.index + m[0].length);
  return end < 0 ? '' : xml.slice(m.index, end + close.length);
}

/** Бір пішіннің ішіндегі барлық абзацты lines жолдарымен ауыстырады (бірінші абзацтың форматтауын сақтап). */
function replaceShapeText(block, lines, ctx) {
  const tx = txBodyOf(block);
  if (!tx) return block;
  let bodyPr = elemOf(tx, 'a:bodyPr') || '<a:bodyPr/>';
  if (ctx && ctx.single) bodyPr = noWrap(bodyPr);          // бір сөз: ешқашан екінші қатарға түспейді
  const lstStyle = elemOf(tx, 'a:lstStyle');
  const paras = tagBlocks(tx, 'a:p');
  let pPr = '';
  let rPr = '';
  if (paras.length) {
    pPr = elemOf(paras[0], 'a:pPr');
    rPr = elemOf(paras[0], 'a:rPr');
  }
  let list = lines && lines.length ? lines : [''];
  rPr = adaptRPr(rPr, list, ctx);

  if (ctx && ctx.box && rPr && list.some(Boolean)) {
    const face = (rPr.match(/<a:latin [^>]*typeface="([^"]+)"/) || [])[1] || '';
    const inset = (n, d) => { const m = bodyPr.match(new RegExp(' ' + n + '="(\\d+)"')); return (m ? +m[1] : d) / 12700; };
    const fit = fitLines(list, {
      box: ctx.box, grow: ctx.grow || 0, pPr, rPr, bold: / b="1"/.test(rPr), serif: isSerifFace(face), single: !!ctx.single,
      minScale: ctx.minScale, relax: !!ctx.relax, noShorten: !!ctx.noShorten, fontPt: ctx.fontPt,
      origTexts: paras.map((pp) => [...pp.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('')).filter((t) => t.trim()),
      insets: { l: inset('lIns', 91440), r: inset('rIns', 91440), t: inset('tIns', 45720), b: inset('bIns', 45720) },
    });
    if (ctx.probe) return fit;
    list = fit.lines;
    if (fit.usedH && ctx.growBox && ctx.grow) {
      // мәтін шаблон қорабынан биік болса — қорап төмен өседі (spAutoFit сияқты), сөйтіп таңбалау мен таңдау дәл болады
      const needEmu = Math.ceil((fit.usedH + 2) * 12700);
      if (needEmu > ctx.box.h) block = growHeight(block, needEmu);
    }
    if (fit.sz) {
      const o100 = +((rPr.match(/ sz="(\d+)"/) || [])[1]) || 0;
      if (o100 && / spc="-?\d+"/.test(rPr)) rPr = rPr.replace(/ spc="(-?\d+)"/, (m, v) => ` spc="${Math.round(+v * fit.sz / o100)}"`);
      rPr = / sz="\d+"/.test(rPr) ? rPr.replace(/ sz="\d+"/, ` sz="${fit.sz}"`) : rPr;
      if (fit.lnPts && pPr && /<a:lnSpc>\s*<a:spcPts/.test(pPr)) {
        pPr = pPr.replace(/(<a:lnSpc>\s*<a:spcPts val=")-?\d+(")/, `$1${fit.lnPts}$2`);
      }
    }
  }
  const newParas = list.map((l) => `<a:p>${pPr}<a:r>${rPr}<a:t>${esc(l)}</a:t></a:r></a:p>`).join('');
  const newTx = `<p:txBody>${bodyPr}${lstStyle}${newParas}</p:txBody>`;
  // ФУНКЦИЯ арқылы ауыстыру: мәтіндегі $&, $1, $' ерекше таңбалар ретінде өңделмейді
  return block.replace(tx, () => newTx);
}

/** bodyPr-ға wrap="none" қояды (бар болса ауыстырады). */
function noWrap(bodyPr) {
  if (/ wrap="[^"]*"/.test(bodyPr)) return bodyPr.replace(/ wrap="[^"]*"/, ' wrap="none"');
  return bodyPr.replace(/^<a:bodyPr/, '<a:bodyPr wrap="none"');
}

/** Пішін биіктігін (ext cy) өсіреді; кішірейтпейді. */
function growHeight(block, cy) {
  return block.replace(/(<a:ext cx="\d+" cy=")(\d+)(")/, (m, a, v, c) => (cy > +v ? a + cy + c : m));
}

/** Топтарды (p:grpSp) бір қорапқа айналдырып, тек жоғарғы деңгейдегі пішіндердің қораптарын қайтарады (слайд координатасында). */
function topLevelBoxes(xml) {
  let x = xml;
  const re = /<p:grpSp>(?:(?!<p:grpSp>)[\s\S])*?<\/p:grpSp>/g;
  for (let i = 0; i < 8 && /<p:grpSp>/.test(x); i++) {
    x = x.replace(re, (m) => {
      const b = xfrmOf(m);
      return b ? `<p:sp><p:spPr><a:xfrm><a:off x="${b.x}" y="${b.y}"/><a:ext cx="${b.w}" cy="${b.h}"/></a:xfrm></p:spPr></p:sp>` : '';
    });
  }
  return [...tagBlocks(x, 'p:sp'), ...tagBlocks(x, 'p:pic')].map(xfrmOf).filter(Boolean);
}

/**
 * Пішіннің ТӨМЕНІНДЕГІ бос орын (EMU): келесі пішінге/суретке немесе слайд шетіне дейін.
 * Мәтін қоршаған контейнер (мыс. «таблетка») ішінде болса — өсу контейнердің төменгі шетімен шектеледі.
 */
function roomBelow(xml, block, W, H) {
  const b = xfrmOf(block);
  if (!b) return 0;
  const bottom = b.y + b.h;
  const GAP = 110000;                       // ~0.12" көршіге дейін қалдырылатын ара
  const TOL = 20000;
  let limit = H - 457200;                   // слайд төменгі шеті (0.5" өріс)
  for (const x of topLevelBoxes(xml)) {
    if (x.x === b.x && x.y === b.y && x.w === b.w && x.h === b.h) continue;      // өзі
    if (x.h > H * 0.85 || x.w * x.h > W * H * 0.5) continue;                       // фон/үлкен пішіндер
    const contains = x.x <= b.x + TOL && x.y <= b.y + TOL && x.x + x.w >= b.x + b.w - TOL && x.y + x.h >= b.y + b.h - TOL;
    if (contains) { limit = Math.min(limit, x.y + x.h - 60000); continue; }        // контейнер ішінде
    const ov = Math.min(b.x + b.w, x.x + x.w) - Math.max(b.x, x.x);
    if (ov < 0.25 * Math.min(b.w, x.w)) continue;                                  // көлденең қиылыспайды
    if (x.y < b.y + b.h * 0.6) continue;                                            // төменде емес
    limit = Math.min(limit, x.y - GAP);
  }
  return Math.max(0, limit - bottom);
}

/** Слайдтағы мәтін пішіндерін жоғарыдан төмен қарай реттейді. */
function textShapes(xml) {
  const out = [];
  for (const sp of tagBlocks(xml, 'p:sp')) {
    const text = textOfBlock(sp);
    if (!text) continue; // бос/декоратив пішіндерге тимейміз
    const x = xfrmOf(sp);
    out.push({ block: sp, x, text });
  }
  out.sort((a, b) => ((a.x && a.x.y) || 0) - ((b.x && b.x.y) || 0) || ((a.x && a.x.x) || 0) - ((b.x && b.x.x) || 0));
  return out;
}

function linesForSlide(slide) {
  const title = String((slide && slide.title) || '').trim();
  const body = [];
  const sub = String((slide && slide.subtitle) || '').trim();
  if (sub) body.push(sub);
  for (const b of Array.isArray(slide && slide.bullets) ? slide.bullets : []) {
    const t = String(b || '').trim();
    if (t) body.push(t);
  }
  if (!body.length && String((slide && slide.body) || '').trim()) body.push(String(slide.body).trim());
  for (const st of Array.isArray(slide && slide.stats) ? slide.stats : []) {
    if (!st) continue;
    body.push(`${st.label ? st.label + ': ' : ''}${st.value}`);
  }
  return { title, body };
}

function chunkLines(lines, n) {
  const groups = [];
  const per = Math.ceil(lines.length / Math.max(n, 1));
  for (let i = 0; i < n; i++) groups.push(lines.slice(i * per, Math.min((i + 1) * per, lines.length)));
  return groups;
}

function slideSize(files) {
  const pres = files.get('ppt/presentation.xml') || '';
  const m = pres.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  return { W: m ? +m[1] : 12192000, H: m ? +m[2] : 6858000 };
}


/** Жолдарды қораптарға сыйымдылығына қарай бөледі (реті сақталады); жолдар аз болса — ең үлкен қораптар алады. */
function distributeLines(lines, slots) {
  const k = slots.length;
  const groups = slots.map(() => []);
  if (!k || !lines.length) return groups;
  const area = slots.map((s) => { const b = boxOf(s.block); return b ? b.w * b.h : 1; });
  if (lines.length <= k) {
    const idx = area.map((a, i) => [a, i]).sort((x, y) => y[0] - x[0]).slice(0, lines.length).map((x) => x[1]).sort((a, b) => a - b);
    idx.forEach((slot, j) => groups[slot].push(lines[j]));
    return groups;
  }
  const tot = area.reduce((a, b) => a + b, 0);
  let given = 0, cum = 0;
  slots.forEach((_, i) => {
    cum += area[i];
    const upto = i === k - 1 ? lines.length : Math.max(given + 1, Math.round((lines.length * cum) / tot));
    const end = Math.min(upto, lines.length - (k - 1 - i));
    groups[i] = lines.slice(given, Math.max(end, given + 1));
    given = Math.max(end, given + 1);
  });
  return groups;
}

const szOf = (block) => { const m = block.match(/ sz="(\d+)"/); return m ? +m[1] : 0; };
const boxOf = (block) => { const x = xfrmOf(block); return x ? { w: x.w, h: x.h } : null; };
const firstLetter = (t) => { const m = String(t || '').match(/[\p{L}\p{N}]/u); return m ? m[0].toUpperCase() : ''; };

/** Бос, бірақ қалыпты өлшемді (≤60pt) мәтін қораптары — мәтін шынымен жазылатын орын. */
function emptyTextShapes(xml) {
  const out = [];
  for (const sp of tagBlocks(xml, 'p:sp')) {
    if (!txBodyOf(sp) || textOfBlock(sp)) continue;
    const sz = szOf(sp), x = xfrmOf(sp);
    if (!x || !sz || sz > 6000) continue;
    out.push({ block: sp, x, text: '' });
  }
  out.sort((a, b) => a.x.y - b.x.y || a.x.x - b.x.x);
  return out;
}

/** Слайд пішіндерін рөлдерге бөледі (мәтінге тәуелсіз): бас әріптер, ірі сөздер, жұптар, дене қораптары. */
function classify(xml, ctx) {
  const shapes = textShapes(xml);
  // «01», «2» сияқты нөмір белгілері шаблонда қалады (өзгертілмейді)
  let content = shapes.filter((s) => !/^\d{1,3}[.)]?$/.test(s.text || ''));

  // Сәндік БАС ӘРІПТЕР: 1 таңба (≥60pt) немесе 2 таңба (≥200pt)
  const initials = content.filter((s) => { const n = s.text.replace(/\s/g, '').length; const z = szOf(s.block); return (n <= 1 && z >= 6000) || (n <= 2 && z >= 20000); })
    .sort((p, q) => p.x.y - q.x.y || p.x.x - q.x.x);
  content = content.filter((s) => !initials.includes(s));

  // «H|ISTORY  P|ROJECT» үлгісі: әр бас әріпке ең жақын ірі (≥60pt) мәтін пішінін жұптаймыз
  let pairs = null;
  const displays = content.filter((s) => szOf(s.block) >= 6000);
  if (initials.length && displays.length) {
    const found = [];
    const free = displays.slice();
    for (const ini of initials) {
      let best = -1, bd = Infinity;
      free.forEach((d, k) => { const dd = Math.hypot((d.x.x - ini.x.x) / 1e6, (d.x.y - ini.x.y) / 1e6); if (dd < bd) { bd = dd; best = k; } });
      if (best >= 0) found.push([ini, free.splice(best, 1)[0]]);
    }
    found.sort((p, q) => p[0].x.y - q[0].x.y || p[0].x.x - q[0].x.x);
    pairs = found.map(([ini, dsp], i) => {
      const nxt = found[i + 1];
      let end = nxt && nxt[0].x.x > dsp.x.x ? nxt[0].x.x : ((ctx && ctx.W) || 12192000) - 457200;
      end = Math.min(end, obstacleLeft(xml, dsp, ctx));          // оң жақтағы мәтін/«таблетка» астына шықпасын
      return { ini, dsp, limit: end - dsp.x.x, end };
    });
    content = content.filter((s) => !displays.includes(s));
  }
  // Мазмұн пішіні қалмаса — бос қораптарға жазамыз
  if (!content.length) content = emptyTextShapes(xml);
  // РӨЛ: тақырып — ең ірі қарпі бар қорап (оқу реті емес). «Electrical Properties» тақырыбы дене мәтінінен төмен тұрса да тақырып болып қалады.
  if (!pairs && content.length > 1) {
    const first = szOf(content[0].block);
    let best = 0;
    content.forEach((sh, i) => { if (szOf(sh.block) > szOf(content[best].block)) best = i; });
    if (best && szOf(content[best].block) >= first * 1.15) content = [content[best], ...content.filter((_, i) => i !== best)];
  }
  return { initials, pairs, content };
}

// ─── «Үлкен бас әріп + сөз» логотипі: ЕКЕУІН БІРГЕ бірдей масштабтау ─────────────────────
// Бұрын тек сөздің қалғаны кішірейіп, бас әріп 280pt күйінде қалатын (пропорция бұзылатын) еді.
// Енді шаблонның пропорциясы (әріп : сөз = 3.5 : 1 т.б.) сақталады, бәрі бірдей k есе кішірейеді.
const LOGO_KMIN = 0.4;
const DISPLAY_SAFETY = 1.12;   // қонақ қаріптері (Android/Keynote ауыстыруы) біздің өлшемнен ~10% кең болуы мүмкін
const faceOfBlock = (block) => { const m = block.match(/<a:latin [^>]*typeface="([^"]+)"/); return m ? m[1] : ''; };

/** Барлық жұп сыятын ең үлкен ортақ масштаб k ∈ [LOGO_KMIN, 1]. */
function logoScale(pairs, words) {
  let k = 1;
  pairs.forEach((p, i) => {
    const rest = String(words[i] || '').slice(1);
    const sz = szOf(p.dsp.block) / 100;
    if (!rest || !sz) return;
    const serif = isSerifFace(faceOfBlock(p.dsp.block)), bold = / b="1"/.test(p.dsp.block);
    const fits = (kk) => {
      const x = p.ini.x.x + (p.dsp.x.x - p.ini.x.x) * kk;                 // сөз әріпке жақындайды
      return textWidthPt(rest, sz * kk, serif, bold) * DISPLAY_SAFETY <= (p.end - x) / 12700;
    };
    let kk = 1;
    while (kk > LOGO_KMIN && !fits(kk)) kk = Math.round((kk - 0.02) * 100) / 100;
    k = Math.min(k, Math.max(kk, LOGO_KMIN));
  });
  return k;
}

/** Үлкен әріптің табан сызығының шамамен y-координатасы (EMU): қорап төбесі + ~0.89 × қатар аралығы. */
function baselineOf(block, x) {
  const ln = spacingOf(block, 'lnSpc');
  const sz = szOf(block) / 100;
  const linePts = ln && ln.kind === 'spcPts' ? ln.val / 100 : sz * 1.2;
  return Math.round(x.y + 0.89 * linePts * 12700);
}

/** Пішінді (орны, өлшемі, кегль, қатар аралығы) (ox,oy) нүктесіне қатысты k есе масштабтайды. */
function scaleBlock(block, k, ox, oy, widthFn) {
  let b = block.replace(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/, (m, x, y, cx, cy) => {
    const nx = Math.round(ox + (+x - ox) * k), ny = Math.round(oy + (+y - oy) * k);
    const w = widthFn ? Math.max(widthFn(nx), 100000) : Math.round(+cx * k);
    return `<a:off x="${nx}" y="${ny}"/><a:ext cx="${w}" cy="${Math.round(+cy * k)}"/>`;
  });
  b = b.replace(/(<a:(?:rPr|endParaRPr|defRPr)\b[^>]*? sz=")(\d+)(")/g, (m, a, v, c) => a + Math.round(+v * k) + c);
  b = b.replace(/(<a:lnSpc>\s*<a:spcPts val=")(-?\d+)(")/g, (m, a, v, c) => a + Math.round(+v * k) + c);
  return b;
}

/**
 * Логотип сөзінің оң шегі: сөздің жолағында (тік қиылысу) оң жақта тұрған шағын пішін/мәтін қорабы
 * (мыс. мәтіні бар «таблетка») болса — сол пішіннің сол шеті. Үлкен фон/сызықтар есепке алынбайды.
 */
function obstacleLeft(xml, dsp, ctx) {
  const W = (ctx && ctx.W) || 12192000, H = (ctx && ctx.H) || 6858000;
  const sz = szOf(dsp.block) / 100;
  const top = dsp.x.y, bottom = dsp.x.y + sz * 1.1 * 12700;
  let left = Infinity;
  for (const x of topLevelBoxes(xml)) {
    if (x.x < dsp.x.x + 300000) continue;                                   // оң жақта емес
    if (x.w * x.h > 0.15 * W * H || x.w > 0.6 * W) continue;                 // фон/ұзын сызықтар
    if (x.y >= bottom || x.y + x.h <= top) continue;                        // тік қиылыспайды
    if (x.y < H * 0.02 && x.h > H * 0.5) continue;
    left = Math.min(left, x.x - 150000);
  }
  return left;
}

function fillSlide(xml, slide, ctx) {
  if (!xml || !slide) return xml;
  const { title, body } = linesForSlide(slide);
  const c = { badFonts: ctx && ctx.badFonts };
  const cl = classify(xml, ctx);
  const { initials, pairs } = cl;
  let content = cl.content;
  if (!content.length && !initials.length) return xml;

  let out = xml;
  const H = (ctx && ctx.H) || 6858000;
  const W = (ctx && ctx.W) || 12192000;
  const allShapes = () => [...initials, ...content, ...(pairs ? pairs.flatMap((p) => [p.ini, p.dsp]) : [])];
  // көрші пішін жылжытылса, оның жаңа XML-ін барлық сілтемелерде жаңартамыз
  const retarget = (oldB, newB) => { for (const sh of allShapes()) if (sh.block === oldB) { sh.block = newB; sh.x = xfrmOf(newB) || sh.x; } };
  const put = (s, lines, maxW, single, noGrow, fontPt) => {
    const bx = boxOf(s.block);
    const box = bx && maxW ? { w: Math.min(bx.w, Math.max(maxW, bx.w * 0.25)), h: bx.h } : bx;
    if (single || noGrow || !bx || !(lines || []).some(Boolean)) {
      const grow = !noGrow && bx ? roomBelow(out, s.block, W, H) : 0;
      const r = replaceShapeText(s.block, lines, { ...c, box, single, grow, growBox: true, fontPt });
      out = out.replace(s.block, () => r);
      return;
    }
    // ── Сатылы сыйғызу: 1) қорапты бос орынға үлкейту → 2) кедергіні кішкене жылжыту → 3) қаріпті кішірейту → 4) ең соңында ғана қысқарту
    let sur = L.surround(out, s.block, W, H);
    const hadCut = Number.isFinite(sur.rightCut);
    // оң жақтағы сурет қораптың ішіне кіріп тұр: қорапты суретке дейін қысамыз (әйтпесе мәтін суреттің үстіне түседі).
    // Қысқаннан кейін қайта тексереміз: жаңа ені бойынша тағы бір сурет ішке кіріп тұруы мүмкін (≤3 қадам).
    // Сурет қораптың тек ТӨМЕНГІ бөлігіне кірсе, екі нұсқа салыстырылады: (а) қорапты суретке дейін тарылту;
    // (ә) енін сақтап, мәтінді суреттің ҮСТІНЕ сыйғызу. Қаріп ірірек шығатыны таңдалады (иерархия бұзылмайды).
    let lockH = false;
    const probeSz = (blk, bw, bh, grow) => {
      const f = replaceShapeText(blk, lines, { ...c, box: { w: bw, h: bh }, single: false, grow, growBox: true, relax: true, noShorten: true, probe: true, fontPt });
      return f && typeof f !== 'string' && f.ok ? (f.sz || 0) : 0;
    };
    for (let k = 0; k < 3 && !maxW && Number.isFinite(sur.rightCut); k++) {
      const pos = xfrmOf(s.block) || {};
      const nw = sur.rightCut - (pos.x || 0);
      if (!(nw < bx.w)) break;
      const canNarrow = nw >= bx.w * 0.4;
      const aboveH = sur.rightCutTop - L.GAP - (pos.y || 0);
      if (aboveH > bx.h * 0.3 && aboveH < bx.h) {
        let szAbove = probeSz(s.block, bx.w, aboveH, 0);
        const szNarrow = canNarrow ? probeSz(s.block, nw, bx.h, sur.room) : 0;
        // (б) кедергіні кішкене төмен жылжытып, үстінен көбірек орын алу (мәтінсіз, слайдтан шықпайтын элемент қана)
        const ob = sur.rightCutItem;
        const dy = ob && ob.box ? Math.min(L.MAX_SHIFT, H - 200000 - (ob.box.y + ob.box.h), bx.h - aboveH) : 0;
        let aH = aboveH;
        if (dy > 100000) {
          const szMoved = probeSz(s.block, bx.w, aboveH + dy, 0);
          if (szMoved > Math.max(szAbove * 1.1, szNarrow)) {
            const moved = L.shiftBlock(ob.block, 0, dy / (ob.sy || 1));
            out = out.replace(ob.block, () => moved); retarget(ob.block, moved);
            aH = aboveH + dy; szAbove = szMoved;
            console.log(`[TemplateFill] кедергі жылжытылды: 1 элемент, +${Math.round(dy / 12700)}pt орын (тақырып үстінде)`);
          }
        }
        if (szAbove && szAbove >= szNarrow) {
          const shorter = L.setHeight(s.block, aH);
          out = out.replace(s.block, () => shorter);
          s.block = shorter; s.x = xfrmOf(shorter) || s.x;
          bx.h = aH; box.h = aH;
          lockH = true;
          break;
        }
      }
      if (!canNarrow) break;
      {
        const narrowed = L.setWidth(s.block, nw);
        out = out.replace(s.block, () => narrowed);
        s.block = narrowed; s.x = xfrmOf(narrowed) || s.x;
        bx.w = nw; box.w = nw;
        sur = L.surround(out, s.block, W, H);
      }
    }
    if (lockH) sur = { ...sur, room: 0, blockers: [], container: null, noNudge: true };   // суреттің үстінде: төмен өспейді
    // нақты жылжыту мүмкіндігі (тізбек пен шектер ескеріледі), қосымша өсім: room-нан тыс
    const cap = L.planNudge(sur, L.nudgeCapacity(sur, W, H), W, H).grow;
    // енін кеңейту шегі: мәтін өсетін биіктікті (room + cap) ескеріп, оң жақтағы суретке тимейді
    sur = lockH ? { ...sur, right: 0 } : { ...L.surround(out, s.block, W, H, undefined, sur.room + cap), room: sur.room };
    const algn = (s.block.match(/<a:pPr[^>]*? algn="(\w+)"/) || [])[1];
    const widen = (!algn || algn === 'l') && !maxW && !hadCut ? Math.min(sur.right, Math.round(bx.w * L.MAX_WIDEN)) : 0;
    const tiers = [
      { extra: 0, widen: 0, minScale: 0.9 },
      { extra: cap, widen, minScale: 0.85 },
      { extra: cap, widen, minScale: 0 },
      { extra: cap, widen, minScale: 0, relax: true },
      { extra: cap, widen, minScale: 0, relax: true, shorten: true },
    ];
    const ctxOf = (t) => ({ ...c, box: { w: box.w + t.widen, h: box.h }, single: false, grow: sur.room + t.extra, growBox: true, minScale: fontPt ? Math.min(t.minScale, 0.6) : t.minScale, relax: !!t.relax, noShorten: !t.shorten, fontPt });
    let tier = tiers[tiers.length - 1];
    for (const t of tiers) {
      const f = replaceShapeText(s.block, lines, { ...ctxOf(t), probe: true });
      if (typeof f === 'string' || !f || f.ok) { tier = t; break; }
    }
    let r = replaceShapeText(s.block, lines, ctxOf(tier));
    const nb = xfrmOf(r);
    const textGrow = nb ? Math.max(0, nb.h - bx.h) : 0;
    const extraNeed = Math.max(0, textGrow - sur.room);
    if (tier.widen && nb) {
      // енді кеңейту тек мәтін шынымен кеңдік сұраса ғана қалады: бұрынғы ені жеткілікті болса, қайтарамыз
      const narrow = replaceShapeText(s.block, lines, { ...ctxOf({ ...tier, widen: 0 }), probe: true });
      if (typeof narrow !== 'string' && narrow && narrow.ok && !narrow.shortened) { tier = { ...tier, widen: 0 }; r = replaceShapeText(s.block, lines, ctxOf(tier)); }
      else r = L.growBlock(r, { cx: bx.w + tier.widen });
    }
    if (extraNeed > 0) {
      // жоспарлау кезіндегі шартпен бірдей: cap-тен аспаймыз (әйтпесе «сыяды» деп есептеп, жылжыту сәтсіз болып қалатын)
      const plan = L.planNudge(sur, extraNeed, W, H);
      if (plan.grow >= extraNeed) {
        if (sur.container) {
          const nc = L.growContainerBlock(sur.container.block, plan.grow);
          out = out.replace(sur.container.block, () => nc); retarget(sur.container.block, nc);
        }
        for (const mv of plan.moves) {
          const moved = L.shiftBlock(mv.item.block, 0, mv.dy);
          out = out.replace(mv.item.block, () => moved); retarget(mv.item.block, moved);
        }
        console.log(`[TemplateFill] кедергі жылжытылды: ${plan.moves.length} элемент, +${Math.round(plan.grow / 12700)}pt орын`);
      } else {
        // жылжыту мүмкін болмады: мәтінді тек бос орынға (room) қайта сыйғызамыз — қаріп кішірейеді, қорап көршіге түспейді
        const noNudge = tiers.map((t) => ({ ...t, extra: 0 }));
        let t2 = noNudge[noNudge.length - 1];
        for (const t of noNudge) {
          const f = replaceShapeText(s.block, lines, { ...ctxOf(t), probe: true });
          if (typeof f === 'string' || !f || f.ok) { t2 = t; break; }
        }
        r = replaceShapeText(s.block, lines, ctxOf(t2));
        if (t2.widen) r = L.growBlock(r, { cx: bx.w + t2.widen });
        r = r.replace(/(<a:ext cx="\d+" cy=")(\d+)(")/, (m, a2, v, c2) => a2 + Math.min(+v, bx.h + sur.room) + c2);
        console.log('[TemplateFill] жылжыту мүмкін емес — қаріп кішірейтілді');
      }
    }
    out = out.replace(s.block, () => r);
    s.block = r; s.x = xfrmOf(r) || s.x;
  };
  const setBlock = (s, nb) => { out = out.replace(s.block, () => nb); s.block = nb; };

  if (pairs) {
    const words = String(title).split(/[\s:–—-]+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => /\p{L}/u.test(w));
    const ws = pairs.map((_, i) => (words[i] || '').toUpperCase());
    const k = logoScale(pairs, ws);
    pairs.forEach((p, i) => {
      const w = ws[i];
      if (w && k < 0.999) {
        const ox = p.ini.x.x, oy = baselineOf(p.ini.block, p.ini.x);   // әріптің табаны қозғалмайды
        setBlock(p.ini, scaleBlock(p.ini.block, k, ox, oy));
        setBlock(p.dsp, scaleBlock(p.dsp.block, k, ox, oy, (nx) => p.end - nx));   // сөз қорабы дәл оң шекке дейін (көршіге шықпайды)
        // кішірейген әріптің табаны слайд шетінен төмен кетпесін (үлкен әріп шетте «кесіліп» қалмасын)
        const over = oy - (H - 300000);
        if (over > 0) {
          for (const sh of [p.ini, p.dsp]) setBlock(sh, sh.block.replace(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/, (m, x, y) => `<a:off x="${x}" y="${+y - over}"/>`));
        }
        p.dsp.x = xfrmOf(p.dsp.block);
        p.limit = p.end - p.dsp.x.x;
      }
      put(p.ini, w ? [w.slice(0, 1)] : [], undefined, false, true);
      put(p.dsp, w.slice(1) ? [w.slice(1)] : [], p.limit, true, true);
    });
    if (content.length) {
      const groups = distributeLines(body, content);
      content.forEach((s, i) => put(s, groups[i]));
    }
    return out;
  }
  // LLM орналасу жоспары (templateLayoutPlan): рөл, кегль, жылжыту — LLM шешеді, сыйғызуды қозғалтқыш қорғайды
  const plan = ctx && ctx.layoutPlan;
  if (plan && plan.assign && content.length) {
    for (const mv of plan.move || []) {
      const o = require('./templateLayout').othersOf(out, W, H).find((x) => x.id === mv.id);
      if (!o) continue;
      const moved = require('./templateLayout').shiftBlock(o.item.block, mv.dx, mv.dy);
      out = out.replace(o.item.block, () => moved); retarget(o.item.block, moved);
    }
    const byId = new Map(plan.assign.map((a) => [a.id, a]));
    content.slice().forEach((s, id) => {
      const a = byId.get(id);
      put(s, a ? a.lines : [], undefined, false, false, a && a.fontPt ? a.fontPt : undefined);
    });
    return out;
  }
  const letters = [...String(title).split(/\s+/), ...String(body[0] || '').split(/\s+/)].map(firstLetter).filter(Boolean);
  initials.forEach((s, i) => put(s, letters[i] ? [letters[i]] : []));

  if (!content.length) return out;
  const titleShape = content[0];
  const bodyShapes = content.slice(1);
  put(titleShape, title ? [title] : []);
  const groups = distributeLines(body, bodyShapes);
  bodyShapes.forEach((s, i) => put(s, groups[i]));
  return out;
}

// ─── Сыйымдылық жоспары: LLM-ге әр слайдқа неше таңба жазуға болатынын айтамыз ───────────
function faceOf(block) {
  const m = block.match(/<a:latin [^>]*typeface="([^"]+)"/);
  return m ? m[1] : '';
}

/** Қорапқа «жайлы» сыятын максимум таңба (кегль comfort*түпнұсқа, бірақ ≥ еден). */
function capacityChars(block, comfort, maxW, growEmu) {
  const tx = txBodyOf(block);
  const bx = boxOf(block);
  if (!tx || !bx) return 0;
  const para = tagBlocks(tx, 'a:p')[0] || '';
  const pPr = elemOf(para, 'a:pPr'), rPr = elemOf(para, 'a:rPr');
  const orig = (+((rPr.match(/ sz="(\d+)"/) || [])[1] || 0)) / 100;
  if (!orig) return 0;
  const bodyPr = elemOf(tx, 'a:bodyPr');
  const inset = (n, d) => { const m = bodyPr.match(new RegExp(' ' + n + '="(\\d+)"')); return (m ? +m[1] : d) / 12700; };
  const wPt = Math.max(10, Math.min(bx.w, maxW || bx.w) / 12700 - inset('lIns', 91440) - inset('rIns', 91440));
  const hPt = Math.max(8, (bx.h + (growEmu || 0)) / 12700 - inset('tIns', 45720) - inset('bIns', 45720));
  const serif = isSerifFace(faceOf(block));
  const floor = orig >= 30 ? Math.max(20, orig * 0.35) : Math.max(11, orig * 0.6);
  const sz = Math.max(Math.min(floor, orig), orig * comfort);
  const ln = spacingOf(pPr, 'lnSpc');
  const origRatio = !ln ? 1.2 : ln.kind === 'spcPts' ? ln.val / 100 / orig : (ln.val / 100000) * 1.2;
  const ratio = Math.min(origRatio, 1.25);
  const avg = (serif ? 0.5 : 0.56) * 1.04;
  const perLine = Math.max(1, Math.floor(wPt / (sz * avg)));
  let lines = Math.max(1, Math.floor(hPt / (ratio * sz)));
  const origTexts = tagBlocks(tx, 'a:p').map((pp) => [...pp.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('')).filter((t) => t.trim());
  const origEst = origTexts.reduce((n, t) => n + countLines(t, orig, wPt, serif, / b="1"/.test(rPr)), 0);
  if (origEst && origEst <= (orig >= 30 ? 3 : 2)) lines = Math.min(lines, orig >= 30 ? origEst + 1 : origEst);   // түпнұсқадағы қатар санынан аспайды
  return Math.max(4, Math.floor(perLine * lines * 0.85));
}

/**
 * Шаблонның әр слайды үшін мәтін бюджеті: [{ split, title:{max,words,wordMax}, items:[max,…] }]
 * fillSlide-пен БІР классификацияны қолданады, сондықтан сан мен рет сәйкес келеді.
 */
/** Бос орын + кедергіні жылжыту арқылы алынатын қосымша орын (LLM бюджеті үшін; жартысын ғана санаймыз). */
function roomFor(xml, block, W, H) {
  const sur = L.surround(xml, block, W, H);
  return Math.max(roomBelow(xml, block, W, H), sur.room) + Math.round(L.nudgeCapacity(sur, W, H) * 0.5);
}

function planTemplateSlots(templateBuf) {
  const files = readZipAll(templateBuf);
  const { W, H } = slideSize(files);
  return orderedSlides(files).map((sp) => {
    const xml = files.get(sp) || '';
    const cl = classify(xml, { W, H });
    if (cl.pairs) {
      // сөз ең көбі LOGO_KMIN-ге дейін кішірейе алады (әріппен бірге) — әріп саны сол бойынша
      const wordMax = cl.pairs.map((p) => {
        const sz = szOf(p.dsp.block) / 100;
        const availPt = (p.end - (p.ini.x.x + (p.dsp.x.x - p.ini.x.x) * LOGO_KMIN)) / 12700;
        const perLine = Math.floor(availPt / (sz * LOGO_KMIN * W_SERIF.up * 1.04 * DISPLAY_SAFETY));
        return Math.max(3, Math.min(14, perLine));
      });
      return {
        split: true,
        title: { words: cl.pairs.length, wordMax: Math.min(...wordMax) },
        items: cl.content.map((s) => capacityChars(s.block, 0.8, undefined, roomFor(xml, s.block, W, H))),
      };
    }
    const [t, ...rest] = cl.content;
    return {
      split: false,
      title: t ? { max: capacityChars(t.block, 0.7, undefined, roomFor(xml, t.block, W, H)) } : null,
      items: rest.map((s) => capacityChars(s.block, 0.8, undefined, roomFor(xml, s.block, W, H))),
    };
  });
}

/** Бір слайдқа арналған қысқа ағылшын нұсқаулық (LLM промптына). */
function slotRuleLine(plan, index) {
  if (!plan) return '';
  const parts = [];
  if (plan.split) {
    parts.push(`title: starts with ${plan.title.words} short striking word(s) (each ≤ ${plan.title.wordMax} letters; they are rendered as giant lettering), then the rest of the title may follow`);
  } else if (plan.title) parts.push(plan.title.max > 0 ? `title ≤ ${plan.title.max} characters` : 'title: ONE short phrase (≤ 60 characters)');
  if (plan.items.length) {
    const mins = plan.items.map(minItemChars);
    const kinds = plan.items.map((n) => slotKind(n).text);
    parts.push(`exactly ${plan.items.length} text item(s) in total — the subtitle (if any) counts as the FIRST item, the rest go to bullets — slot types in order: [${kinds.join(', ')}] — max characters per item in order: [${plan.items.map((n) => (n > 0 ? Math.min(n, 320) : 120)).join(', ')}]${mins.some(Boolean) ? `; at least [${mins.join(', ')}] characters each — a full informative phrase, never a bare one-word label` : ''}`);
  } else parts.push('NO body text (no subtitle, empty bullets)');
  return `Slide ${index}: ${parts.join('; ')}.`;
}

// ─── Толтырудан БҰРЫН/кейін аудит: мәтін шаблон қораптарының лимитіне сәйкес пе? ───────────────
const MAX_ITEM = 320;
const minItemChars = (cap) => (cap >= 150 ? Math.round(Math.min(cap, MAX_ITEM) * 0.5) : cap >= 60 ? Math.max(18, Math.round(cap * 0.25)) : 0);
const ELLIPSIS = /…|\.{3}\s*$/;

/**
 * Таза функция (PPTX керек емес): plan = planTemplateSlots(...) нәтижесі, slides = жаңа мазмұн.
 * Қайтарады: [{ index, issues:[{ code, message, ... }] }] — тек ақауы бар слайдтар.
 * Кодтар: logo_words, logo_word_long, title_long, items_few, items_many, item_long, item_thin, ellipsis.
 */
function auditSlides(plan, slides) {
  const out = [];
  (plan || []).forEach((p, i) => {
    const slide = slides && slides[i];
    if (!p || !slide) return;
    const { title, body } = linesForSlide(slide);
    const issues = [];
    const add = (code, message, extra) => issues.push({ code, message, ...(extra || {}) });
    if (p.split) {
      const words = String(title).split(/[\s:–—-]+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => /\p{L}/u.test(w));
      if (words.length < p.title.words) add('logo_words', `the title must start with ${p.title.words} separate words (it has ${words.length})`, { need: p.title.words });
      words.slice(0, p.title.words).forEach((w) => {
        if (w.length > p.title.wordMax) add('logo_word_long', `title word "${w}" has ${w.length} letters; the maximum is ${p.title.wordMax}`, { word: w, max: p.title.wordMax });
      });
    } else if (p.title && p.title.max > 0 && title.length > p.title.max * 1.1) {
      add('title_long', `title has ${title.length} characters; the maximum is ${p.title.max}`, { max: p.title.max });
    }
    if (ELLIPSIS.test(title)) add('ellipsis', 'the title ends with an ellipsis');
    const caps = p.items || [];
    if (caps.length) {
      if (body.length < caps.length) add('items_few', `the slide has ${body.length} text item(s) but the template needs exactly ${caps.length}`, { need: caps.length });
      else if (body.length > caps.length) add('items_many', `the slide has ${body.length} text items but the template fits exactly ${caps.length}`, { need: caps.length });
      body.forEach((t, j) => {
        const cap = caps[Math.min(j, caps.length - 1)];
        if (ELLIPSIS.test(t)) add('ellipsis', `item ${j + 1} ends with an ellipsis / is cut off`, { item: j + 1 });
        else if (cap > 0 && t.length > Math.min(cap, MAX_ITEM) * 1.1) add('item_long', `item ${j + 1} has ${t.length} characters; the maximum is ${Math.min(cap, MAX_ITEM)}`, { item: j + 1, max: Math.min(cap, MAX_ITEM) });
        else if (t.length < minItemChars(cap)) add('item_thin', `item ${j + 1} ("${t.slice(0, 30)}") has only ${t.length} characters; it must be a full informative phrase of at least ${minItemChars(cap)}`, { item: j + 1, min: minItemChars(cap) });
      });
    }
    if (issues.length) out.push({ index: i + 1, issues });
  });
  return out;
}

function auditTemplateFill(templateBuf, slides) {
  return auditSlides(planTemplateSlots(templateBuf), slides);
}

/**
 * Шаблон PPTX-тің мәтінін slides-тағы жаңа мәтінмен ауыстырады.
 * @param {Buffer} templateBuf — пайдаланушының .pptx файлы
 * @param {Array} slides — жаңа контент (title/subtitle/bullets/stats)
 * @returns {Buffer} — дайын PPTX (дизайн сол қалпында)
 */
function fillTemplatePptx(templateBuf, slides, opts = {}) {
  const files = readZipAll(templateBuf);
  const slidePaths = orderedSlides(files);
  const { W, H } = slideSize(files);
  const badFonts = uncoveredFonts(files);
  const list = Array.isArray(slides) ? slides : [];
  if (slidePaths.length && list.length && slidePaths.length !== list.length) {
    console.warn(`[TemplateFill] слайд саны сәйкес емес: шаблон ${slidePaths.length}, контент ${list.length}`);
  }
  slidePaths.forEach((sp, i) => {
    const xml = files.get(sp);
    if (!xml) return;
    let filled = fillSlide(xml, list[i], { W, H, badFonts, layoutPlan: opts.layout && opts.layout[i] });
    const prob = xmlProblem(filled);
    if (prob) {
      // Бұзылған слайдты ЖІБЕРМЕЙМІЗ: түпнұсқа слайд қалады, қате логқа жазылады
      console.error(`[TemplateFill] ${sp}: XML қате (${prob}) — түпнұсқа слайд сақталды`);
      filled = xml;
    }
    files.set(sp, filled);
  });
  return writeZipAll(files);
}

module.exports = { countLines, textWidthPt, fitLines, fallbackFace, auditSlides, auditTemplateFill, minItemChars, shortenLine, logoScale, scaleBlock, roomBelow, fillTemplatePptx, planTemplateSlots, slotRuleLine, classify, capacityChars, uncoveredFonts, cmapOf, readZipAll, writeZipAll, fillSlide, linesForSlide, replaceShapeText, textShapes };
