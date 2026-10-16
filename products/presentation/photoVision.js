'use strict';
/**
 * PHOTO VISION — кандидат суреттерді vision-модель КӨЗБЕН қарап таңдайды (сипаттамасына емес, суреттің өзіне).
 *
 * Бұрынғы photoJudge тек alt/tags мәтінін оқитын: «ноутбук ұстаған жігіт» деген сипаттама жоқ сурет те, бұлыңғыр,
 * қараңғы, су таңбалы, коллаж сурет те өтіп кететін. Енді әр кандидаттың кішірейтілген нұсқасы (≈400px) слайд
 * мәтінімен бірге Gemini Flash-Lite-қа беріледі. Модель әр суретке:
 *   fit    0–10 — осы слайдтың нақты тақырыбын көрсете ме (photoJudge-тың ережесі)
 *   appeal 0–10 — әдемі ме: анық, жарық, түсі қанық, композициясы мықты, коллаж/су таңба/мәтін жоқ
 *   bg     0–10 — бүкіл слайдтың фоны бола ала ма (тек фон орны үшін маңызды)
 *   focus  "x% y%" — басты нысан қай жерде (кесілмеуі үшін)
 * қояды. fit ≥ MIN_FIT өткендер ішінен fit пен appeal-дың салмақты қосындысы ең жоғарысы алынады.
 *
 * Құны (gemini-3.5-flash-lite, $0.30 / 1M кіріс, $2.50 шығыс): ≤384px сурет ≈ 258 токен → 12 кандидат + мәтін ≈ 3.7k
 * токен + ~0.9k жауап ≈ $0.0034 ≈ 1.7₸ бір слайдқа (2.5-flash-lite жаңа кілттерге берілмейді). Кілт жоқ / қате → null: шақырушы мәтіндік photoJudge-қа өтеді.
 */
const axios = require('axios');
const { geminiJson, hasGoogleKey } = require('../../core/googleAi');
const { deepseekVisionJson } = require('../../core/llm');

/**
 * Суретті көретін модель: GOOGLE_API_KEY болса — Gemini Flash-Lite, әйтпесе DEEPSEEK_API_KEY арқылы deepseek-flash
 * (V4.1-Flash суретті көреді — бөлек кілт керек емес). PHOTO_VISION_PROVIDER=gemini|deepseek — қолмен таңдау.
 */
function visionProvider() {
  const want = String(process.env.PHOTO_VISION_PROVIDER || '').toLowerCase();
  if (want === 'deepseek') return process.env.DEEPSEEK_API_KEY ? 'deepseek' : null;
  if (want === 'gemini') return hasGoogleKey() ? 'gemini' : null;
  if (hasGoogleKey()) return 'gemini';
  return process.env.DEEPSEEK_API_KEY ? 'deepseek' : null;
}
const hasVision = () => !!visionProvider();
/** parts: [{text}] | [{image:{mime,data,url}}] → таңдалған модель → JSON */
async function visionJson(parts, opts) {
  const prov = visionProvider();
  if (prov === 'gemini') {
    return geminiJson(parts.map((p) => (p.image ? { inline_data: { mime_type: p.image.mime, data: p.image.data } } : { text: p.text })), opts);
  }
  if (prov === 'deepseek') return deepseekVisionJson(parts, opts);
  return null;
}
const { imageUA } = require('./unsplash');

const MIN_FIT = Number(process.env.PHOTO_VISION_MIN_FIT) || 7;
const MIN_APPEAL = Number(process.env.PHOTO_VISION_MIN_APPEAL) || 5;
const MIN_BG = 6;
const MAX_PER_CALL = Number(process.env.PHOTO_VISION_BATCH) || 12;
const THUMB_MAX_BYTES = 700_000; // музей «web» нұсқасы ~600KB; токен саны пиксельге байланысты, байтқа емес

const SYSTEM = `You are the photo editor of a student presentation. You SEE numbered candidate photos for ONE slide and score each one. Return JSON only:
{"photos":[{"i":0,"fit":0,"appeal":0,"bg":0,"focus":"50% 40%","flaw":""}, ...]} — one entry per photo, same numbers.
fit (0-10): does the photo SHOW this slide's subject? Judge the slide content, not the search query.
  10 = exactly the slide's subject: the named person, event, artwork, place, object, organism or process, or a real scene directly about it (for history: period artworks, archive photos, maps, museum objects of that subject).
  7-8 = a real scene a viewer immediately connects with this slide's point.
  4-6 = same broad field but not this slide's point.
  0-3 = generic stand-in (smiling person with laptop, handshake, office, posing students) for a specific subject; wrong country, era, species, object or person; modern reenactors for a real historical event; metaphor/decoration (light bulb, puzzle, chess, crossroads).
appeal (0-10): how beautiful and usable it is on a big screen: sharp, well exposed, vivid natural colour, clear single subject, strong composition, depth. Low (0-4): blurry, noisy, dark/murky, washed out, tiny object on blank backdrop, cluttered, collage/grid, screenshot, scanned text page, heavy caption/watermark/logo, cheesy stock pose, obvious AI artefacts.
bg (0-10): would it work as a FULL-SLIDE BACKGROUND behind a title (wide scene with calm areas)? Small object on plain background, close-up texture, portrait-format crop, busy detail everywhere → 0-3.
focus: where the main subject is, as "x% y%" (0% 0% = top-left), so cropping keeps it.
flaw: one or two words if something is wrong (e.g. "watermark", "text", "blurry", "wrong era"), else "".
Be strict and honest: a slide without a photo is better than a wrong or ugly photo.`;

