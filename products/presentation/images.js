'use strict';

/**
 * Multi-source image search for presentations (v3.1 fix).
 *
 * Негізгі өзгерістер:
 *  - Әр провайдер БІРНЕШЕ кандидат қайтарады; жүктеу сәтсіз болса келесі кандидатқа өтеді
 *    (бұрын тек бірінші табылған сурет алынып, жүктелмесе — слайд суретсіз қалатын).
 *  - Wikimedia енді ең соңында (әдепкі). Ол кез келген сұранысқа "бірдеңе" тауып, Pexels/Unsplash-қа
 *    жол бермейтін, нәтиже тақырыпқа сәйкес келмейтін. Ретті IMAGE_PROVIDER_ORDER арқылы өзгертуге болады.
 *  - Тым кішкентай суреттер (ені < IMAGE_MIN_WIDTH, әдепкі 900px) алынбайды — layout оларды үнсіз тастайтын.
 *  - Pixabay: largeImageURL (1280px), бұрынғы webformatURL (640px) бұлыңғыр болатын.
 *  - Pexels: large2x (~1880px).
 *  - Wikimedia нәтижелері релевантылық (page.index) бойынша сұрыпталады.
 *  - Бір презентация ішінде бір сурет қайталанбайды (`used` Set).
 *
 * Never invent images. Returns { dataUri, url, credit, source } or null.
 */

const axios = require('axios');
const { downloadAsDataUri } = require('./unsplash');

const MAX_Q = 80;
const PER_PROVIDER = 5;
const MAX_DOWNLOAD_ATTEMPTS = 6;
const MIN_W = Number(process.env.IMAGE_MIN_WIDTH) || 900;
const UA = 'DeadLinePresentationBot/3.1 (educational project)';
const DEFAULT_ORDER = ['pexels', 'unsplash', 'pixabay', 'wikimedia'];

