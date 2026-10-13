'use strict';
/**
 * PHOTO JUDGE — фото-сайттардың кандидаттарын слайдқа сай ма деп тексереді (сипаттамасы бойынша).
 *
 * Pexels/Unsplash/Pixabay ешқашан «табылмады» демейді: «Florence Nightingale Scutari» сұранысына кездейсоқ
 * медбике, «Crimean War 1854» сұранысына заманауи солдат береді. Бұрын бірінші кандидат тексерусіз алынатын.
 * Енді әр кандидаттың alt/tags сипаттамасы слайд мазмұнымен бірге модельге жіберіледі; ол әрқайсысына 0–10 балл
 * қояды, MIN_SCORE-дан (7) төмені алынбайды. Сай келмесе — сурет іздеу келесі көзге өтеді, ақыры сурет қойылмайды.
 *
 * Бір шақыру ≈ 400 токен (≈0,1₸). Модель қолжетімсіз/қате болса null → images.js сөздік резерв тексеруді қолданады.
 */
const { deepseekJson } = require('../../core/llm');

const SYSTEM = `You choose photos for ONE slide of a student presentation. You get the slide (its title and what it says) and a numbered list of photo descriptions (alt text / tags / archive file names). Score EVERY photo 0-10 for how well it illustrates THIS slide and return JSON {"scores":[n0, n1, ...]} — one number per photo, same order.
Judge against the SLIDE's content, not against the search query: the query was written by another model and may itself be off (e.g. a geology query on a slide about the meaning of life).
10 — shows exactly the slide's subject: the named person, event, artwork, place, object, organism or process, or a real scene directly about it. For a historical subject, period artworks, archive photos, maps and museum objects of that subject.
7-8 — a real scene a viewer would immediately connect with this slide's point.
4-6 — same broad field but not this slide's point (a geology photo on a slide about life values; a classroom on a slide about a specific theory).
0-3 — loose or wrong: a generic stand-in (smiling person with laptop, handshake, office, posing students) for a specific subject; wrong country, era, event, species or object; modern reenactors for a real historical event; a metaphor or decoration (crossroads, puzzle, light bulb, chess); a different person with a similar role.
Cover or closing slide: a photo that clearly shows the presentation's main subject scores 8+.
When Placement says "photo fills the whole slide behind the text", the photo must also work as a wide background (scene, painting, landscape, building, crowd, workplace): a single small object on a plain backdrop (coin, medal, badge, tool, document, specimen), a close-up of hands or texture, a scanned page or a tiny portrait scores 0-3 there — it turns into a blurry blob behind text.
Be strict: a slide without a photo is better than a wrong photo.`;

/** Осы баллдан төмен фото алынбайды (env PHOTO_JUDGE_MIN арқылы өзгертуге болады) */
const MIN_SCORE = Number(process.env.PHOTO_JUDGE_MIN) || 7;
const MAX_CACHE = 3000;
const cache = new Map(); // `${subject}|${url}` → балл 0..10
const remember = (k, v) => { cache.set(k, v); if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value); };
const short = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * @param {{ topic?: string, title?: string, text?: string, query?: string, cover?: boolean, background?: boolean, maxCalls?: number }} ctx
 *   text — слайдтың не айтатыны (subtitle + алғашқы пункттер): тексеру сұранысқа емес, слайдқа қарай жүреді
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
        + (ctx.text ? `Slide says: ${short(ctx.text, 360)}\n` : '')
        + (ctx.background ? 'Placement: photo fills the whole slide behind the text\n' : 'Placement: photo in a frame next to the text\n')
        + `Search query used: ${short(ctx.query || q, 160)}\n\nPhotos:\n${list}`;
      const out = await deepseekJson(SYSTEM, user, 'photo_judge', 200, { tries: 1, timeoutMs: 20_000 });
      const raw = Array.isArray(out && out.scores) ? out.scores : [];
      const scores = todo.map((_, i) => { const n = Number(raw[i]); return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0; });
      todo.forEach((c, i) => remember(key(c), scores[i]));
      console.log(`[ImageJudge] "${short(ctx.title, 50)}" ${ctx.background ? 'bg' : 'frame'} scores=[${scores.join(',')}] best="${short(todo[scores.indexOf(Math.max(...scores))].desc, 60)}"`);
    }
    return cands
      .map((c, i) => ({ i, s: cache.get(key(c)) }))
      .filter((x) => x.s != null && x.s >= MIN_SCORE)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x) => x.i);
  };
}

module.exports = { makePhotoJudge, SYSTEM, MIN_SCORE };
