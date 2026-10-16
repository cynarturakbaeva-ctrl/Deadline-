'use strict';
/**
 * VISUAL REVIEW — DeepSeek соңында колоданы КӨЗБЕН көреді (рендерленген PNG), әр құрастырылған слайдқа
 * үкім береді: мәтін қабаттасты/кесілді, бос қалды, әшекей мағынасыз, түс оқылмайды, фото нашар қиылды,
 * шашыраңқы. Түзету — шектеулі әрекеттер (модельдің еркін «редизайны» емес):
 *   decor    → сол композиция, бірақ әшекейсіз
 *   overlap / empty / crop / clutter → басқа композиция (не басқа нұсқа)
 *   contrast → сол композицияның басқа нұсқасы
 * Тексерілмеген слайдтар қайта жасағанда ӨЗГЕРМЕЙДІ (pin). Жаңа нұсқа тек проблема азайса қабылданады
 * (шешімді index.js қабылдайды: екінші қарау тек өзгерген слайдтарға).
 *
 * Кілт жоқ / жауап жоқ → null: колода сол күйі жіберіледі (тексеріс ешқашан генерацияны құлатпайды).
 */
const fs = require('fs');
const { deepseekVisionJson } = require('../../../core/llm');

const MAX = Number(process.env.DESIGN_REVIEW_MAX) || 10;
const PROBLEMS = ['overlap', 'empty', 'decor', 'contrast', 'crop', 'clutter'];

const PROMPT = (n, topic) => `You are the art director of a student presentation about "${String(topic || '').slice(0, 120)}". You SEE ${n} rendered slides, in order, numbered 1..${n} as they appear below.
Judge each slide as a finished, professionally designed slide (like a good Canva/Keynote template). Flag ONLY real, visible problems:
- "overlap": text overlaps other text, a picture or a decoration, or text is cut off at an edge;
- "empty": a large blank area makes the slide look unfinished (roughly a third of the slide or more with nothing in it);
- "decor": a decorative illustration/icon has nothing to do with the slide's text, or looks out of place;
- "contrast": some text is hard to read against its background;
- "crop": a photo is cropped badly (cut-off head/face, mostly empty sky/wall, the subject missing);
- "clutter": elements are crowded, misaligned or look chaotic.
Do not invent problems; most good slides have none. Return JSON only:
{"slides":[{"n":1,"problems":[],"note":""}],"score":0}
"problems" uses only these words: ${PROBLEMS.join(', ')}. "note" ≤ 12 words. "score" = overall visual quality 0–100.`;

async function thumb(pngPath) {
  try {
    const sharp = require('sharp');
    const buf = await sharp(pngPath).resize(960, 540, { fit: 'inside' }).jpeg({ quality: 72 }).toBuffer();
    return { mime: 'image/jpeg', data: buf.toString('base64') };
  } catch {
    try { return { mime: 'image/png', data: fs.readFileSync(pngPath).toString('base64') }; } catch { return null; }
  }
}

/** HTML-дағы слайд макеттері (index тәртібімен) */
function layoutsOf(htmlPath) {
  try { return [...fs.readFileSync(htmlPath, 'utf8').matchAll(/<article class="slide[^>]*data-layout="([^"]+)"/g)].map((m) => m[1]); } catch { return []; }
}

/**
 * idx — қаралатын слайдтар (0-ден); қайтарады { score, flagged:[{i, problems, note}] } не null
 */
async function review({ pngPaths, idx, topic }) {
  const list = (idx || pngPaths.map((_, i) => i)).filter((i) => pngPaths[i]).slice(0, MAX);
  if (!list.length || !process.env.DEEPSEEK_API_KEY) return null;
  const imgs = [];
  for (const i of list) { const im = await thumb(pngPaths[i]); if (im) imgs.push({ i, im }); }
  if (!imgs.length) return null;
  const parts = [{ text: PROMPT(imgs.length, topic) }];
  imgs.forEach((x, k) => { parts.push({ text: 'Slide ' + (k + 1) + ':' }); parts.push({ image: x.im }); });
  const res = await deepseekVisionJson(parts, { label: 'design-review', maxTokens: 900, timeoutMs: 60_000 });
  if (!res || !Array.isArray(res.slides)) return null;
  const flagged = [];
  res.slides.forEach((s) => {
    const k = Number(s && s.n) - 1;
    if (!(k >= 0 && k < imgs.length)) return;
    const problems = (Array.isArray(s.problems) ? s.problems : []).map((p) => String(p).toLowerCase().trim()).filter((p) => PROBLEMS.includes(p));
    if (problems.length) flagged.push({ i: imgs[k].i, problems: [...new Set(problems)], note: String(s.note || '').slice(0, 120) });
  });
  return { score: Number(res.score) || null, flagged, seen: imgs.map((x) => x.i) };
}

/**
 * Түзету жоспары слайдтардың composition.cx өрісіне жазылады (builder оқиды).
 * layouts — HTML-дағы data-layout тізімі. Тек құрастырылған (cx-*) слайдтар түзетіледі; қалғаны бекітіледі.
 */
function applyFixes(slides, layouts, flagged) {
  const byIdx = new Map(flagged.map((f) => [f.i, f]));
  const changed = [];
  slides.forEach((s, i) => {
    const lay = layouts[i] || '';
    if (!/^cx-/.test(lay)) return;
    const id = lay.slice(3);
    s.composition = s.composition || {};
    const prev = s.composition.cx || {};
    const f = byIdx.get(i);
    if (!f) { s.composition.cx = { ...prev, pin: id }; return; }
    const cx = { avoid: [...new Set([...(prev.avoid || [])])], seed: (prev.seed || 0) + 1 };
    if (f.problems.some((p) => p !== 'decor' && p !== 'contrast')) cx.avoid.push(id);
    else cx.pin = id;
    if (f.problems.includes('decor')) cx.noDecor = true;
    s.composition.cx = cx;
    changed.push(i);
  });
  return changed;
}

module.exports = { review, applyFixes, layoutsOf, PROBLEMS };