const short = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

// ── Кішірейтілген нұсқаларды жүктеу (кэшпен) ──
const thumbCache = new Map();
const THUMB_CACHE_MAX = 600;
async function fetchThumb(url) {
  if (!url) return null;
  if (thumbCache.has(url)) return thumbCache.get(url);
  let out = null;
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer', timeout: 8000, maxContentLength: THUMB_MAX_BYTES * 3,
      headers: { 'User-Agent': imageUA(url), Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8' },
      validateStatus: (s) => s === 200,
    });
    const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const buf = Buffer.from(res.data);
    if (/^image\/(jpeg|png|webp)$/.test(type) && buf.length <= THUMB_MAX_BYTES) out = { mime: type, data: buf.toString('base64') };
  } catch { /* кандидат өткізіледі */ }
  if (out) { // сәтсіздік кэштелмейді: уақытша 429/желі қатесі сол суретті мәңгі «улап» тастамасын
    thumbCache.set(url, out);
    if (thumbCache.size > THUMB_CACHE_MAX) thumbCache.delete(thumbCache.keys().next().value);
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** Салмақты балл: сай болуы басты, әдемілігі екінші; фон орнында фонға жарамдылығы да қосылады */
function rankScore(s, background) {
  return s.fit * 0.6 + s.appeal * 0.4 + (background ? s.bg * 0.15 : 0);
}

function normFocus(f) {
  const m = String(f || '').match(/(\d{1,3})%?\s*[, ]\s*(\d{1,3})%?/);
  if (!m) return '';
  return Math.min(100, +m[1]) + '% ' + Math.min(100, +m[2]) + '%';
}

/**
 * @param {{topic?:string, title?:string, text?:string, query?:string, cover?:boolean, background?:boolean, maxCalls?:number}} ctx
 * @returns {null | ((cands: Array<{url:string, thumb?:string, desc?:string, source?:string}>) => Promise<Array<{i:number, fit:number, appeal:number, bg:number, focus:string, flaw:string, score:number}>|null>)}
 *   null → vision қолжетімсіз (кілт жоқ). Функция: сайлары (MIN_FIT өткен) ең жақсысы бірінші; null → шақыру сәтсіз.
 */
function makeVisionChooser(ctx = {}) {
  if (!hasVision() || process.env.PHOTO_VISION === '0') return null;
  const subject = [short(ctx.topic, 160), short(ctx.title, 140), ctx.background ? 'bg' : 'frame'].join(' / ');
  const cache = new Map(); // url → scores (осы слайд үшін)
  let calls = 0;
  let apiFailures = 0;
  const maxCalls = ctx.maxCalls || 3;

  async function scoreBatch(batch) {
    const thumbs = await mapLimit(batch, 6, (c) => fetchThumb(c.thumb || c.url));
    const shown = batch.map((c, k) => ({ c, t: thumbs[k] })).filter((x) => x.t);
    if (!shown.length) return;
    if (calls >= maxCalls) return;
    calls += 1;
    const parts = [{ text: SYSTEM + '\n\n'
      + `Presentation topic: ${short(ctx.topic, 200) || '-'}\n`
      + `Slide${ctx.cover ? ' (cover or closing)' : ''}: ${short(ctx.title, 160) || '-'}\n`
      + (ctx.text ? `Slide says: ${short(ctx.text, 400)}\n` : '')
      + (ctx.background ? 'Placement: the photo FILLS THE WHOLE SLIDE behind the title (bg matters).\n' : 'Placement: the photo sits in a frame next to the text.\n')
      + `Search query used: ${short(ctx.query, 160) || '-'}\n\nCandidates:` }];
    shown.forEach((x, k) => {
      parts.push({ text: `Photo ${k}${x.c.desc ? ` (archive caption: ${short(x.c.desc, 120)})` : ''}:` });
      parts.push({ image: { mime: x.t.mime, data: x.t.data, url: x.c.thumb || x.c.url } });
    });
    const out = await visionJson(parts, { label: 'photo:vision', maxTokens: 60 * shown.length + 200, timeoutMs: 25_000 });
    const rows = Array.isArray(out && out.photos) ? out.photos : (Array.isArray(out) ? out : []);
    if (!rows.length) { // шақыру сәтсіз → бағаланбады (кэшке «жоқ» деп жазылмайды)
      apiFailures += 1;
      console.warn(`[PhotoVision] "${short(ctx.title, 50)}" ${visionProvider()} gave no scores (${out ? 'keys: ' + Object.keys(out).slice(0, 4).join(',') : 'no reply'})`);
      return;
    }
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0; };
    shown.forEach((x, k) => {
      const r = rows.find((q) => q && Number(q.i) === k) || rows[k] || null;
      cache.set(x.c.url, r ? { fit: num(r.fit), appeal: num(r.appeal), bg: num(r.bg), focus: normFocus(r.focus), flaw: short(r.flaw, 40) } : null);
    });
    const best = shown.map((x) => ({ x, s: cache.get(x.c.url) })).filter((y) => y.s).sort((a, b) => rankScore(b.s, ctx.background) - rankScore(a.s, ctx.background))[0];
    console.log(`[PhotoVision] "${short(ctx.title, 50)}" ${ctx.background ? 'bg' : 'frame'} n=${shown.length} `
      + `fit=[${shown.map((x) => (cache.get(x.c.url) || {}).fit ?? '-').join(',')}] `
      + (best ? `best=${best.x.c.source || ''} fit=${best.s.fit} appeal=${best.s.appeal}${best.s.flaw ? ' flaw=' + best.s.flaw : ''}` : 'best=none'));
  }

  async function choose(cands) {
    if (!Array.isArray(cands) || !cands.length) return [];
    const todo = cands.filter((c) => c && c.url && !cache.has(c.url));
    for (let k = 0; k < todo.length && calls < maxCalls; k += MAX_PER_CALL) {
      try { await scoreBatch(todo.slice(k, k + MAX_PER_CALL)); } catch (err) { console.warn(`[PhotoVision] failed: ${err.message}`); }
    }
    // API шынымен сәтсіз болып, бірде-біреуі бағаланбаса ғана → резерв (мәтіндік тексеру). Кішірейтілген нұсқа
    // жүктелмесе не шақыру шегі бітсе — «сай сурет жоқ» ([]), vision-мен жұмыс істеп тұрған слайд резервке түспейді.
    if (apiFailures && todo.length && todo.every((c) => !cache.has(c.url))) return null;
    return cands
      .map((c, i) => ({ i, s: cache.get(c.url) }))
      .filter((x) => x.s && x.s.fit >= MIN_FIT && x.s.appeal >= MIN_APPEAL && (!ctx.background || x.s.bg >= MIN_BG))
      .map((x) => ({ i: x.i, ...x.s, score: rankScore(x.s, ctx.background) }))
      .sort((a, b) => b.score - a.score || a.i - b.i);
  }
  choose.scoreOf = (c) => (c && cache.has(c.url) ? cache.get(c.url) : null);
  choose.calls = () => calls;
  return choose;
}

