'use strict';

/**
 * Multi-source image search for presentations.
 * Order (best for academic/historical topics first):
 *   1. Wikimedia Commons (free, no key, real artefacts/maps)
 *   2. Pexels (PEXELS_API_KEY)
 *   3. Unsplash (UNSPLASH_ACCESS_KEY)
 *   4. Pixabay (PIXABAY_API_KEY)
 *
 * Never invent images. Returns { url, credit, source } or null.
 */

const axios = require('axios');
const { downloadAsDataUri } = require('./unsplash');

const MAX_Q = 80;

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

async function searchWikimedia(query) {
  // Prefer real historical / artefact photos over stock lifestyle
  const q = String(query || '').trim().slice(0, MAX_Q);
  if (!q) return null;
  try {
    const response = await axios.get('https://commons.wikimedia.org/w/api.php', {
      params: {
        action: 'query',
        format: 'json',
        origin: '*',
        generator: 'search',
        gsrsearch: q,
        gsrlimit: 5,
        gsrnamespace: 6, // File:
        prop: 'imageinfo',
        iiprop: 'url|mime|size',
        iiurlwidth: 1280,
      },
      timeout: 12000,
      headers: { 'User-Agent': 'DeadLinePresentationBot/2.1 (educational; local)' },
    });
    const pages = response.data?.query?.pages;
    if (!pages) return null;
    const list = Object.values(pages);
    for (const page of list) {
      const info = page.imageinfo && page.imageinfo[0];
      if (!info) continue;
      const mime = String(info.mime || '');
      if (!/^image\/(jpeg|png|webp)$/i.test(mime)) continue;
      const url = info.thumburl || info.url;
      if (!url || !/^https?:\/\//i.test(url)) continue;
      // Skip huge originals if no thumb
      if (!info.thumburl && info.size && info.size > 2_500_000) continue;
      return {
        url,
        credit: page.title ? String(page.title).replace(/^File:/i, '') : 'Wikimedia Commons',
        source: 'wikimedia',
      };
    }
    return null;
  } catch (err) {
    console.warn(`[Image:wikimedia] ${err.message}`);
    return null;
  }
}

async function searchPexels(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return null;
  const q = String(query || '').trim().slice(0, MAX_Q);
  if (!q) return null;
  try {
    const response = await axios.get('https://api.pexels.com/v1/search', {
      params: { query: q, per_page: 3, orientation: 'landscape' },
      headers: { Authorization: key },
      timeout: 10000,
    });
    const photo = response.data?.photos?.[0];
    const url = photo?.src?.large || photo?.src?.medium;
    if (!url) return null;
    return {
      url,
      credit: photo.photographer || 'Pexels',
      source: 'pexels',
    };
  } catch (err) {
    const status = err.response?.status;
    console.warn(`[Image:pexels] failed (${status || err.message})`);
    return null;
  }
}

async function searchPixabay(query) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return null;
  const q = String(query || '').trim().slice(0, MAX_Q);
  if (!q) return null;
  try {
    const response = await axios.get('https://pixabay.com/api/', {
      params: {
        key,
        q,
        image_type: 'photo',
        orientation: 'horizontal',
        safesearch: 'true',
        per_page: 5,
      },
      timeout: 10000,
    });
    const hit = response.data?.hits?.[0];
    const url = hit?.webformatURL || hit?.largeImageURL;
    if (!url) return null;
    return {
      url,
      credit: hit.user ? `Pixabay/${hit.user}` : 'Pixabay',
      source: 'pixabay',
    };
  } catch (err) {
    console.warn(`[Image:pixabay] failed (${err.response?.status || err.message})`);
    return null;
  }
}

async function searchUnsplash(query) {
  // Reuse existing module logic
  try {
    const { searchImage } = require('./unsplash');
    const r = await searchImage(query);
    if (!r) return null;
    return { url: r.url, credit: r.credit, source: 'unsplash' };
  } catch (err) {
    console.warn(`[Image:unsplash] ${err.message}`);
    return null;
  }
}

/**
 * Search across providers. Wikimedia first for academic/history relevance.
 */
async function searchImageMulti(query) {
  const variants = queryVariants(query);
  if (!variants.length) return null;

  const providers = [
    { name: 'wikimedia', fn: searchWikimedia },
    { name: 'pexels', fn: searchPexels },
    { name: 'unsplash', fn: searchUnsplash },
    { name: 'pixabay', fn: searchPixabay },
  ];

  for (const q of variants) {
    for (const p of providers) {
      try {
        const hit = await p.fn(q);
        if (hit && hit.url) {
          if (q !== variants[0] || p.name !== 'wikimedia') {
            console.log(`[Image] hit source=${hit.source} q="${q.slice(0, 50)}"`);
          }
          return hit;
        }
      } catch (err) {
        console.warn(`[Image:${p.name}] ${err.message}`);
      }
    }
  }
  console.log(`[Image] no image for "${String(query).slice(0, 60)}"`);
  return null;
}

module.exports = {
  searchImageMulti,
  searchWikimedia,
  searchPexels,
  searchPixabay,
  queryVariants,
  downloadAsDataUri,
};
