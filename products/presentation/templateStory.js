'use strict';
/**
 * Template → Content: кәсіби әңгіме желісі (storyline) — ШАБЛОННЫҢ МӘТІНІНЕН ТӘУЕЛСІЗ.
 *
 * Бұрын LLM-ге шаблонның өз бөлім атаулары («Team Us», «Method 1», «Data Analysis»…) берілетін, сондықтан
 * жаңа тақырып шаблонның бөлімдеріне аударылып жазылатын (мыс. «Басқару тобы: Тәжірибелі мамандар»).
 * Енді:
 *   1) құрылым ТАҚЫРЫПТАН құрылады: тақырыпқа кәсіби презентацияда не айтылуы керек (контекст → негізгі
 *      идеялар → дәлел/мысал → қолдану → қорытынды);
 *   2) шаблоннан тек ФОРМА алынады: слайд саны, әр слайдтағы мәтін орындарының өлшемі мен түрі
 *      (қысқа белгі / бір сөйлем / абзац) және құрылымдық тіректер (мұқаба, мазмұны, қорытынды, рахмет);
 *   3) әр слайдқа әңгіменің сол формаға табиғи сыятын бөлігі беріледі (қысқа белгілер — терминдер/сандар/
 *      қадамдар; абзац — түсіндіру мен мысал).
 * Шаблонның мәтіні мен бөлім атаулары LLM-ге МҮЛДЕ берілмейді.
 */

const ANCHOR = {
  title: 'COVER: the presentation title and a one-line subtitle for THIS topic',
  agenda: 'AGENDA: the contents / plan of THIS presentation (its own section names)',
  conclusion: 'CONCLUSION: key takeaways of THIS presentation',
  references: 'REFERENCES: real, well-known sources on THIS topic',
  thanks: 'CLOSING: thank-you / questions slide',
};

/** Мәтін орнының түрі (сыйымдылығы бойынша). */
function slotKind(cap) {
  if (!(cap > 0)) return { kind: 'phrase', max: 60, text: 'short phrase' };
  if (cap < 45) return { kind: 'label', max: cap, text: `label ≤${cap}` };
  if (cap < 140) return { kind: 'sentence', max: cap, text: `sentence ≤${cap}` };
  return { kind: 'paragraph', max: Math.min(cap, 320), text: `paragraph ≤${Math.min(cap, 320)}` };
}

/** Бір слайдтың формасы (шаблонның мәтінінсіз): тақырып ұзындығы, орындар түрі. */
function slideProfile(p) {
  if (!p) return 'free form';
  const title = p.split
    ? `title = ${p.title.words} short striking word(s), each ≤ ${p.title.wordMax} letters`
    : p.title ? `title ≤ ${p.title.max > 0 ? p.title.max : 60} chars` : 'no title box';
  if (!p.items.length) return `${title}; no body text (statement / section divider)`;
  return `${title}; ${p.items.length} text slot(s): [${p.items.map((c) => slotKind(c).text).join(', ')}]`;
}

/** Құрылымдық тіректер: тек форма-деңгейіндегі рөлдер (мазмұнға байланған мақсат/міндет/кіріспе — жоқ). */
function anchorsFromOutline(outline, n) {
  const out = new Array(n).fill(null);
  if (n) out[0] = 'title';
  const slides = (outline && outline.slides) || [];
  // Рөл шаблонның тақырып сөзінен табылады («summary», «contents»…) — қателеспеу үшін орнымен де тексереміз:
  // мазмұны — басында, қорытынды/әдебиет — соңғы үштен бірде, рахмет — соңғы екі слайдта.
  const ok = {
    agenda: (i) => i <= Math.max(2, Math.floor(n / 3)),
    conclusion: (i) => i >= Math.floor((n * 2) / 3) - 1,
    references: (i) => i >= Math.floor((n * 2) / 3) - 1,
    thanks: (i) => i >= n - 2,
  };
  slides.forEach((s, i) => {
    if (i === 0 || i >= n) return;
    if (ok[s.role] && ok[s.role](i)) out[i] = s.role;
  });
  return out;
}