function staticOrder() {
  const fromEnv = String(process.env.IMAGE_PROVIDER_ORDER || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter((s) => DEFAULT_ORDER.includes(s));
  return fromEnv.length ? fromEnv : DEFAULT_ORDER;
}

// ── Quota-aware provider queue ─────────────────────────────────────────────
// Pexels (~200 search/hour) and Unsplash (50/hour on a demo key) both report the remaining quota in response
// headers. We always ask the provider with MORE quota left, pause a provider for a while when it says "limit
// reached" (429/403), and keep the last few calls for paying users (free decks fall back to cache/Wikimedia).
const DEFAULT_LIMIT = { pexels: Number(process.env.PEXELS_HOURLY_LIMIT) || 200, unsplash: Number(process.env.UNSPLASH_HOURLY_LIMIT) || 50 };
const RESERVE = { pexels: 20, unsplash: 6 };      // calls kept for paid decks
const KEYED = { pexels: 'PEXELS_API_KEY', unsplash: 'UNSPLASH_ACCESS_KEY', pixabay: 'PIXABAY_API_KEY' };
const quota = {};
const stats = { calls: {}, cacheHits: 0, limited: {}, since: Date.now() };
function q0(name) { return quota[name] || (quota[name] = { remaining: null, resetAt: 0, coolUntil: 0 }); }
function noteHeaders(name, headers) {
  const st = q0(name); const h = headers || {};
  const rem = Number(h['x-ratelimit-remaining']);
  if (Number.isFinite(rem)) st.remaining = rem;
  const reset = Number(h['x-ratelimit-reset']);  // Pexels: unix seconds
  if (Number.isFinite(reset) && reset > 1e9) st.resetAt = reset * 1000;
  else if (!st.resetAt || st.resetAt < Date.now()) st.resetAt = Date.now() + 60 * 60 * 1000; // Unsplash: hourly window
}
function noteLimited(name, headers) {
  const st = q0(name);
  noteHeaders(name, headers);
  st.remaining = 0;
  st.coolUntil = Math.max(Date.now() + 15 * 60 * 1000, st.resetAt || 0);
  stats.limited[name] = (stats.limited[name] || 0) + 1;
  console.warn(`[Image:${name}] limit reached — paused until ${new Date(st.coolUntil).toISOString().slice(11, 16)} UTC`);
}
function left(name) {
  const st = q0(name);
  if (st.resetAt && Date.now() > st.resetAt) { st.remaining = null; st.resetAt = 0; } // new window
  return st.remaining == null ? (DEFAULT_LIMIT[name] || 100) : st.remaining;
}
/** Providers to ask, best first. `free` decks never spend the reserve of the keyed providers. */
function providerOrder(opts = {}) {
  const now = Date.now();
  const base = staticOrder().filter((n) => !KEYED[n] || process.env[KEYED[n]]);
  const ok = base.filter((n) => !(q0(n).coolUntil > now) && !(opts.free && RESERVE[n] != null && left(n) <= RESERVE[n]));
  const keyed = ok.filter((n) => DEFAULT_LIMIT[n] != null).sort((a, b) => left(b) - left(a));
  return keyed.concat(ok.filter((n) => DEFAULT_LIMIT[n] == null));
}

// ── Caches: the same school topics come back all day, so most searches/downloads repeat ──
const SEARCH_TTL = 24 * 60 * 60 * 1000; const EMPTY_TTL = 60 * 60 * 1000; const SEARCH_MAX = 800;
const searchCache = new Map();
const DL_MAX_BYTES = (Number(process.env.IMAGE_CACHE_MB) || 80) * 1024 * 1024;
const dlCache = new Map(); let dlBytes = 0;
function cacheGet(map, key) { const v = map.get(key); if (v === undefined) return undefined; map.delete(key); map.set(key, v); return v; }
async function searchProvider(name, query, budget) {
  const key = name + '|' + query.toLowerCase();
  const hit = cacheGet(searchCache, key);
  if (hit && Date.now() - hit.at < (hit.cands.length ? SEARCH_TTL : EMPTY_TTL)) { stats.cacheHits += 1; return hit.cands; }
  if (budget && budget.left <= 0) return [];
  if (budget) budget.left -= 1;
  stats.calls[name] = (stats.calls[name] || 0) + 1;
  const cands = await PROVIDERS[name](query);
  searchCache.set(key, { at: Date.now(), cands });
  if (searchCache.size > SEARCH_MAX) searchCache.delete(searchCache.keys().next().value);
  return cands;
}
async function downloadCached(url) {
  const hit = cacheGet(dlCache, url);
  if (hit) { stats.cacheHits += 1; return hit; }
  const data = await downloadAsDataUri(url);
  if (data) {
    dlCache.set(url, data); dlBytes += data.length;
    while (dlBytes > DL_MAX_BYTES && dlCache.size) { const k = dlCache.keys().next().value; dlBytes -= dlCache.get(k).length; dlCache.delete(k); }
  }
  return data;
}
/** For /stats: provider quota and usage since start. */
function imageStats() {
  const out = { since: stats.since, cacheHits: stats.cacheHits, searchCacheSize: searchCache.size, imageCacheMB: Math.round(dlBytes / 1048576), providers: {} };
  for (const n of Object.keys(KEYED).concat(['wikimedia'])) {
    if (KEYED[n] && !process.env[KEYED[n]]) continue;
    const st = q0(n);
    out.providers[n] = { calls: stats.calls[n] || 0, remaining: DEFAULT_LIMIT[n] != null ? left(n) : null, paused: st.coolUntil > Date.now() ? new Date(st.coolUntil).toISOString() : null, limited: stats.limited[n] || 0 };
  }
  return out;
}

function queryVariants(query) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const variants = [];
  const push = (q) => {
    const s = String(q || '').trim().replace(/\s+/g, ' ').slice(0, MAX_Q);
    if (s && !variants.includes(s)) variants.push(s);
  };
  push(raw);
  push(raw.split(',')[0]);
  const stop = new Set([
    'with', 'and', 'the', 'a', 'an', 'at', 'in', 'on', 'of', 'for', 'to', 'from',
    'dramatic', 'cinematic', 'moody', 'soft', 'wide', 'shot', 'light', 'lighting',
    'hour', 'background', 'style', 'shallow', 'depth', 'field', 'high', 'detail',
    'warm', 'cool', 'teal', 'orange', 'blue', 'golden', 'muted', 'documentary',
  ]);
  const words = raw.split(',')[0].split(/\s+/).filter((w) => w.length > 2 && !stop.has(w.toLowerCase()));
  if (words.length >= 2) push(words.slice(0, 5).join(' '));
  if (words.length >= 1) push(words.slice(0, 3).join(' '));
  return variants.slice(0, 4);
}

/** true → тек латын әріптері бар (ағылшынша) сұраныс. Кирилл (қазақша/орысша) болса false. */
function isLatinQuery(q) {
  const t = String(q || '').trim();
  if (t.length < 2) return false;
  if (/[\u0400-\u052F]/.test(t)) return false;
  return /[A-Za-z]{2,}/.test(t);
}

/** "#rrggbb" → 0..1 жарықтық. Түсі белгісіз болса null. */
function lumOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
// орташа түсі тым қараңғы (қап-қара кадр) сурет слайдта көрінбейді → алмаймыз
const tooDark = (c) => { const l = lumOf(c.avg); return l != null && l < 0.035; };

