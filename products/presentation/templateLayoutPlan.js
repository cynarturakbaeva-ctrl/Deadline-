'use strict';
/**
 * Template → Content: LLM орналасу жоспарлаушысы.
 *
 * Неге: қатты код «қай қорап — тақырып, қайсысы — тізім, қай суретті қозғауға болады» дегенді
 * болжай алмайды (оқу реті, қаріп өлшемі бойынша болжау қателеседі). LLM-ге слайдтың геометриясы
 * беріледі (қораптар, өлшемдері, қарпі, түпнұсқа мәтіні, айналадағы суреттер), ол:
 *   • әр мәтінді (дәл көшіріп) қай қорапқа салуды,
 *   • қаріп өлшемін (fontPt),
 *   • кедергі суретті/пішінді қанша жылжытуды (move)
 * шешеді. Код оны ТЕКСЕРЕДІ (мәтін толық па, өзгертілмеген бе, шектер) және templateFill сыйғызу қозғалтқышымен
 * өлшеп, қорғайды. LLM құласа/қате берсе — слайд детерминді қозғалтқышпен толтырылады.
 */

const { orderedSlides, xfrmOf } = require('../../design-dna/structure');
const T = require('./templateFill');
const L = require('./templateLayout');

const EMU_IN = 914400;
const inch = (v) => Math.round((v / EMU_IN) * 10) / 10;
const MAX_MOVE_IN = 0.8;