function buildPrompt({ topic, brief, language, plan, anchors }) {
  const lines = plan.map((p, i) => {
    const a = anchors[i] ? ` — FIXED ROLE: ${ANCHOR[anchors[i]]}` : '';
    return `Slide ${i + 1}: ${slideProfile(p)}${a}`;
  }).join('\n');
  return `TOPIC: ${topic}
${brief ? `CLIENT BRIEF / AUDIENCE / WISHES:\n"""\n${brief}\n"""\n` : ''}OUTPUT LANGUAGE: ${language || 'the language of the topic'} (every string).

You are a senior presentation strategist and a subject-matter expert on this topic.
The deck must be poured into a fixed visual template with exactly ${plan.length} slides. From the template you only know the FORM of each slide (how many text slots and how big they are). You do NOT know, and must not guess, what the template originally said — plan purely from the TOPIC.

Step 1. Decide what a strong, professional presentation on this topic must make the audience understand: a clear story arc (context or problem → core ideas → how it works / evidence / real examples → significance or application → conclusion). Be specific to the topic, not generic.
Step 2. Assign exactly one beat of that story to each slide, choosing the beat whose natural form fits the slide's slots:
  - several "label" slots → key terms, components, steps, pillars, or figures with units (each slot one precise item);
  - "sentence" slots → one clear claim or fact each;
  - "paragraph" slots → explanation with concrete facts, mechanisms or examples;
  - no body text → a section divider or a strong one-line statement.
SLIDE FORMS (from the template):
${lines}

Step 3. Respect FIXED ROLE slides exactly. All other slides are free: never insert team members, company names, people, dates or numbers that the topic and brief do not justify.
Every beat must be distinct, move the story forward and not repeat another slide.

Return JSON only:
{"title":"presentation title",
 "slides":[{"index":1,"heading":"informative slide heading (says the point)","purpose":"what the audience must understand from this slide","slot_plan":"how the slots are used, e.g. '3 labels = the three components'","key_points":["concrete point","..."]}]}
The "slides" array must have exactly ${plan.length} entries, index 1..${plan.length}.`;
}

/** LLM жауабын тексереді және generateSlides күтетін outline-ға айналдырады; жарамсыз болса null. */
function toOutline(o, n) {
  if (!o || !Array.isArray(o.slides) || o.slides.length !== n) return null;
  const clean = (v, k) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, k);
  const byIdx = new Map(o.slides.map((s) => [Number(s && s.index), s]));
  const topics = [];
  for (let i = 1; i <= n; i++) {
    const s = byIdx.get(i) || o.slides[i - 1];
    const heading = clean(s && s.heading, 120);
    if (!heading) return null;
    const purpose = clean(s.purpose, 240);
    const pts = (Array.isArray(s.key_points) ? s.key_points : []).map((x) => clean(x, 160)).filter(Boolean).slice(0, 6);
    const plan = clean(s.slot_plan, 160);
    topics.push([
      heading,
      purpose ? ` — ${purpose}` : '',
      pts.length ? `. Key points: ${pts.join('; ')}` : '',
      plan ? `. Slots: ${plan}` : '',
    ].join(''));
  }
  const title = clean(o.title, 160);
  return title ? { title, slideTopics: topics } : null;
}

/**
 * @returns {Promise<{title, slideTopics}|null>} — null болса, pipeline әдеттегі құрылым жасауына көшеді.
 */
async function planStoryline({ topic, brief, language, plan, outline, llm }) {
  if (!Array.isArray(plan) || plan.length < 2 || !topic) return null;
  const call = llm || require('../../core/llm').deepseekJson;
  const anchors = anchorsFromOutline(outline, plan.length);
  try {
    const o = await call(
      'You plan the storyline of professional presentations. Respond with valid JSON only.',
      buildPrompt({ topic, brief, language, plan, anchors }),
      'template-story', 5000, { temperature: 0.4, timeoutMs: 90_000 },
    );
    const res = toOutline(o, plan.length);
    if (!res) console.warn('[TemplateStory] invalid storyline — fallback to default outline');
    return res;
  } catch (e) {
    console.warn(`[TemplateStory] failed (${e.message}) — fallback to default outline`);
    return null;
  }
}

module.exports = { planStoryline, slotKind, slideProfile, anchorsFromOutline, buildPrompt, toOutline };
