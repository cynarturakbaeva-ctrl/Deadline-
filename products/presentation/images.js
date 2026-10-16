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
const { imageMeta } = require('./design/analyze');

const MAX_Q = 80;
const PER_PROVIDER = 5;
const MAX_DOWNLOAD_ATTEMPTS = 6;
const STRONG_SCORE = 9; // осындай баллды сурет табылса, келесі көзді сұрамаймыз
const MIN_W = Number(process.env.IMAGE_MIN_WIDTH) || 900;
const UA = 'DeadLinePresentationBot/3.2 (https://t.me/ai_presentation_ybot; educational project)'; // Wikimedia саясаты: байланыс көрсетілсін
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
function q0(name) { return quota[name] || (quota[name] = { calls: [], hourLeft: null, hourAt: 0, monthLeft: null, monthResetAt: 0, coolUntil: 0 }); }
const HOUR = 60 * 60 * 1000;
function recentCalls(name) { const st = q0(name); const t = Date.now() - HOUR; st.calls = st.calls.filter((x) => x > t); return st.calls; }
function noteCall(name) { q0(name).calls.push(Date.now()); }
/**
 * Pexels headers describe the MONTHLY quota (X-Ratelimit-Remaining ≈ 25 000, Reset = month end); its hourly
 * limit (~200) is not reported, so we count our own calls of the last hour. Unsplash headers are hourly.
 */
function noteHeaders(name, headers) {
  const st = q0(name); const h = headers || {};
  const rem = Number(h['x-ratelimit-remaining']);
  if (!Number.isFinite(rem)) return;
  if (name === 'pexels') {
    st.monthLeft = rem;
    const reset = Number(h['x-ratelimit-reset']);
    if (Number.isFinite(reset) && reset > 1e9) st.monthResetAt = reset * 1000;
  } else {
    st.hourLeft = rem; st.hourAt = Date.now();
  }
}
function noteLimited(name, headers) {
  const st = q0(name);
  noteHeaders(name, headers);
  const oldest = recentCalls(name)[0] || Date.now();
  if (name === 'pexels' && st.monthLeft === 0 && st.monthResetAt > Date.now()) st.coolUntil = st.monthResetAt; // month used up
  else st.coolUntil = Math.max(Date.now() + 10 * 60 * 1000, oldest + HOUR);                               // hourly limit
  if (name !== 'pexels') st.hourLeft = 0;
  stats.limited[name] = (stats.limited[name] || 0) + 1;
  console.warn(`[Image:${name}] limit reached — paused until ${new Date(st.coolUntil).toISOString().slice(0, 16).replace('T', ' ')} UTC`);
}
/** Searches we can still make this hour (and this month, when known). */
function left(name) {
  const st = q0(name);
  const used = recentCalls(name).length;
  let hour = (DEFAULT_LIMIT[name] || 100) - used;
  if (st.hourLeft != null && Date.now() - st.hourAt < HOUR) hour = Math.min(hour, st.hourLeft);
  return Math.max(0, st.monthLeft != null ? Math.min(hour, st.monthLeft) : hour);
}
/** Providers to ask, best first. `free` decks never spend the reserve of the keyed providers. */
function providerOrder(opts = {}) {
  const now = Date.now();
  let base = staticOrder().filter((n) => !KEYED[n] || process.env[KEYED[n]]);
  // атаулы тақырып (тұлға, оқиға, картина, жыл) → алдымен архив: стоктарда олар жоқ, бірақ «ұқсас» бірдеңе береді
  if (opts.named && base.includes('wikimedia')) base = ['wikimedia'].concat(base.filter((n) => n !== 'wikimedia'));
  const ok = base.filter((n) => !(q0(n).coolUntil > now) && !(opts.free && RESERVE[n] != null && left(n) <= RESERVE[n]));
  const keyed = ok.filter((n) => DEFAULT_LIMIT[n] != null).sort((a, b) => left(b) - left(a));
  const rest = ok.filter((n) => DEFAULT_LIMIT[n] == null);
  if (opts.named && rest[0] === 'wikimedia') return ['wikimedia'].concat(keyed, rest.slice(1));
  return keyed.concat(rest);
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
  noteCall(name);
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
    out.providers[n] = {
      calls: stats.calls[n] || 0,
      hourLeft: DEFAULT_LIMIT[n] != null ? left(n) : null,
      monthLeft: st.monthLeft,
      paused: st.coolUntil > Date.now() ? new Date(st.coolUntil).toISOString() : null,
      limited: stats.limited[n] || 0,
    };
  }
  return out;
}

