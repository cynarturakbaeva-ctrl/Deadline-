'use strict';
/**
 * PHOTO JUDGE — фото-сайттардың кандидаттарын слайдқа сай ма деп тексереді (сипаттамасы бойынша).
 *
 * Pexels/Unsplash/Pixabay ешқашан «табылмады» демейді: «Florence Nightingale Scutari» сұранысына кездейсоқ
 * медбике, «Crimean War 1854» сұранысына заманауи солдат береді. Бұрын бірінші кандидат тексерусіз алынатын.
 * Енді әр кандидаттың alt/tags сипаттамасы слайд тақырыбымен бірге модельге жіберіледі; ол сайларын ғана
 * (ең жақсысы бірінші) қайтарады. Сай келмесе — сурет іздеу келесі көзге өтеді, ақыры сурет қойылмайды.
 *
 * Бір шақыру ≈ 400 токен (≈0,1₸). Модель қолжетімсіз/қате болса null → images.js сөздік резерв тексеруді қолданады.
 */
const { deepseekJson } = require('../../core/llm');

const SYSTEM = `You choose photos for ONE slide of a student presentation. You get the slide and a numbered list of photo descriptions (alt text / tags / archive file names). Return JSON {"fit":[numbers]} — only the photos that FIT, best first; [] if none fits.
A photo FITS when a viewer would immediately connect it with this slide: it shows the slide's actual subject (the named person, event, artwork, place, object, organism or process) or a real scene directly about it. For a historical subject, period artworks, archive photos, maps and museum objects of that subject fit.
A photo does NOT fit when the link is loose or wrong: generic people / office / handshake / laptop / smiling-students photos for a specific subject, the wrong country, era, event, species or object, modern costumes or reenactors for a real historical event, a decorative or abstract image, a different person with a similar role.
For a cover or closing slide, a photo that clearly shows the presentation's main subject fits.
When Placement says "photo fills the whole slide behind the text", it must also work as a wide background: a scene, painting, landscape, building, crowd or workplace. Then reject a single small object on a plain backdrop (coin, medal, badge, tool, document, specimen), a close-up texture, a scanned page of text, a tiny portrait — they look like a blurry blob when stretched behind text.
When unsure, leave it out — a slide without a photo is better than a wrong photo.`;

const MAX_CACHE = 3000;
const cache = new Map(); // `${subject}|${url}` → rank (0 = best) | -1 (does not fit)
const remember = (k, v) => { cache.set(k, v); if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); };
const short = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * @param {{ topic?: string, title?: string, query?: string, cover?: boolean, background?: boolean, maxCalls?: number }} ctx
 *   background — фото бүкіл слайдты жабады (cover / closing / fullImage): жалғыз зат (медаль, монета) жарамайды
 * @returns {(cands: {url:string, desc?:string, source?:string}[], q?: string) => Promise<number[]|null>}
 */
function makePhotoJudge(ctx = {}) {
  const subject = [short(ctx.topic, 160), short(ctx.title, 140), ctx.background ? 'bg' : 'frame'].join(' / ');
  let calls = 0;
  const maxCalls = ctx.maxCalls || 3;
  return async function judge(cands, q) {
    if (!process.env.DEEPSEEK_API_KEY || !Array.isArray(cands) || !cands.length) return null;
    const key = (c) => subject + '|' + c.url;
    const todo = cands.filter((c) => !cache.has(key(c)));
    if (todo.length) {
      if (calls >= maxCalls) return null; // шектен асты → сөздік тексеру
      calls += 1;
      const list = todo.map((c, i) => `${i}) ${short(c.desc, 200) || '(no description)'}`).join('\n');
      const user = `Presentation topic: ${short(ctx.topic, 200) || '-'}\n`
        + `Slide${ctx.cover ? ' (cover or closing)' : ''}: ${short(ctx.title, 160) || '-'}\n`
        + (ctx.background ? 'Placement: photo fills the whole slide behind the text\n' : 'Placement: photo in a frame next to the text\n')
        + `Wanted photo: ${short(ctx.query || q, 160)}\n\nPhotos:\n${list}`;
      const out = await deepseekJson(SYSTEM, user, 'photo_judge', 200, { tries: 1, timeoutMs: 20_000 });
      const fit = (Array.isArray(out && out.fit) ? out.fit : []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < todo.length);
      todo.forEach((c, i) => remember(key(c), fit.includes(i) ? fit.indexOf(i) : -1));
    }
    return cands
      .map((c, i) => ({ i, r: cache.get(key(c)) }))
      .filter((x) => x.r != null && x.r >= 0)
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.i);
  };
}

module.exports = { makePhotoJudge, SYSTEM };