const textOf = (block) => [...String(block).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join('').replace(/\s+/g, ' ').trim();
const szPtOf = (block) => { const m = block.match(/ sz="(\d+)"/); return m ? +m[1] / 100 : 0; };
const tokens = (t) => String(t || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

const othersOf = L.othersOf;

/** Бір слайдтың сипаттамасы (LLM үшін). Логотип үлгісіндегі («H|ISTORY») слайдтар LLM-ге берілмейді. */
function describeSlide(xml, W, H) {
  const cl = T.classify(xml, { W, H });
  if (cl.pairs || !cl.content.length) return { skip: true };
  const items = L.topItems(xml);
  const shapes = cl.content.map((s, id) => {
    const sur = L.surround(xml, s.block, W, H, items);
    const b = xfrmOf(s.block);
    const al = (s.block.match(/<a:pPr[^>]*? algn="(\w+)"/) || [])[1] || 'l';
    return {
      id,
      role: id === 0 ? 'title-candidate (largest font)' : 'text',
      originalText: textOf(s.block).slice(0, 80),
      fontPt: Math.round(szPtOf(s.block)),
      align: al === 'ctr' ? 'center' : al === 'r' ? 'right' : 'left',
      box: { x: inch(b.x), y: inch(b.y), w: inch(b.w), h: inch(b.h) },
      freeBelow: inch(sur.room),
      freeRight: inch(sur.right),
    };
  });
  const others = othersOf(xml, W, H).slice(0, 12).map((o) => ({ id: o.id, kind: o.item.tag === 'p:pic' ? 'picture' : 'shape', box: { x: inch(o.item.box.x), y: inch(o.item.box.y), w: inch(o.item.box.w), h: inch(o.item.box.h) } }));
  return { skip: false, shapes, others };
}

function describeTemplate(templateBuf) {
  const files = T.readZipAll(templateBuf);
  const m = (files.get('ppt/presentation.xml') || '').match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  const W = m ? +m[1] : 12192000, H = m ? +m[2] : 6858000;
  return { W, H, slideIn: { w: inch(W), h: inch(H) }, slides: orderedSlides(files).map((sp) => describeSlide(files.get(sp) || '', W, H)) };
}

const itemsOfSlide = (slide) => {
  const { title, body } = T.linesForSlide(slide);
  return { title, body };
};

function buildPrompt({ topic, language, desc, slides, indices }) {
  const blocks = indices.map((i) => {
    const d = desc.slides[i];
    const { title, body } = itemsOfSlide(slides[i]);
    return `Slide ${i + 1}
CONTENT TO PLACE: ${JSON.stringify({ title, items: body })}
TEMPLATE TEXT BOXES (inches; slide is ${desc.slideIn.w} x ${desc.slideIn.h}): ${JSON.stringify(d.shapes)}
MOVABLE ELEMENTS (pictures/shapes without text): ${JSON.stringify(d.others)}`;
  }).join('\n\n');
  return `Presentation topic: ${topic || ''}\nLanguage: ${language || 'keep the language of the content'}.

You are the layout editor for a client's PPTX template. For each slide the new text must be poured into the template's EXISTING text boxes so it looks designed by hand: nothing overlapping, nothing cut off, text large enough to read, no meaningless shortening.

For every slide decide:
1. "assign": which text goes into which box. Use the box geometry, the original text and the font size to understand each box's ROLE (a heading box has the largest font; a short label box takes a short item; a wide box takes a paragraph). The "title-candidate" is only a hint — decide yourself. Copy the text VERBATIM from CONTENT TO PLACE (you may split/regroup items between boxes, you may NOT rewrite, translate, add or drop words). Boxes that have no suitable text get "lines": [].
2. "fontPt": the font size you want in that box (points). Keep within 60%-130% of the box's original fontPt, never below 12 for body text; shrink a bit rather than cut text. Omit it to keep the original size.
3. "move": only if a picture/shape would collide with text, shift it by dx/dy inches (|value| ≤ ${MAX_MOVE_IN}). Otherwise leave it out.

${blocks}

Return JSON only:
{"slides":[{"index":<slide number>,"assign":[{"id":<box id>,"lines":["…"],"fontPt":<number optional>}],"move":[{"id":"o0","dx":0,"dy":0.3}]}]}`;
}

/**
 * Жоспарды тексереді және тазалайды. Қате болса null (слайд детерминді жолмен толтырылады).
 * Шарттар: id-лер дұрыс; мәтін ТОЛЫҚ (≥90% сөз) және ЖАҢА сөз ойлап шығарылмаған (≥90%); fontPt/move шектелген.
 */
function validatePlan(plan, slide, d) {
  if (!plan || !d || d.skip || !Array.isArray(plan.assign)) return null;
  const n = d.shapes.length;
  const seen = new Set();
  const assign = [];
  for (const a of plan.assign) {
    const id = Number(a && a.id);
    if (!Number.isInteger(id) || id < 0 || id >= n || seen.has(id)) return null;
    seen.add(id);
    const lines = (Array.isArray(a.lines) ? a.lines : []).map((x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim()).filter(Boolean);
    let fontPt = Number(a.fontPt);
    const orig = d.shapes[id].fontPt;
    if (!Number.isFinite(fontPt) || fontPt <= 0 || !orig) fontPt = null;
    else fontPt = Math.min(Math.max(fontPt, orig * 0.6), orig * 1.3);
    assign.push({ id, lines, fontPt });
  }
  const { title, body } = itemsOfSlide(slide);
  const want = tokens([title, ...body].join(' '));
  const got = tokens(assign.map((a) => a.lines.join(' ')).join(' '));
  if (!want.length || !got.length) return null;
  const bag = (arr) => arr.reduce((m, t) => (m.set(t, (m.get(t) || 0) + 1), m), new Map());
  const wb = bag(want), gb = bag(got);
  let kept = 0, fake = 0;
  for (const [t, c] of wb) kept += Math.min(c, gb.get(t) || 0);
  for (const [t, c] of gb) fake += Math.max(0, c - (wb.get(t) || 0));
  if (kept / want.length < 0.9 || fake / got.length > 0.1) return null;

  const ids = new Set((d.others || []).map((o) => o.id));
  const move = [];
  for (const mv of Array.isArray(plan.move) ? plan.move : []) {
    if (!mv || !ids.has(mv.id)) continue;
    const c = (v) => Math.max(-MAX_MOVE_IN, Math.min(MAX_MOVE_IN, Number(v) || 0));
    const dx = c(mv.dx), dy = c(mv.dy);
    if (dx || dy) move.push({ id: mv.id, dx: Math.round(dx * EMU_IN), dy: Math.round(dy * EMU_IN) });
  }
  return { assign, move };
}

/**
 * @returns {Promise<Array<object|null>>} әр слайдқа: тексерілген жоспар немесе null
 */
async function planLayout(o) {
  const { templateBuf, slides, topic, language } = o;
  const llm = o.llm || require('../../core/llm').deepseekJson;
  const desc = o.desc || describeTemplate(templateBuf);
  const out = (slides || []).map(() => null);
  const todo = [];
  desc.slides.forEach((d, i) => { if (!d.skip && slides[i]) todo.push(i); });
  const CHUNK = 6;
  for (let k = 0; k < todo.length; k += CHUNK) {
    const indices = todo.slice(k, k + CHUNK);
    let reply;
    try {
      reply = await llm(
        'You are a precise slide layout editor. Respond with valid JSON only.',
        buildPrompt({ topic, language, desc, slides, indices }),
        'template-layout', 4000, { temperature: 0.2, timeoutMs: 90_000 },
      );
    } catch (e) {
      console.warn(`[TemplateLayout] LLM failed (slides ${indices.map((i) => i + 1).join(',')}): ${e.message}`);
      continue;
    }
    for (const p of Array.isArray(reply && reply.slides) ? reply.slides : []) {
      const i = Number(p && p.index) - 1;
      if (!indices.includes(i)) continue;
      const v = validatePlan(p, slides[i], desc.slides[i]);
      if (v) out[i] = v; else console.warn(`[TemplateLayout] slide ${i + 1}: plan rejected, deterministic fill`);
    }
  }
  return out;
}

module.exports = { describeTemplate, describeSlide, buildPrompt, validatePlan, planLayout, othersOf };