// Сұраныстағы «стиль» сөздері: фото-сайттар оларға да сәйкестендіреді → тақырыпқа қатысы жоқ сурет келеді
const STYLE_WORDS = new Set([
  'dramatic', 'cinematic', 'moody', 'soft', 'wide', 'shot', 'light', 'lighting', 'lit', 'daylight', 'sunlight', 'midday',
  'hour', 'background', 'style', 'shallow', 'depth', 'field', 'high', 'detail', 'detailed', 'angle', 'medium', 'close', 'closeup',
  'warm', 'cool', 'teal', 'orange', 'blue', 'golden', 'muted', 'documentary', 'candid', 'photography', 'photo', 'photograph',
  'mood', 'atmosphere', 'ambience', 'vibe', 'feeling', 'tone', 'composition', 'clean', 'bright', 'natural', 'sunny', 'day',
  'inspiring', 'joyful', 'hopeful', 'optimistic', 'focused', 'peaceful', 'calm', 'empowered', 'proud', 'festive', 'friendly',
  'encouraging', 'professional', 'formal', 'academic', 'serene', 'vibrant', 'colorful', 'beautiful', 'elegant', 'modern', 'view',
  'concept', 'conceptual', 'abstract', 'representing', 'symbolizing', 'afternoon', 'morning', 'evening', 'window', 'quiet',
]);
const STOP_WORDS = new Set(['with', 'and', 'the', 'a', 'an', 'at', 'in', 'on', 'of', 'for', 'to', 'from', 'into', 'over', 'under', 'by', 'or', 'its', 'their', 'his', 'her', 'each', 'other', 'together', 'while', 'during', 'through', 'across', 'about', 'some', 'two', 'three', 'group', 'people']);
const isStyleWord = (w) => STYLE_WORDS.has(w.toLowerCase()) || STOP_WORDS.has(w.toLowerCase());

// Фотосы болмайтын нәрселер: іздеу жүйесі бұларға кездейсоқ бизнес-слайд, флипчарт, коллаж қайтарады
const NO_PHOTO_WORDS = /\b(collages?|diagrams?|infographics?|charts?|graphs?|comparisons?|montages?|split[- ]screen|side[- ]by[- ]side)\b/gi;
const NAME = "[A-Z][A-Za-z'’-]+(?:\\s+[A-Z][A-Za-z'’-]+)*";
// «Abai Kunanbayev and Al-Farabi portraits» — екі атаулы адамның бірге түскен суреті жоқ → біріншісі ғана қалады
const TWO_NAMED = new RegExp(`(${NAME})\\s+(?:and|&|vs\\.?|versus)\\s+${NAME}`);