const clip = (query) => String(query || '').trim().slice(0, MAX_Q);

// ── Провайдерлер: әрқайсысы кандидаттар массивін қайтарады [{url, credit, source, w}] ──

async function wikimediaCandidates(query) {
  const q = clip(query);
  if (!q) return [];
  const response = await axios.get('https://commons.wikimedia.org/w/api.php', {
    params: {
      action: 'query', format: 'json', origin: '*',
      generator: 'search', gsrsearch: q, gsrlimit: 10, gsrnamespace: 6,
      prop: 'imageinfo', iiprop: 'url|mime|size', iiurlwidth: 1280,
    },
    timeout: 12000,
    headers: { 'User-Agent': UA },
  });
  const pages = Object.values(response.data?.query?.pages || {});
  pages.sort((a, b) => (a.index || 0) - (b.index || 0)); // релевантылық ретімен
  const out = [];
  for (const page of pages) {
    const info = page.imageinfo && page.imageinfo[0];
    if (!info) continue;
    if (!/^image\/(jpeg|png|webp)$/i.test(String(info.mime || ''))) continue;
    if (/\b(logo|icon|flag|coat of arms|signature|seal)\b/i.test(String(page.title || ''))) continue;
    const url = info.thumburl || info.url;
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (!info.thumburl && info.size && info.size > 2_500_000) continue;
    out.push({
      url,
      credit: page.title ? String(page.title).replace(/^File:/i, '') : 'Wikimedia Commons',
      source: 'wikimedia',
      w: info.width || 0,
    });
  }
  return out;
}

async function pexelsCandidates(query) {
  const key = process.env.PEXELS_API_KEY;
  const q = clip(query);
  if (!key || !q) return [];
  let response;
  try {
    response = await axios.get('https://api.pexels.com/v1/search', {
      params: { query: q, per_page: PER_PROVIDER, orientation: 'landscape' },
      headers: { Authorization: key },
      timeout: 10000,
    });
  } catch (err) {
    if (err.response && err.response.status === 429) noteLimited('pexels', err.response.headers);
    throw err;
  }
  noteHeaders('pexels', response.headers);
  return (response.data?.photos || [])
    .map((p) => ({
      url: p.src?.large2x || p.src?.large,
      credit: p.photographer || 'Pexels',
      source: 'pexels',
      w: p.width || 0,
      avg: p.avg_color,
    }))
    .filter((c) => c.url);
}

async function unsplashCandidates(query) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  const q = clip(query);
  if (!key || !q) return [];
  let response;
  try {
    response = await axios.get('https://api.unsplash.com/search/photos', {
      params: { query: q, per_page: PER_PROVIDER, orientation: 'landscape', content_filter: 'high' },
      headers: { Authorization: `Client-ID ${key}` },
      timeout: 10000,
    });
  } catch (err) {
    const st = err.response && err.response.status;
    if (st === 429 || (st === 403 && Number(err.response.headers['x-ratelimit-remaining']) === 0)) noteLimited('unsplash', err.response.headers);
    throw err;
  }
  noteHeaders('unsplash', response.headers);
  return (response.data?.results || [])
    .map((r) => ({
      url: r.urls?.regular,
      credit: r.user?.name || 'Unsplash',
      source: 'unsplash',
      w: r.width || 0,
      avg: r.color,
    }))
    .filter((c) => c.url);
}

async function pixabayCandidates(query) {
  const key = process.env.PIXABAY_API_KEY;
  const q = clip(query);
  if (!key || !q) return [];
  const response = await axios.get('https://pixabay.com/api/', {
    params: { key, q, image_type: 'photo', orientation: 'horizontal', safesearch: 'true', per_page: PER_PROVIDER },
    timeout: 10000,
  });
  return (response.data?.hits || [])
    .map((h) => ({
      url: h.largeImageURL || h.webformatURL, // 1280px; webformatURL тек 640px
      credit: h.user ? `Pixabay/${h.user}` : 'Pixabay',
      source: 'pixabay',
      w: h.largeImageURL ? Math.min(1280, h.imageWidth || 1280) : 640,
    }))
    .filter((c) => c.url);
}

const PROVIDERS = {
  pexels: pexelsCandidates,
  unsplash: unsplashCandidates,
  pixabay: pixabayCandidates,
  wikimedia: wikimediaCandidates,
};