/**
 * Жасалған (AI) суретті тексеру: слайдқа сай ма, бұрмаланған мәтін/қол/бет жоқ па.
 * @returns {Promise<{ok:boolean, fit:number, appeal:number, flaw:string}|null>}
 */
async function checkGenerated(dataUri, ctx = {}) {
  if (!hasVision()) return null;
  const m = String(dataUri || '').match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) return null;
  const parts = [
    { text: `${SYSTEM}\n\nThis photo was AI-generated for the slide below. Also set "flaw" to "text" if it contains any letters/words/numbers, "artefact" for distorted hands/faces/objects or melted details, "fake" if it looks obviously artificial.\n`
      + `Presentation topic: ${short(ctx.topic, 200) || '-'}\nSlide: ${short(ctx.title, 160) || '-'}\n${ctx.text ? `Slide says: ${short(ctx.text, 400)}\n` : ''}Photo 0:` },
    { image: { mime: m[1], data: m[2] } },
  ];
  const out = await visionJson(parts, { label: 'photo:gen-check', maxTokens: 200 });
  const r = Array.isArray(out && out.photos) ? out.photos[0] : null;
  if (!r) return null;
  const fit = Number(r.fit) || 0; const appeal = Number(r.appeal) || 0; const flaw = short(r.flaw, 40);
  return { ok: fit >= MIN_FIT && appeal >= 6 && !/text|artefact|artifact|fake/i.test(flaw), fit, appeal, flaw };
}

module.exports = { visionProvider, makeVisionChooser, checkGenerated, rankScore, normFocus, fetchThumb, SYSTEM, MIN_FIT };