/** «subject, warm golden hour lighting, inspiring mood» → «subject»: тек стиль сөздерінен тұратын бөліктер алынады. */
function cleanQuery(query) {
  const parts = String(query || '').split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  const keep = parts.filter((p, i) => i === 0 || p.split(/\s+/).some((w) => w.length > 2 && !isStyleWord(w.replace(/[^A-Za-z-]/g, ''))));
  return keep.join(' ').replace(TWO_NAMED, '$1').replace(NO_PHOTO_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Атаулы нәрселер: «Florence Nightingale», «Crimean War», «Silk Road», жыл (1855). Сөйлемнің бірінші сөзі
 * жалғыз бас әріппен тұрса — атау емес («Diverse people…»).
 */
function namedPhrases(query) {
  const words = String(query || '').replace(/[,;:()]/g, ' ').split(/\s+/).filter(Boolean);
  const out = []; let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const first = cur[0].i === 0;
    if (!(first && cur.length === 1)) out.push(cur.map((x) => x.w).join(' '));
    cur = [];
  };
  words.forEach((w, i) => {
    if (/^(1[0-9]{3}|20[0-2][0-9])s?$/.test(w)) { flush(); out.push(w); return; }
    if (/^[A-Z][a-zA-Z'’-]+$/.test(w) && !(i > 0 && STOP_WORDS.has(w.toLowerCase()))) cur.push({ w, i });
    else flush();
  });
  flush();
  return out;
}
// архив сұранысына жарамсыз жалпы сөздер / архивте жақсы табылатын түрлер
const VAGUE_WORDS = new Set(['historical', 'history', 'ancient', 'classic', 'classical', 'traditional', 'old', 'famous', 'national', 'historic', 'vintage', 'real']);
const MEDIUM_WORDS = new Set(['painting', 'portrait', 'map', 'manuscript', 'engraving', 'photograph', 'statue', 'monument', 'battle', 'fresco', 'mosaic', 'sculpture', 'building', 'mosque', 'mausoleum', 'fortress', 'museum']);
const isNamedQuery = (query) => namedPhrases(query).length > 0;
// Жер/халық атаулары — «нақты тұлға/оқиға» емес: «Kazakh steppe», «Almaty street» AI-мен жасалуы мүмкін
const PLACE_OK = new Set(('kazakh kazakhs kazakhstan almaty astana shymkent karaganda aktobe taraz pavlodar semey atyrau turkistan '
  + 'asia asian central europe european africa african america american russia russian china chinese japan japanese korea korean '
  + 'india indian turkey turkish uzbek uzbekistan kyrgyz kyrgyzstan mongolia mongolian arab arabic islamic muslim english british '
  + 'french german italian spanish earth sun moon mars caspian aral altai tian shan balkhash').split(' '));
/**
 * Нақты тұлға / оқиға / туынды ма (AI-мен ЖАСАУҒА болмайды — жалған тарих болады)?
 * Жыл, екі+ сөзді атау («Crimean War», «Abai Kunanbayev») немесе жер/халық емес жалғыз атау («Abai», «Napoleon»).
 */
function isRealSubject(query) {
  return namedPhrases(query).some((n) => /^(1[0-9]{3}|20[0-2][0-9])s?$/.test(n)
    || !n.split(' ').every((w) => PLACE_OK.has(w.toLowerCase())));
}

function queryVariants(query) {
  const raw = cleanQuery(query);
  if (!raw) return [];
  const variants = [];
  const push = (q) => {
    const s = String(q || '').trim().replace(/\s+/g, ' ').slice(0, MAX_Q);
    if (s && !variants.includes(s)) variants.push(s);
  };
  push(raw);
  const words = raw.split(/\s+/).filter((w) => w.length > 2 && !isStyleWord(w));
  const named = namedPhrases(raw);
  if (named.length) {
    // «Florence Nightingale Scutari» — архивте ұзын сұраныс ештеңе таппайды, атаулар + бір зат есім табады
    const inNamed = (w) => named.some((n) => n.split(' ').includes(w));
    const rest = words.filter((w) => !inNamed(w) && !VAGUE_WORDS.has(w.toLowerCase()));
    const extra = rest.find((w) => MEDIUM_WORDS.has(w.toLowerCase())) || rest[0];
    const base = named.join(' ');
    push(base + (extra && base.split(' ').length < 4 ? ' ' + extra : ''));
    push(base);
    // «Chokan Valikhanov» ↔ «Shokan Ualikhanov» — транслитерация әр түрлі: архивтер тегі бойынша жақсы табады
    const first = named[0].split(' ');
    if (first.length >= 2 && first.length <= 3 && !first.some((w) => PLACE_OK.has(w.toLowerCase()) || /^(1[0-9]{3}|20[0-2][0-9])s?$/.test(w))) variants.splice(2, 0, first[first.length - 1]);
  }
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
/** Сурет сипаттамасы (alt / tags / Wikimedia атауы) — тексеруші модельге және логқа */
const tidy = (t) => String(t || '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);

// ── Провайдерлер: әрқайсысы кандидаттар массивін қайтарады [{url, credit, source, w}] ──

/**
 * Wikimedia сурет URL-і (upload./thumb. хост, ?utm сұраныс жолымен де) → сол файлдың стандарт енді нұсқасы.
 * Wikimedia енді тек 330/500/960/1280/1920 енін береді (480/640 → HTTP 400). Танылмаса — URL өзгеріссіз.
 */
function wikiThumb(url, width) {
  return wmSized(url, width) || String(url || '');
}

async function wikimediaCandidates(query) {
  const q = clip(query);
  if (!q) return [];
  let response;
  try {
    response = await axios.get('https://commons.wikimedia.org/w/api.php', {
    params: {
      action: 'query', format: 'json', origin: '*',
      generator: 'search', gsrsearch: q, gsrlimit: 10, gsrnamespace: 6,
      prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: 1920,
      iiextmetadatafilter: 'ImageDescription|ObjectName', iiextmetadatalanguage: 'en',
    },
      timeout: 8000,
      headers: { 'User-Agent': UA },
    });
  } catch (err) {
    if (err.response && err.response.status === 429) noteLimited('wikimedia', err.response.headers); // үзіліс, қайта-қайта ұрмаймыз
    throw err;
  }
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
    // скан бет, ұзын плакат, тік жолақ — слайдқа сыймайды (портрет кадрға ғана жарайды)
    if (info.width && info.height && info.height > info.width * 1.6) continue;
    const meta = info.extmetadata || {};
    const name = String(page.title || '').replace(/^File:/i, '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_/g, ' ');
    const about = [meta.ObjectName && meta.ObjectName.value, meta.ImageDescription && meta.ImageDescription.value]
      .filter(Boolean).map((v) => String(v).replace(/<[^>]+>/g, ' ')).join('. ');
    out.push({
      url,
      thumb: wikiThumb(url, 500),
      credit: page.title ? String(page.title).replace(/^File:/i, '') : 'Wikimedia Commons',
      source: 'wikimedia',
      w: Math.min(info.width || 0, 1920),
      h: info.width && info.height ? Math.round(info.height * Math.min(1, 1920 / info.width)) : 0,
      desc: tidy(name + (about ? '. ' + about : '')),
    });
  }
  // тұрақты сұрыптау: көлденең кадр алдымен (фон/үлкен панельге жарайды), релевант реті сақталады
  return out.map((c, i) => ({ c, i, tall: c.h > c.w ? 1 : 0 })).sort((a, b) => a.tall - b.tall || a.i - b.i).map((x) => x.c);
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
      thumb: p.src?.medium || p.src?.small || '',
      credit: p.photographer || 'Pexels',
      source: 'pexels',
      w: p.width || 0,
      avg: p.avg_color,
      desc: tidy(p.alt),
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
      // regular = 1080px — үлкен панельде бұлыңғыр; raw + w=1920 (Unsplash CDN өзі кішірейтеді)
      url: r.urls?.raw ? r.urls.raw + (r.urls.raw.includes('?') ? '&' : '?') + 'w=1920&q=75&fm=jpg&fit=max' : r.urls?.regular,
      thumb: r.urls?.small || '',
      credit: r.user?.name || 'Unsplash',
      source: 'unsplash',
      w: r.urls?.raw ? Math.min(r.width || 0, 1920) : Math.min(r.width || 0, 1080),
      avg: r.color,
      desc: tidy([r.alt_description, r.description, (r.tags || []).map((t) => t && t.title).filter(Boolean).join(', ')].filter(Boolean).join('. ')),
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
      thumb: h.webformatURL || '',
      credit: h.user ? `Pixabay/${h.user}` : 'Pixabay',
      source: 'pixabay',
      w: h.largeImageURL ? Math.min(1280, h.imageWidth || 1280) : 640,
      desc: tidy(h.tags),
    }))
    .filter((c) => c.url);
}

const { OPEN_PROVIDERS, routeOpen, wmSized } = require('./openImages');
const PROVIDERS = {
  pexels: pexelsCandidates,
  unsplash: unsplashCandidates,
  pixabay: pixabayCandidates,
  wikimedia: wikimediaCandidates,
  ...OPEN_PROVIDERS,
};

/**
 * Суретті табады ЖӘНЕ жүктейді. Жүктеу сәтсіз болса — келесі кандидатқа/провайдерге/сұраныс нұсқасына өтеді.
 * @param {string} query
 * @param {{used?: Set<string>, free?: boolean, budget?: {left:number}}} [opts]
 *   used — осы презентацияда алынған URL-дер (қайталанбау үшін); free — тегін колода (резервті жемейді);
 *   budget — осы фотоға рұқсат етілген API іздеу саны (кэш тегін), бірнеше шақыру арасында ортақ
 * @returns {Promise<{dataUri:string,url:string,credit:string,source:string}|null>}
 */
/** Қарапайым түбір: soldiers→soldier, charging→charg, studies→study */
function stem(w) {
  let t = String(w || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (t.length > 4 && t.endsWith('ies')) t = t.slice(0, -3) + 'y';
  else if (t.length > 5 && t.endsWith('ing')) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith('ed')) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith('es') && /(ch|sh|ss|x)es$/.test(t)) t = t.slice(0, -2);
  else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
  return t;
}
const keyTerms = (query) => [...new Set(cleanQuery(query).split(/\s+/).filter((w) => w.length > 2 && !isStyleWord(w)).map(stem).filter((t) => t.length > 2))];

/**
 * Резерв тексеру (тексеруші модель қолжетімсіз болса): сипаттамада сұраныстың кемінде бір мағыналы сөзі болуы керек.
 * Сипаттамасы мүлде жоқ топтама (ескі провайдер) — бұрынғыдай өткізіледі.
 */
function lexicalFit(cands, query) {
  if (!cands.some((c) => c.desc)) return cands.map((_, i) => i);
  const terms = keyTerms(query);
  const scored = cands.map((c, i) => {
    const words = new Set(String(c.desc || '').split(/[^A-Za-z0-9]+/).map(stem).filter(Boolean));
    return { i, score: terms.filter((t) => words.has(t)).length };
  });
  return scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.i);
}

