'use strict';

const axios = require('axios');

// МАҢЫЗДЫ (жаңа): бұрын сурет көзі тек Unsplash болды. Unsplash-тың тегін
// деңгейі сағатына ~50 сұраныспен шектелген (rate limit) — сол шекке
// жеткенде (немесе белгілі бір сұраныс үшін нәтиже болмағанда) слайд
// суретсіз қалып, әдемі болса да "бос" градиент фонға түсетін (осы
// файлдың мақсаты — дәл осы жағдайды азайту). Pexels — толығымен тегін,
// коммерциялық қолдануға рұқсат етілген (Pexels License), сағатына
// шамамен 200 сұраныс лимиті бар екінші көз. index.js осы модульді
// Unsplash сәтсіз болғанда ғана шақырады (бірінші орында емес) — Unsplash
// сапасы/релевантылығы әдетте жақсырақ деп саналады, Pexels тек резерв.
//
// Интерфейс unsplash.js-пен бірдей пішінде ({url, credit} | null) —
// downloadAsDataUri() провайдерге тәуелсіз (кез келген URL-ді жүктей
// алады), сондықтан оны osы жерде қайталамаймыз, unsplash.js-тен
// пайдаланамыз (index.js-те көру керек).
async function searchImage(query) {
  if (!process.env.PEXELS_API_KEY) {
    // Кілт бапталмаса, әр сурет сұранысында бос 401 үшін желіге шықпаймыз —
    // Unsplash та сәтсіз болған сайын шусыз, дереу null қайтарамыз.
    return null;
  }
  if (!query || typeof query !== 'string' || !query.trim()) {
    return null;
  }
  const cleanQuery = query.trim().slice(0, 120);

  try {
    const response = await axios.get('https://api.pexels.com/v1/search', {
      params: { query: cleanQuery, per_page: 1, orientation: 'landscape' },
      // Pexels Unsplash-тан өзгеше: "Bearer"/"Client-ID" емес, кілттің өзі тікелей.
      headers: { Authorization: process.env.PEXELS_API_KEY },
      timeout: 10000,
    });

    const result = response.data?.photos?.[0];
    // "large" — ені ≤940px, стейдж фонына жеткілікті, файл салмағы кішкентай
    const url = result?.src?.large;
    if (!url) {
      console.log(`[Pexels] no image found for "${cleanQuery}"`);
      return null;
    }
    return { url, credit: result.photographer || null };
  } catch (error) {
    const status = error.response?.status;
    console.warn(`[Pexels] failed (${status || error.code || 'unknown'}) for "${cleanQuery}"`);
    return null;
  }
}

module.exports = { searchImage };
