'use strict';
/**
 * OPEN IMAGES — кілтсіз (немесе тегін кілтті) ашық сурет базалары. Тек vision жолында қолданылады
 * (кандидатты модель көзбен тексереді — ашық базаларда сапасыз/жат сурет көп).
 *
 *   openverse   — Flickr + Wikimedia + музейлер (CC0 / PDM / CC BY / CC BY-SA). Анонимді: 20/мин, 200/күн →
 *                 OPENVERSE_CLIENT_ID/SECRET болса OAuth токен (лимит жоғары). Өз есептегішімен тежеледі.
 *   nasa        — ғарыш, Жер, ұшу (images-api.nasa.gov, кілтсіз, ~large 1920px)
 *   inaturalist — тірі ағзалар (taxa → таксон фотолары, тек CC0/CC BY/CC BY-SA)
 *   loc         — Library of Congress: Қазақ/Орталық Азия/Ресей империясы тарихы, этнография.
 *                 JSON API 20/мин (асса 1 сағат блок) → 1 сұраныс / 3 с, 429/HTML → 1 сағат үзіліс.
 *   cleveland   — Cleveland Museum of Art, CC0, сурет ≤900px → тек жақтаулы орынға
 *   europeana   — EUROPEANA_API_KEY болса ғана: тарих, ғылым, этнография (open reuse)
 *
 * Әр провайдер: async (query) => [{url, thumb, credit, source, w, h, desc, license}]
 * NC / ND лицензиялар алынбайды: бот ақылы қызмет, ал слайдта сурет кесіледі (өзгертіледі).
 */
const axios = require('axios');

const UA = 'DeadLinePresentationBot/3.2 (https://t.me/ai_presentation_ybot; educational project)';
const PER = 8;
const TIMEOUT = Number(process.env.OPEN_IMAGE_TIMEOUT_MS) || 6000;
const tidy = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
const clip = (q) => String(q || '').trim().slice(0, 80);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Үзіліс (лимит/блок) және жылдамдық тежегіші ──
const pausedUntil = {};
const isPaused = (name) => (pausedUntil[name] || 0) > Date.now();
function pause(name, ms, why) {
  pausedUntil[name] = Date.now() + ms;
  console.warn(`[Image:${name}] paused ${Math.round(ms / 60000)} min (${why})`);
}
const lastCall = {};
async function throttle(name, gapMs) {
  const wait = (lastCall[name] || 0) + gapMs - Date.now();
  lastCall[name] = Date.now() + Math.max(0, wait);
  if (wait > 0) await sleep(wait);
}
function onError(name, err) {
  const st = err.response && err.response.status;
  const html = /text\/html/.test(String(err.response?.headers?.['content-type'] || ''));
  if (st === 429 || (name === 'loc' && (html || st === 403))) pause(name, 60 * 60 * 1000, `HTTP ${st}`);
  throw err;
}

// ── Wikimedia URL-дері: түпнұсқа → стандарт енді кішірейтілген нұсқа (330/500/960/1280/1920 ғана рұқсат) ──
const WM_WIDTHS = [330, 500, 960, 1280, 1920];
function wmSized(url, width) {
  const w = WM_WIDTHS.reduce((best, x) => (Math.abs(x - width) < Math.abs(best - width) ? x : best), WM_WIDTHS[0]);
  const u = String(url || '').split('?')[0];
  const t = u.match(/^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/([^/]+)\/thumb\/([0-9a-f]\/[0-9a-f]{2}\/[^/]+)\/\d+px-[^/]+$/);
  const o = !t && u.match(/^https:\/\/upload\.wikimedia\.org\/wikipedia\/([^/]+)\/([0-9a-f]\/[0-9a-f]{2}\/[^/]+)$/);
  const m = t || o;
  if (!m) return null;
  const file = m[2].split('/').pop();
  const ext = /\.(tiff?|pdf|djvu|svg)$/i.test(file) ? '.jpg' : '';
  return `https://thumb.wikimedia.org/wikipedia/${m[1]}/thumb/${m[2]}/${w}px-${file}${ext}`;
}