/**
 * Суретті табады ЖӘНЕ жүктейді. Жүктеу сәтсіз болса — келесі кандидатқа/провайдерге/сұраныс нұсқасына өтеді.
 * opts.judge берілсе: әр топтама алдымен тексеріледі (сипаттамасы слайдқа сай ма) — сай келмесе алынбайды.
 * @param {string} query
 * @param {{used?: Set<string>, free?: boolean, budget?: {left:number}, judge?: (cands: object[], q: string) => Promise<number[]|null>}} [opts]
 *   used — осы презентацияда алынған URL-дер (қайталанбау үшін); free — тегін колода (резервті жемейді);
 *   budget — осы фотоға рұқсат етілген API іздеу саны (кэш тегін), бірнеше шақыру арасында ортақ;
 *   judge — кандидаттардан сайларының индекстерін (ең жақсысы бірінші) қайтарады; null → сөздік резерв тексеру
 * @returns {Promise<{dataUri:string,url:string,credit:string,source:string,desc?:string}|null>}
 */
async function findImage(query, opts = {}) {
  if (!isLatinQuery(query)) {
    console.warn(`[Image] skipped non-English query: "${String(query || '').slice(0, 50)}"`);
    return null;
  }
  const used = opts.used instanceof Set ? opts.used : new Set();
  const variants = queryVariants(query);
  if (!variants.length) return null;
  const order = providerOrder({ free: !!opts.free, named: isNamedQuery(query) });
  const budget = opts.budget || { left: 4 };
  let attempts = 0;
  let rejected = 0;

  const judged = typeof opts.judge === 'function';
  for (const q of variants) {
    if (budget.left <= 0 && ![...order].some((n) => searchCache.has(n + '|' + q.toLowerCase()))) break;
    // Бір нұсқа бойынша бірнеше көздің мақұлданған кандидаттары бір жерге жиналады, ең жоғары баллдысы алынады
    // (бұрын бірінші мақұлданған көздің бірінші суреті алынатын, келесі көздегі 10 балдық сурет қаралмайтын).
    const pool = [];
    for (const name of order) {
      let cands = [];
      try {
        cands = await searchProvider(name, q, budget);
      } catch (err) {
        console.warn(`[Image:${name}] search failed (${err.response?.status || err.code || err.message}) q="${q.slice(0, 40)}"`);
        continue;
      }
      let fresh = cands.filter((c) => c.url && !used.has(c.url) && !pool.some((x) => x.c.url === c.url) && !(c.w && c.w < MIN_W) && !tooDark(c));
      if (!fresh.length) continue;
      if (!judged) { fresh.forEach((c) => pool.push({ c, s: 0, k: pool.length })); break; }
      let pick = null;
      try { pick = await opts.judge(fresh, query); } catch (err) { console.warn(`[Image] judge failed: ${err.message}`); }
      const lexical = !Array.isArray(pick);
      // модель бар, бірақ жауап бермеді (шек бітті/қате) → сөздік сәйкестікке сенбейміз: «Kazakhstan» сөзі бар
      // шоколад қорабы, «portraits» сөзі бар кеңес басшыларының суреті осылай кіретін. Сайы дәлелденбеген сурет — жоқ.
      if (lexical && typeof opts.judge.live === 'function' && opts.judge.live()) {
        console.log(`[Image] judge unavailable — ${fresh.length} unverified photo(s) skipped source=${name} q="${q.slice(0, 50)}"`);
        rejected += fresh.length;
        continue;
      }
      if (lexical) pick = lexicalFit(fresh, query);
      const chosen = pick.filter((i) => Number.isInteger(i) && fresh[i]).map((i) => fresh[i]);
      rejected += fresh.length - chosen.length;
      if (!chosen.length) { console.log(`[Image] off-topic ×${fresh.length} source=${name} q="${q.slice(0, 50)}" e.g. "${String(fresh[0].desc || '').slice(0, 60)}"`); continue; }
      // сөздік тексерудің «баллы» жоқ — модель мақұлдағандардан төмен тұрады
      chosen.forEach((c) => {
        const sc = !lexical && typeof opts.judge.scoreOf === 'function' ? opts.judge.scoreOf(c) : null;
        pool.push({ c, s: sc == null ? 6.5 : sc, k: pool.length });
      });
      if (Math.max(...pool.map((x) => x.s)) >= STRONG_SCORE) break; // нақты сай сурет табылды — артық іздемейміз
    }
    pool.sort((a, b) => b.s - a.s || a.k - b.k);
    if (judged && pool.length) console.log(`[Image] pool ${pool.length} best=${pool[0].s} source=${pool[0].c.source} q="${q.slice(0, 50)}"`);
    for (const { c } of pool) {
      if (used.has(c.url)) continue;
      if (attempts >= MAX_DOWNLOAD_ATTEMPTS) {
        console.log(`[Image] gave up after ${attempts} download attempts for "${String(query).slice(0, 60)}"`);
        return null;
      }
      attempts += 1;
      used.add(c.url); // параллель тапсырмалар бір URL-ді алмауы үшін — жүктемес бұрын белгілейміз
      const dataUri = await downloadCached(c.url);
      if (dataUri) {
        console.log(`[Image] ok source=${c.source} q="${q.slice(0, 50)}"${c.desc ? ` photo="${c.desc.slice(0, 80)}"` : ''}`);
        return { dataUri, url: c.url, credit: c.credit, source: c.source, desc: c.desc || '' };
      }
    }
  }
  console.log(`[Image] no image for "${String(query).slice(0, 60)}"${rejected ? ` (${rejected} off-topic rejected)` : ''}`);
  return null;
}