/**
 * Суретті табады ЖӘНЕ жүктейді. Жүктеу сәтсіз болса — келесі кандидатқа/провайдерге/сұраныс нұсқасына өтеді.
 * @param {string} query
 * @param {{used?: Set<string>, free?: boolean, budget?: {left:number}}} [opts]
 *   used — осы презентацияда алынған URL-дер (қайталанбау үшін); free — тегін колода (резервті жемейді);
 *   budget — осы фотоға рұқсат етілген API іздеу саны (кэш тегін), бірнеше шақыру арасында ортақ
 * @returns {Promise<{dataUri:string,url:string,credit:string,source:string}|null>}
 */
async function findImage(query, opts = {}) {
  if (!isLatinQuery(query)) {
    console.warn(`[Image] skipped non-English query: "${String(query || '').slice(0, 50)}"`);
    return null;
  }
  const used = opts.used instanceof Set ? opts.used : new Set();
  const variants = queryVariants(query);
  if (!variants.length) return null;
  const order = providerOrder({ free: !!opts.free });
  const budget = opts.budget || { left: 4 };
  let attempts = 0;

  for (const q of variants) {
    if (budget.left <= 0 && ![...order].some((n) => searchCache.has(n + '|' + q.toLowerCase()))) break;
    for (const name of order) {
      let cands = [];
      try {
        cands = await searchProvider(name, q, budget);
      } catch (err) {
        console.warn(`[Image:${name}] search failed (${err.response?.status || err.code || err.message}) q="${q.slice(0, 40)}"`);
        continue;
      }
      for (const c of cands) {
        if (!c.url || used.has(c.url)) continue;
        if (c.w && c.w < MIN_W) continue;
        if (tooDark(c)) continue;
        if (attempts >= MAX_DOWNLOAD_ATTEMPTS) {
          console.log(`[Image] gave up after ${attempts} download attempts for "${String(query).slice(0, 60)}"`);
          return null;
        }
        attempts += 1;
        used.add(c.url); // параллель тапсырмалар бір URL-ді алмауы үшін — жүктемес бұрын белгілейміз
        const dataUri = await downloadCached(c.url);
        if (dataUri) {
          console.log(`[Image] ok source=${c.source} q="${q.slice(0, 50)}"`);
          return { dataUri, url: c.url, credit: c.credit, source: c.source };
        }
      }
    }
  }
  console.log(`[Image] no image for "${String(query).slice(0, 60)}"`);
  return null;
}

// ── Ескі API (үйлесімділік үшін): бірінші кандидатты ғана қайтарады ──
async function firstOf(fn, query) {
  try {
    const list = await fn(query);
    return list.find((c) => !c.w || c.w >= MIN_W) || null;
  } catch (err) {
    console.warn(`[Image] ${err.message}`);
    return null;
  }
}
const searchWikimedia = (q) => firstOf(wikimediaCandidates, q);
const searchPexels = (q) => firstOf(pexelsCandidates, q);
const searchPixabay = (q) => firstOf(pixabayCandidates, q);

async function searchImageMulti(query) {
  for (const q of queryVariants(query)) {
    for (const name of providerOrder()) {
      const hit = await firstOf(PROVIDERS[name], q);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Слайдтың imageQuery-і бос/сәтсіз болғанда қолданылатын резерв сұраныстар тізімі.
 * Pexels/Unsplash/Pixabay қазақша/орысша сұранысты түсінбейді (кездейсоқ сурет қайтарады),
 * сондықтан тақырып тек латын әріптерінен тұрса ғана қолданылады; әйтпесе презентациядағы
 * басқа слайдтардың ағылшынша сұраныстары алынады.
 */
function fallbackQueries(query, topic, deckQueries = []) {
  const out = [];
  const add = (q) => {
    const t = String(q || '').trim();
    if (t && isLatinQuery(t) && !out.includes(t)) out.push(t);
  };
  add(query);
  const clean = String(topic || '')
    .split(/[\n\r]+/)[0]
    .replace(/\b\d+\s*-?\s*слайд\b\.?/gi, ' ')
    .replace(/\b(қазақша|русский|орысша|english|аудитория|тақырып)\b\s*:?/gi, ' ')
    .replace(/\s+/g, ' ').trim();
  const letters = clean.match(/\p{L}/gu) || [];
  const latin = clean.match(/[A-Za-z]/g) || [];
  if (clean.length >= 3 && letters.length && latin.length / letters.length > 0.7) add(clean.slice(0, 60));
  for (const q of deckQueries) add(q);
  return out;
}

module.exports = {
  imageStats,
  providerOrder,
  isLatinQuery,
  fallbackQueries,
  findImage,
  searchImageMulti,
  searchWikimedia,
  searchPexels,
  searchPixabay,
  queryVariants,
  downloadAsDataUri,
};
