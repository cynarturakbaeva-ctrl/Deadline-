'use strict';
/**
 * AI IMAGE — сай фото табылмағанда слайдқа сурет ЖАСАЛАДЫ (gemini-3.1-flash-lite-image, 16:9, 1K ≈ $0.034).
 *
 * Ережелер:
 *  - Нақты адам/оқиға/туынды (атаулы тақырып: «Abai Kunanbayev», «Battle of Balaclava») — ЖАСАЛМАЙДЫ:
 *    жалған «тарихи» сурет фактілік қате болады. Ондайда слайд суретсіз (типографиялық) қалады.
 *  - Бір презентацияға ең көбі IMAGE_GEN_MAX (әдепкі 2) сурет.
 *  - Жасалған сурет vision-мен тексеріледі: мәтін/әріп, бұрмаланған қол-бет, «AI екені көрініп тұр» → алынбайды.
 * Кілт/биллинг жоқ → null (слайд суретсіз қалады, пайплайн құламайды).
 */
const { geminiImage, hasGoogleKey } = require('../../core/googleAi');
const { checkGenerated } = require('./photoVision');

const short = (t, n) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, n);
const genEnabled = () => hasGoogleKey() && process.env.IMAGE_GEN !== '0';
const envInt = (v, d) => (v != null && String(v).trim() !== '' && Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : d);
const deckBudget = (free) => ({ left: free ? envInt(process.env.IMAGE_GEN_MAX_FREE, 1) : envInt(process.env.IMAGE_GEN_MAX, 2) });

/**
 * @param {{topic?:string, title?:string, text?:string, query?:string, background?:boolean, side?:'left'|'right'}} ctx
 */
function buildPrompt(ctx = {}) {
  const calm = ctx.background
    ? 'Wide establishing composition with a calm, uncluttered area in the lower-left third where a title will be overlaid.'
    : 'Clear single main subject, simple uncluttered background.';
  return [
    'Photorealistic editorial photograph for a university presentation slide.',
    `Show: ${short(ctx.query, 200) || short(ctx.title, 160)}.`,
    `It must clearly illustrate this slide: "${short(ctx.title, 160)}"${ctx.text ? ` — ${short(ctx.text, 300)}` : ''}.`,
    `Presentation topic: ${short(ctx.topic, 200)}.`,
    'If the topic is about Kazakhstan or Central Asia, show an authentic Kazakh / Central Asian setting, people and landscape.',
    calm,
    'Natural light, vivid but realistic colours, sharp focus, high detail, shot on a full-frame camera.',
    'Absolutely NO text, letters, numbers, captions, labels, signs, logos, watermarks, charts, diagrams, UI or borders.',
    'No collage, no split screen, no illustration or cartoon style, no distorted hands or faces.',
  ].join(' ');
}

/**
 * @param {object} ctx — buildPrompt контексі + {named?:boolean}
 * @param {{left:number}} budget — презентация бойынша ортақ лимит (deckBudget)
 * @returns {Promise<{dataUri:string, source:'ai', credit:string}|null>}
 */
async function generateSlideImage(ctx, budget) {
  if (!genEnabled() || !budget || budget.left <= 0) return null;
  if (ctx.named) { console.log(`[ImageGen] skip named subject "${short(ctx.query, 60)}" (no fake history)`); return null; }
  budget.left -= 1; // сәтсіз болса да есептеледі: ақшаның шегі
  const t0 = Date.now();
  const img = await geminiImage(buildPrompt(ctx), { aspectRatio: ctx.background ? '16:9' : '4:3', label: 'image:gen', timeoutMs: 40_000 });
  if (!img) return null;
  const check = await checkGenerated(img.dataUri, ctx).catch(() => null);
  if (check && !check.ok) {
    console.log(`[ImageGen] rejected "${short(ctx.title, 50)}" fit=${check.fit} appeal=${check.appeal} flaw=${check.flaw || '-'}`);
    return null;
  }
  console.log(`[ImageGen] ok "${short(ctx.title, 50)}" ${img.model} ${Date.now() - t0}ms${check ? ` fit=${check.fit} appeal=${check.appeal}` : ' (unchecked)'}`);
  return { dataUri: img.dataUri, source: 'ai', credit: 'AI' };
}

module.exports = { generateSlideImage, buildPrompt, deckBudget, genEnabled };