/** Әр көздің тізімінен кезекпен бір-бірден: топтамада бір көз басым болмайды (ең жақсылары алдымен) */
function interleave(lists) {
  const out = []; const seen = new Set();
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let k = 0; k < max; k++) {
    for (const l of lists) {
      const c = l[k];
      if (c && c.url && !seen.has(c.url)) { seen.add(c.url); out.push(c); }
    }
  }
  return out;
}

const VISION_BATCH = Number(process.env.PHOTO_VISION_BATCH) || 12;
const OPEN_SEARCHES_PER_PHOTO = Number(process.env.OPEN_SEARCHES_PER_PHOTO) || 8;
const PROVIDER_TIMEOUT_MS = Number(process.env.IMAGE_PROVIDER_TIMEOUT_MS) || 10000;

/** Бір суреттің әртүрлі URL-дері (Openverse арқылы Wikimedia, ?w= параметрлі Unsplash) бір кілтке келеді */
function canonKey(url) {
  const u = String(url || '');
  let m = u.match(/wikimedia\.org\/wikipedia\/[^/]+\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?]+)/);
  if (m) { try { return 'wm:' + decodeURIComponent(m[1]).toLowerCase(); } catch { return 'wm:' + m[1].toLowerCase(); } }
  if ((m = u.match(/pexels\.com\/photos\/(\d+)/))) return 'px:' + m[1];
  if ((m = u.match(/images\.unsplash\.com\/(photo-[\w-]+)/))) return 'us:' + m[1];
  if ((m = u.match(/staticflickr\.com\/\d+\/(\d+)_/))) return 'fl:' + m[1];
  if ((m = u.match(/inaturalist-open-data\.s3\.amazonaws\.com\/photos\/(\d+)\//))) return 'in:' + m[1];
  if ((m = u.match(/images-assets\.nasa\.gov\/image\/([^/]+)\//))) return 'na:' + m[1];
  if ((m = u.match(/pixabay\.com\/get\/([\w]+)/))) return 'pb:' + m[1];
  return u.split('?')[0];
}

/** Орынға жарамдылық: фон (бүкіл слайд) ≥1536px әрі көлденең; жақтау — MIN_W. Өлшемі белгісіз → жүктелген соң тексеріледі */
function fitsPlace(meta, place) {
  if (!meta || !meta.w) return true;
  if (place === 'bg') return meta.w >= 1536 && !(meta.h && meta.w / meta.h < 1.15);
  return meta.w >= MIN_W;
}

function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timeout ${ms}ms ${label}`)), ms); })])
    .finally(() => clearTimeout(t));
}

/**
 * VISION жолы: бір сұраныс нұсқасы бойынша барлық лайықты көздерден (стоктар + архив + ашық базалар) кандидат
 * ПАРАЛЛЕЛЬ жиналады (әр көзге уақыт шегі бар), vision-модель кішірейтілген нұсқаларын КӨРІП бағалайды,
 * ең жақсысы толық өлшемде жүктеледі және нақты өлшемі орынға сай екені тексеріледі.
 * Сай сурет болмаса — келесі нұсқа (ең көбі opts.maxVariants, мерзім ішінде), сосын null (шақырушы AI суретке/суретсізге өтеді).
 * @param {string} query
 * @param {{used?:Set<string>, avoid?:Set<string>, free?:boolean, budget?:{left:number}, vision:Function, maxVariants?:number,
 *          place?:'bg'|'frame', deadline?:number}} opts
 *   avoid — осы студенттің бұрынғы презентацияларындағы суреттер (canonKey): басқа таңдау болса қайталанбайды
 * @returns {Promise<{dataUri:string,url:string,key:string,credit:string,source:string,desc:string,focus:string,fit:number,appeal:number}|null|{failed:true}>}
 *   {failed:true} → vision шақыруы сәтсіз (желі/кілт): шақырушы мәтіндік тексеру жолына өтеді
 */
async function findImageVision(query, opts = {}) {
  if (!isLatinQuery(query) || typeof opts.vision !== 'function') return null;
  const used = opts.used instanceof Set ? opts.used : new Set();
  const avoid = opts.avoid instanceof Set ? opts.avoid : new Set();
  const place = opts.place === 'bg' ? 'bg' : 'frame';
  const named = isNamedQuery(query);
  const keyed = providerOrder({ free: !!opts.free, named });
  const open = routeOpen(query, { named }).filter((n) => PROVIDERS[n] && !keyed.includes(n));
  const order = keyed.concat(open);
  const budget = opts.budget || { left: 4 };
  const openBudget = { left: OPEN_SEARCHES_PER_PHOTO };
  const variants = queryVariants(query).slice(0, (opts.maxVariants || 2) + (named ? 1 : 0)); // атаулыға +1 (тегі бойынша)
  const taken = (c) => used.has(c.url) || used.has(canonKey(c.url));
  let attempts = 0;
  for (const q of variants) {
    if (opts.deadline && Date.now() > opts.deadline) { console.log(`[Image] vision: deadline reached for "${String(query).slice(0, 50)}"`); break; }
    const lists = await Promise.all(order.map((name) => withTimeout(searchProvider(name, q, KEYED[name] ? budget : openBudget), PROVIDER_TIMEOUT_MS, name)
      .catch((err) => { console.warn(`[Image:${name}] search failed (${err.response?.status || err.code || err.message}) q="${q.slice(0, 40)}"`); return []; })));
    const seenKey = new Set();
    let pool = interleave(lists).filter((c) => {
      const k = canonKey(c.url);
      if (seenKey.has(k)) return false;
      seenKey.add(k);
      return !taken(c) && !(c.w && c.w < MIN_W) && fitsPlace(c, place) && !tooDark(c);
    });
    // студенттің бұрынғы суреттері — басқа таңдау жеткілікті болса шығарылады
    const fresh = pool.filter((c) => !avoid.has(canonKey(c.url)));
    if (fresh.length >= 4) pool = fresh;
    if (!pool.length) continue;
    const batch = pool.slice(0, VISION_BATCH);
    if (pool.length > batch.length) console.log(`[Image] vision batch ${batch.length}/${pool.length} (rest not shown) q="${q.slice(0, 50)}"`);
    const ranked = await opts.vision(batch);
    if (ranked === null) return { failed: true };
    for (const r of ranked) {
      const c = batch[r.i];
      if (!c || taken(c)) continue;
      if (attempts >= MAX_DOWNLOAD_ATTEMPTS) return null;
      attempts += 1;
      const key = canonKey(c.url);
      used.add(c.url); used.add(key); // параллель слайдтар бір суретті алмауы үшін — жүктемес бұрын белгілейміз
      const dataUri = await downloadCached(c.url);
      if (!dataUri) continue;
      const meta = imageMeta(dataUri);
      if (!fitsPlace(meta, place)) { console.log(`[Image] ${c.source} real size ${meta.w}x${meta.h} too small for ${place} — next`); continue; }
      console.log(`[Image] ok source=${c.source} vision fit=${r.fit} appeal=${r.appeal} ${meta.w}x${meta.h} q="${q.slice(0, 50)}"${c.desc ? ` photo="${c.desc.slice(0, 80)}"` : ''}`);
      return { dataUri, url: c.url, key, credit: c.credit || '', license: c.license || '', source: c.source, desc: c.desc || '', focus: r.focus || '', fit: r.fit, appeal: r.appeal };
    }
  }
  console.log(`[Image] vision: nothing fits "${String(query).slice(0, 60)}" (${place})`);
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
  findImageVision,
  interleave,
  wikiThumb,
  canonKey,
  fitsPlace,
  searchImageMulti,
  searchWikimedia,
  searchPexels,
  searchPixabay,
  queryVariants,
  cleanQuery,
  namedPhrases,
  isNamedQuery,
  isRealSubject,
  lexicalFit,
  unsplashCandidates,
  wikimediaCandidates,
  downloadAsDataUri,
};
