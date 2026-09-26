'use strict';

const axios = require('axios');

const MAX_IMAGE_BYTES = 1_500_000;   // бір сурет ≤ 1.5MB (HTML-ге base64 болып ендіріледі → +33%)
const DL_TIMEOUT_MS   = 12_000;

/**
 * Unsplash-тан бір сурет табады. Қайтарады: { url, downloadLocation, credit } немесе null.
 * (Unsplash API ережесі: сурет көрсетілгенде download endpoint-ін шақыру керек.)
 */
/** Build short Unsplash-friendly query variants (long cinematic prompts often return 0). */
function queryVariants(query) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const variants = [];
  const push = (q) => {
    const s = String(q || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    if (s && !variants.includes(s)) variants.push(s);
  };
  push(raw.slice(0, 120));
  // Drop after first comma — models often append lighting jargon after comma
  const beforeComma = raw.split(',')[0];
  push(beforeComma);
  // Keep 3–5 content words (skip pure mood words)
  const stop = new Set(['with','and','the','a','an','at','in','on','of','for','to','from','dramatic','cinematic','moody','soft','wide','shot','light','lighting','hour','background','style','shallow','depth','field','high','detail','warm','cool','teal','orange','blue','golden']);
  const words = beforeComma.split(/\s+/).filter((w) => w.length > 2 && !stop.has(w.toLowerCase()));
  if (words.length >= 2) push(words.slice(0, 4).join(' '));
  if (words.length >= 1) push(words.slice(0, 2).join(' '));
  return variants.slice(0, 4);
}

async function searchOnce(cleanQuery) {
  const response = await axios.get('https://api.unsplash.com/search/photos', {
    params: { query: cleanQuery, per_page: 3, orientation: 'landscape', content_filter: 'high' },
    headers: { Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` },
    timeout: 10000,
  });
  const result = response.data?.results?.[0];
  const url = result?.urls?.regular;
  if (!url) return null;
  return { url, credit: result.user?.name || null };
}

async function searchImage(query) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    console.log('[Unsplash] skipped: empty query');
    return null;
  }
  const variants = queryVariants(query);
  if (!process.env.UNSPLASH_ACCESS_KEY) {
    console.warn('[Unsplash] UNSPLASH_ACCESS_KEY missing');
    return null;
  }

  for (const cleanQuery of variants) {
    try {
      const hit = await searchOnce(cleanQuery);
      if (hit) {
        if (cleanQuery !== variants[0]) {
          console.log(`[Unsplash] fallback hit for "${cleanQuery}" (original was longer)`);
        }
        return hit;
      }
      console.log(`[Unsplash] no image found for "${cleanQuery}"`);
    } catch (error) {
      const status = error.response?.status;
      console.warn(`[Unsplash] failed (${status || error.code || 'unknown'}) for "${cleanQuery}"`);
      if (status === 403 || status === 401) {
        const remaining = error.response?.headers?.['x-ratelimit-remaining'];
        const limit     = error.response?.headers?.['x-ratelimit-limit'];
        if (remaining !== undefined) console.warn(`[Unsplash] rate limit: ${remaining}/${limit} remaining this hour`);
        return null; // auth/rate — do not spam retries
      }
    }
  }
  return null;
}

/**
 * Суретті жүктеп, data: URI-ге айналдырады — сонда HTML файл ТОЛЫҚ АВТОНОМДЫ болады
 * (интернетсіз, проекторда, флешкадан ашылады; URL мерзімі өтсе де бұзылмайды).
 * Сәтсіз болса null қайтарады (шақырушы fallback-ке түседі).
 */
async function downloadAsDataUri(url) {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: DL_TIMEOUT_MS,
      maxContentLength: MAX_IMAGE_BYTES * 3,   // тым үлкен файлды тоқтату
      validateStatus: s => s === 200,
    });
    const type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp)$/.test(type)) {
      console.warn(`[Unsplash] unexpected content-type: ${type}`);
      return null;
    }
    const buf = Buffer.from(res.data);
    if (buf.length > MAX_IMAGE_BYTES) {
      console.warn(`[Unsplash] image too large (${Math.round(buf.length / 1024)}KB) — skipped`);
      return null;
    }
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch (error) {
    console.warn(`[Unsplash] download failed (${error.response?.status || error.code || error.message})`);
    return null;
  }
}

// Ескі API-мен үйлесімділік: URL қайтарады
async function fetchImage(query) {
  const r = await searchImage(query);
  return r ? r.url : null;
}

module.exports = { fetchImage, searchImage, downloadAsDataUri };
