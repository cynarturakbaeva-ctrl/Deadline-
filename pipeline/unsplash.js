'use strict';

const axios = require('axios');

async function fetchImage(query) {
  if (!query || typeof query !== 'string' || !query.trim()) {
    console.log('[Unsplash] skipped: empty query');
    return null;
  }

  const cleanQuery = query.trim();

  try {
    const response = await axios.get(
      'https://api.unsplash.com/search/photos',
      {
        params: {
          query: cleanQuery,
          per_page: 1,
          orientation: 'landscape',
        },
        headers: {
          Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`,
        },
        timeout: 10000,
      }
    );

    const result = response.data?.results?.[0];

    if (!result?.urls?.regular) {
      console.log(`[Unsplash] no image found for "${cleanQuery}"`);
      return null;
    }

    const url = result.urls.regular;

    console.log(`[Unsplash] URL: ${url}`);

    return url;
  } catch (error) {
    const status = error.response?.status;
    const body   = error.response?.data;

    console.warn(
      `[Unsplash] failed (${status || error.code || 'unknown'}) for "${cleanQuery}" — using fallback`
    );

    // 403/401 — көбіне rate limit (Demo деңгейде сағатына 50 сұраныс) немесе
    // кілттің жарамсыздығы. body-ды логқа шығарып, нақты себепті анықтау
    // үшін (Unsplash қатесінде errors[] массивінде түсінік болады).
    if (status === 403 || status === 401) {
      console.warn(`[Unsplash] ${status} details:`, JSON.stringify(body));
      const remaining = error.response?.headers?.['x-ratelimit-remaining'];
      const limit     = error.response?.headers?.['x-ratelimit-limit'];
      if (remaining !== undefined) {
        console.warn(`[Unsplash] rate limit: ${remaining}/${limit} remaining this hour`);
      }
    }

    return null;
  }
}

module.exports = { fetchImage };