// ── Openverse ──
const ovQuota = { day: '', used: 0, minute: 0, minuteAt: 0 };
let ovToken = null; let ovTokenUntil = 0;
async function openverseToken() {
  const id = process.env.OPENVERSE_CLIENT_ID; const secret = process.env.OPENVERSE_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (ovToken && Date.now() < ovTokenUntil) return ovToken;
  try {
    const r = await axios.post('https://api.openverse.org/v1/auth_tokens/token/',
      new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, timeout: TIMEOUT });
    ovToken = r.data && r.data.access_token;
    ovTokenUntil = Date.now() + Math.max(60, (Number(r.data && r.data.expires_in) || 3600) - 120) * 1000;
    return ovToken;
  } catch (err) {
    console.warn(`[Image:openverse] token failed (${err.response?.status || err.message}) — anonymous`);
    return null;
  }
}
function ovAllowed(hasToken) {
  const day = new Date().toISOString().slice(0, 10);
  if (ovQuota.day !== day) { ovQuota.day = day; ovQuota.used = 0; }
  if (Date.now() - ovQuota.minuteAt > 60_000) { ovQuota.minuteAt = Date.now(); ovQuota.minute = 0; }
  if (hasToken) return true;
  return ovQuota.used < 190 && ovQuota.minute < 18; // анонимді лимит: 200/күн, 20/мин
}
async function openverseCandidates(query) {
  const q = clip(query);
  if (!q || isPaused('openverse')) return [];
  const token = await openverseToken();
  if (!ovAllowed(!!token)) return [];
  ovQuota.used += 1; ovQuota.minute += 1;
  let r;
  try {
    r = await axios.get('https://api.openverse.org/v1/images/', {
      params: { q, license: 'cc0,pdm,by,by-sa', aspect_ratio: 'wide', size: 'large', mature: 'false', page_size: 12, filter_dead: 'false' },
      headers: { 'User-Agent': UA, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      timeout: TIMEOUT,
    });
  } catch (err) { return onError('openverse', err); }
  const out = [];
  for (const x of (r.data && r.data.results) || []) {
    const w = Number(x.width) || 0; const h = Number(x.height) || 0;
    let url = x.url; let thumb = '';
    if (x.source === 'wikimedia' || /wikimedia\.org/.test(String(url))) {
      url = wmSized(x.url, 1920); thumb = wmSized(x.url, 500);
      if (!url) continue;
    } else if (/staticflickr\.com/.test(String(url))) {
      // Flickr: _b (1024) – сол «secret»-пен _n (320) кішірейтілгені бар; _h/_k басқа secret → алынбайды
      thumb = String(url).replace(/_[a-z]\.(jpe?g)$/i, '_n.$1');
      if (thumb === url) thumb = String(url).replace(/\.(jpe?g)$/i, '_n.$1');
    } else {
      thumb = x.thumbnail || '';
    }
    out.push({
      url, thumb,
      credit: tidy(x.attribution || `${x.title || ''} — ${x.creator || ''} (${String(x.license || '').toUpperCase()})`),
      source: 'openverse',
      w: /staticflickr/.test(String(url)) ? Math.min(w, 1024) : Math.min(w, 1920),
      h: /staticflickr/.test(String(url)) && w ? Math.round(h * Math.min(1, 1024 / w)) : (w ? Math.round(h * Math.min(1, 1920 / w)) : h),
      desc: tidy([x.title, (x.tags || []).slice(0, 8).map((t) => t && t.name).filter(Boolean).join(', ')].filter(Boolean).join('. ')),
      license: String(x.license || '') + (x.license_version ? ' ' + x.license_version : ''),
    });
  }
  return out;
}

// ── NASA Image and Video Library ──
async function nasaCandidates(query) {
  const q = clip(query);
  if (!q || isPaused('nasa')) return [];
  let r;
  try {
    r = await axios.get('https://images-api.nasa.gov/search', {
      params: { q, media_type: 'image', page_size: PER }, headers: { 'User-Agent': UA }, timeout: TIMEOUT,
    });
  } catch (err) { return onError('nasa', err); }
  const out = [];
  for (const it of (r.data && r.data.collection && r.data.collection.items) || []) {
    const d = (it.data && it.data[0]) || {};
    const id = d.nasa_id;
    const link = (it.links || []).find((l) => /~(medium|small|thumb)\.jpg$/i.test(String(l.href || '')));
    if (!id || !link) continue;
    const base = String(link.href).replace(/~(medium|small|thumb|large|orig)\.jpg$/i, '');
    const lw = Number(link.width) || 0; const lh = Number(link.height) || 0;
    out.push({
      url: base + '~large.jpg',
      thumb: base + '~small.jpg',
      credit: `NASA${d.photographer ? ' / ' + tidy(d.photographer).replace(/^Photographer:\s*/i, '') : ''}`,
      source: 'nasa',
      w: lw ? 1920 : 0, h: lw && lh ? Math.round(1920 * lh / lw) : 0,
      desc: tidy([d.title, d.description].filter(Boolean).join('. ')),
      license: 'NASA (public domain)',
    });
  }
  return out;
}

// ── iNaturalist: таксон → оның үздік фотолары ──
const OK_LICENSE = /^(cc0|cc-by|cc-by-sa)$/i;
async function inaturalistCandidates(query) {
  // ұзын сұраныс («saiga antelope herd in the steppe») емес — тек ағзаның атауы ізделеді
  const raw = String(query || '');
  const q = clip((raw.match(RE_LATIN_BINOMIAL) || raw.match(RE_LIFE) || [''])[0]);
  if (!q || isPaused('inaturalist')) return [];
  let r;
  try {
    r = await axios.get('https://api.inaturalist.org/v1/taxa', {
      params: { q, per_page: 1, is_active: true }, headers: { 'User-Agent': UA }, timeout: TIMEOUT,
    });
    const top = r.data && r.data.results && r.data.results[0];
    if (!top || !top.id) return [];
    r = await axios.get(`https://api.inaturalist.org/v1/taxa/${top.id}`, { headers: { 'User-Agent': UA }, timeout: TIMEOUT });
  } catch (err) { return onError('inaturalist', err); }
  const t = r.data && r.data.results && r.data.results[0];
  if (!t) return [];
  const name = [t.preferred_common_name, t.name].filter(Boolean).join(' / ');
  return (t.taxon_photos || []).map((tp) => tp.photo || {})
    .filter((p) => OK_LICENSE.test(String(p.license_code || '')) && p.original_dimensions)
    .slice(0, PER)
    .map((p) => {
      const ow = p.original_dimensions.width || 0; const oh = p.original_dimensions.height || 0;
      const base = String(p.url || '').replace(/\/(square|small|medium|large|original)\.(jpe?g|png)$/i, '');
      const ext = (String(p.url || '').match(/\.(jpe?g|png)$/i) || [, 'jpg'])[1];
      const big = ow > 1100; // original ≤2048px (~0.3–1.2 MB); large тек 1024px
      const lim = big ? 2048 : 1024;
      return {
        url: `${base}/${big ? 'original' : 'large'}.${ext}`, thumb: `${base}/medium.${ext}`,
        credit: tidy(p.attribution || 'iNaturalist'), source: 'inaturalist',
        w: Math.min(ow, lim), h: ow ? Math.round(oh * Math.min(1, lim / ow)) : 0,
        desc: tidy(`${name}. Photo of the living organism`), license: String(p.license_code || ''),
      };
    });
}

// ── Library of Congress ──
async function locCandidates(query) {
  const q = clip(query);
  if (!q || isPaused('loc')) return [];
  await throttle('loc', 3000);
  let r;
  try {
    r = await axios.get('https://www.loc.gov/photos/', {
      params: { q, fo: 'json', c: 15, at: 'results' }, headers: { 'User-Agent': UA }, timeout: TIMEOUT,
    });
  } catch (err) { return onError('loc', err); }
  if (typeof r.data !== 'object') { pause('loc', 60 * 60 * 1000, 'non-JSON answer'); return []; }
  const out = [];
  for (const x of (r.data && r.data.results) || []) {
    const fmt = [].concat(x.original_format || []).join(' ').toLowerCase();
    if (/book|collection|manuscript|map/.test(fmt) || x.access_restricted) continue;
    const imgs = [].concat(x.image_url || []).filter((u) => /\.(jpe?g)(#|$)|\/default\.jpg/i.test(u));
    if (!imgs.length) continue;
    const last = imgs[imgs.length - 1];
    const dim = String(last).match(/#h=(\d+)&w=(\d+)/);
    let w = dim ? +dim[2] : 0; let h = dim ? +dim[1] : 0;
    let url = last.split('#')[0]; let thumb = imgs[0].split('#')[0];
    if (/\/image-services\/iiif\//.test(url)) {
      url = url.replace(/\/full\/[^/]+\//, '/full/1920,/');
      thumb = url.replace(/\/full\/[^/]+\//, '/full/!500,500/');
      if (w) { h = Math.round(h * 1920 / w); w = 1920; }
    }
    if (w && w < 1000) continue;
    out.push({
      url, thumb, credit: `${tidy([].concat(x.title || '')[0])} — Library of Congress`, source: 'loc', w, h,
      desc: tidy([[].concat(x.title || '')[0], [].concat(x.description || [])[0], [].concat(x.subject || []).slice(0, 6).join(', ')].filter(Boolean).join('. ')),
      license: 'LoC (no known restrictions)',
    });
  }
  return out;
}

// ── Cleveland Museum of Art (CC0, web ~900px) ──
const CMA_SKIP = /^(textile|lace|coins?|jewelry|tools and equipment|carpet|costume|embroidery|garment)$/i;
async function clevelandCandidates(query) {
  const q = clip(query);
  if (!q || isPaused('cleveland')) return [];
  let r;
  try {
    r = await axios.get('https://openaccess-api.clevelandart.org/api/artworks/', {
      params: { q, has_image: 1, cc0: '', limit: PER, fields: 'title,type,creation_date,tombstone,images,culture' },
      headers: { 'User-Agent': UA }, timeout: TIMEOUT,
    });
  } catch (err) { return onError('cleveland', err); }
  return ((r.data && r.data.data) || [])
    .filter((x) => x.images && x.images.web && x.images.web.url && !CMA_SKIP.test(String(x.type || '')))
    .map((x) => ({ x, w: Number(x.images.web.width) || 0, h: Number(x.images.web.height) || 0 }))
    .filter(({ w, h }) => !(w && h && (w / h > 2.2 || w / h < 0.75)))
    .map(({ x, w, h }) => ({
      url: x.images.web.url, thumb: x.images.web.url, credit: tidy(x.tombstone || x.title), source: 'cleveland', w, h,
      desc: tidy([x.title, x.type, [].concat(x.culture || []).join(', '), x.creation_date].filter(Boolean).join('. ')),
      license: 'CC0',
    }));
}

// ── Europeana (тек өз кілтімен: EUROPEANA_API_KEY) ──
async function europeanaCandidates(query) {
  const key = process.env.EUROPEANA_API_KEY;
  const q = clip(query);
  if (!key || !q || isPaused('europeana')) return [];
  const params = new URLSearchParams({ wskey: key, query: q, rows: String(PER), profile: 'rich', media: 'true', thumbnail: 'true', reusability: 'open' });
  ['TYPE:IMAGE', 'IMAGE_SIZE:large', 'IMAGE_SIZE:extra_large', 'IMAGE_ASPECTRATIO:landscape'].forEach((f) => params.append('qf', f));
  let r;
  try {
    r = await axios.get('https://api.europeana.eu/record/v2/search.json?' + params.toString(), { headers: { 'User-Agent': UA }, timeout: TIMEOUT });
  } catch (err) { return onError('europeana', err); }
  const out = [];
  for (const x of (r.data && r.data.items) || []) {
    let url = [].concat(x.edmIsShownBy || [])[0];
    const prev = [].concat(x.edmPreview || [])[0];
    if (!url || !prev || /\.(tiff?|pdf)(\?|$)/i.test(url)) continue;
    if (/\/full\/[^/]+\/0\/default\.jpg/.test(url)) url = url.replace(/\/full\/[^/]+\/0\//, '/full/1920,/0/');
    const title = [].concat(x.title || [])[0];
    out.push({
      url, thumb: prev + (prev.includes('?') ? '&' : '?') + 'size=w400',
      credit: tidy(`${title || ''} — ${[].concat(x.dataProvider || [])[0] || ''} via Europeana`), source: 'europeana', w: 0, h: 0,
      desc: tidy([title, [].concat(x.dcDescription || [])[0]].filter(Boolean).join('. ')),
      license: String([].concat(x.rights || [])[0] || ''),
    });
  }
  return out;
}

const OPEN_PROVIDERS = {
  openverse: openverseCandidates,
  nasa: nasaCandidates,
  inaturalist: inaturalistCandidates,
  loc: locCandidates,
  cleveland: clevelandCandidates,
  europeana: europeanaCandidates,
};

// ── Маршрут: сұраныс түріне қарай қай базалар сұралады ──
const RE_SPACE = /\b(space|nasa|astronaut|cosmonaut|rocket|satellite|orbit|planet|mars|moon|lunar|jupiter|saturn|galaxy|nebula|star|stars|telescope|solar system|sun|comet|asteroid|iss|space station|baikonur|earth from space|hubble|aurora|hurricane|volcano from space|aviation|aircraft)\b/i;
// нақты ағза атауы (жалпы «animal/plant/tree» емес — ондай сұраныспен iNaturalist кездейсоқ таксон береді)
const RE_LIFE = /\b(snow leopard|golden eagle|saiga|antelope|butterfly|mushroom|eagle|falcon|wolf|fox|bear|tiger|leopard|deer|marmot|frog|snake|lizard|owl|crane|flamingo|tulip|poppy|cactus|fern|orchid|coral|whale|dolphin|shark|sturgeon|beetle|spider|bee|honeybee|squirrel|hedgehog|hare|lynx|ibex|argali|bustard|pelican|swan|seal|walrus|penguin|elephant|giraffe|zebra|lion|cheetah|gorilla|chimpanzee|panda|koala|kangaroo|octopus|jellyfish|starfish|sunflower|oak|pine|birch|spruce|maple|lotus|rose|apricot|apple tree|wheat|barley|cotton plant|saxaul|tamarisk|feather grass|lichen|moss)\b/i;
const RE_LATIN_BINOMIAL = /\b[A-Z][a-z]{3,} [a-z]{2,}(?:us|a|um|is|ii|ae|ensis|ica|ata|oides|ina|ana|ea|ia)\b/; // Saiga tatarica, Panthera uncia
const RE_HISTORY = /\b(history|historical|ancient|medieval|century|centuries|empire|khan|khanate|horde|nomad|nomadic|yurt|steppe|silk road|caravan|war|battle|revolution|soviet|ussr|tsar|tsarist|imperial|dynasty|archaeolog\w*|petroglyph|burial|kurgan|museum|artifact|artefact|manuscript|painting|portrait|engraving|lithograph|monument|mausoleum|fortress|ethnograph\w*|tradition|traditional|costume|kazakh|kyrgyz|uzbek|turkic|mongol|central asia|1[0-9]{3}s?)\b/i;
const RE_ART = /\b(art|painting|paintings|artwork|sculpture|ceramic|pottery|miniature|calligraphy|ornament|textile art|fresco|mosaic|icon|museum|islamic art|persian|watercolou?r|etching|drawing)\b/i;

/**
 * @param {string} query
 * @param {{named?: boolean}} [opts]
 * @returns {string[]} ашық провайдер аттары (Openverse әрқашан бірінші; басқалары тақырыбы сай болса)
 */
function routeOpen(query, opts = {}) {
  const q = String(query || '');
  const out = ['openverse'];
  if (RE_SPACE.test(q)) out.push('nasa');
  if (RE_LIFE.test(q) || RE_LATIN_BINOMIAL.test(q)) out.push('inaturalist');
  if (RE_HISTORY.test(q) || opts.named) out.push('loc');
  if (RE_ART.test(q) || (RE_HISTORY.test(q) && /painting|portrait|art|ancient|medieval|museum|artifact/i.test(q))) out.push('cleveland');
  if (process.env.EUROPEANA_API_KEY && (RE_HISTORY.test(q) || RE_ART.test(q) || opts.named || /science|cell|microscop|chemistr|molecule|anatomy|medicine/i.test(q))) out.push('europeana');
  const off = String(process.env.OPEN_IMAGE_SOURCES_OFF || '').split(',').map((s) => s.trim()).filter(Boolean);
  return out.filter((n) => !off.includes(n));
}

module.exports = { OPEN_PROVIDERS, routeOpen, wmSized, isPaused, pause };
