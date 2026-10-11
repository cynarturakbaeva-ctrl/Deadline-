'use strict';
/**
 * Template → Content v2: «слот жазушы».
 *
 * templateSchema әр қорапқа рөл береді; мұнда LLM әр қорапқа ЖЕКЕ мәтін жазады (JSON кілті = слот кілті):
 *   1) деңгей бүкіл презентация: chrome (мәзір/бренд) және қайталанатын белгілер (tag) — БІР рет, бәріне бірдей;
 *   2) әр слайд: title / accent / subtitle / card / stat / body / label / logo сөздері;
 *   3) тексеру: ұзындық, бос орын, «…», тіл, шаблонның ағылшын мәтіні қалып қоюы;
 *   4) тек қате слоттар бір рет қайта жаздырылады; одан кейін детерминді қорғаныс (сөз шекарасынан қысқарту, жалпы мазмұннан алу).
 * Авторлар (орындаған/тексерген/топ/университет) LLM-сіз, детерминді түрде өз орындарына қойылады.
 *
 * Нәтиже fillTemplatePptx(..., { slotFill }) үшін: әр слайдқа { byId: {id: [жолдар]}, logo: [сөздер]|null }.
 */
const { linesForSlide } = require('./templateFill');

const BATCH = 3;
const clean = (t) => String(t == null ? '' : t).replace(/\s*(…|\.{3})\s*$/, '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const hasCyr = (t) => /[Ѐ-ӿ]/.test(t || '');
const wantsCyr = (language) => /kaz|қаз|kk|rus|рус|орыс|ru\b/i.test(String(language || 'kk')) || !language;
const lettersOf = (t) => String(t || '').replace(/[^\p{L}]/gu, '');
const isUpperOrig = (o) => { const l = lettersOf(o); return l.length >= 3 && l === l.toUpperCase() && l !== l.toLowerCase(); };

/** Шаблон түпнұсқасы БАС ӘРІППЕН болса — біздің мәтін де бас әріппен (дизайн сақталады). */
function caseLike(orig, text, role) {
  if (!text || role === 'body' || (role === 'card' && text.length > 60)) return text;
  return isUpperOrig(orig) ? text.toLocaleUpperCase('kk-KZ') : text;
}

/** Сөз шекарасынан лимитке дейін қысқарту (сөз ортасынан ЕШҚАШАН). */
const TAIL = /^(және|мен|бен|пен|мен|да|де|та|те|үшін|арқылы|бойынша|туралы|сияқты|ал|бірақ|немесе|и|в|на|с|по|для|и|или|but|and|or|of|the|to|in|for)$/iu;
function fitToLimit(text, max, slack = 1.25) {
  const t = clean(text);
  if (!max || t.length <= Math.floor(max * slack)) return t;
  const words = t.split(/\s+/);
  let out = '';
  for (const w of words) {
    const next = out ? out + ' ' + w : w;
    if (next.length > max) break;
    out = next;
  }
  out = out.replace(/[,;:—–-]+$/u, '').trim();
  const ws = out.split(/\s+/);
  while (ws.length > 1 && TAIL.test(ws[ws.length - 1].replace(/[,;:]/g, ''))) ws.pop();
  out = ws.join(' ').replace(/[,;:—–-]+$/u, '').trim();
  // бірде-бір сөз сыймаса (бір ұзын сөз) — сөзді өзі қалдырамыз, сыйғызу қозғалтқышы кегльді кішірейтеді
  return out || words[0];
}

const ROLE_TEXT = {
  title: 'main slide heading',
  accent: 'decorative calligraphic word printed over / next to the title',
  subtitle: 'short subtitle under the heading',
  card: { heading: 'card heading (key term or short phrase)', body: 'card text' },
  stat: { value: 'key figure (number)', label: 'caption explaining the figure' },
  body: 'text block',
  label: 'short label',
  tag: 'one word inside a small decorative badge',
  info: 'title-slide information line',
};
const roleText = (s) => (typeof ROLE_TEXT[s.role] === 'string' ? ROLE_TEXT[s.role] : (ROLE_TEXT[s.role] || {})[s.part] || s.role);

function slotLine(s) {
  const lim = s.min ? `${s.min}–${s.max} characters` : `≤ ${s.max} characters`;
  const extra = s.role === 'accent' ? ' — 1 word (2 at most); together with "t" it must read as ONE heading: "t" first, then this word completes it; never repeat a word of "t"'
    : s.role === 'stat' && s.part === 'value' ? ' — a REAL, well-known figure for this slide (year, date, percentage, count, amount with unit); NEVER invent statistics — if unsure, use a year or a date'
      : s.role === 'stat' && s.part === 'label' ? ' — says what the figure is'
        : s.role === 'card' && s.part === 'heading' ? ' — names exactly what its card text explains'
          : s.role === 'body' || (s.role === 'card' && s.part === 'body') ? ' — complete informative sentence(s) with concrete facts'
            : s.role === 'title' ? ' — states the point of the slide, no final period' : '';
  return `  "${s.key}": ${roleText(s)}, ${lim}${extra}`;
}

function sourceOf(slide) {
  const { title, body } = linesForSlide(slide || {});
  const notes = slide && (slide.notes || slide.speakerNotes);
  return JSON.stringify({ title, points: body, ...(notes ? { notes: String(notes).slice(0, 600) } : {}) });
}

function buildSlidesPrompt({ topic, language, deckTitle, items }) {
  const blocks = items.map(({ sch, slide }) => {
    const slots = sch.slots.filter((s) => !s.deck && s.role !== 'credit' && s.role !== 'info');
    const lines = slots.map(slotLine);
    if (sch.logo) {
      const what = sch.kind === 'end' ? 'a closing word of thanks written in giant letters (e.g. ["Рахмет"])' : sch.kind === 'cover' ? 'the presentation title written in giant letters (e.g. ["Кино","тарихы"])' : 'the slide heading written in giant letters';
      lines.unshift(`  "logo": array of exactly ${sch.logo.words} real word(s), each ≤ ${sch.logo.wordMax} letters — ${what}`);
    }
    return `Slide ${sch.index} (${sch.kind}) — facts to use: ${sourceOf(slide)}
Write these slots:
${lines.join('\n') || '  (no text slots)'}`;
  }).join('\n\n');
  return `Presentation: "${deckTitle || topic}" (topic: ${topic}).
Language of ALL text: ${language || 'Kazakh'} (except proper names and figures). Never leave English template words.

A client's designed PPTX template has fixed text boxes. Each slot below is ONE box with a role and a character limit (including spaces).
Write the text for every slot:
- obey every limit; shorter is fine, longer is not; never end with "…";
- every slot gets meaningful text — no empty slots, no filler ("plays an important role", "is very important");
- use the given facts of the slide; be specific, accurate and professional; never invent people, companies or statistics;
- slots of one slide must not repeat each other; parallel slots (cards, figures) have parallel form;
- the cover's title is the presentation title; the last slide may thank the audience.

${blocks}

Return JSON only: {"slides":[{"index":<number>,"slots":{"<key>":"<text>"},"logo":["…"]}]}  ("logo" only where asked)`;
}

function buildDeckPrompt({ topic, language, deckTitle, chrome, tags }) {
  const lines = [];
  for (const c of chrome) {
    lines.push(`  "${c.key}": small text repeated on every slide (${c.y < 0.5 ? 'header' : 'footer'}, ${c.x < 0.33 ? 'left' : c.x > 0.66 ? 'right' : 'center'}${c.bold ? ', bold' : ''}); template had "${c.orig}"; ≤ ${c.max} characters`);
  }
  for (const t of tags) lines.push(`  "${t.key}": one word printed inside a small decorative badge${t.count > 1 ? ` on ${t.count} slides` : ''}; template had "${t.orig}"; ≤ ${t.max} characters`);
  return `Presentation: "${deckTitle || topic}" (topic: ${topic}). Language: ${language || 'Kazakh'}.

These are the decorative/navigation texts of a designed template (brand line, menu items, badges). Replace each English template word with a SHORT text in the presentation language that fits THIS presentation and keeps the same function:
- brand-like texts → a short name of the presentation;
- menu items → short section names of this presentation (all different);
- badges → one short relevant word (e.g. "КИНО");
- obey the limits; never leave English template words.

${lines.join('\n')}

Return JSON only: {"deck":{"<key>":"<text>"}}`;
}

/** Бір слоттың ақауы (null — дұрыс). */
function slotProblem(s, text, language) {
  const t = clean(text);
  if (!t) return 'empty';
  if (/…|\.{3}$/.test(String(text))) return 'ends with "…"';
  if (s.max && t.length > Math.ceil(s.max * 1.1)) return `${t.length} characters, limit ${s.max}`;
  if (s.min && t.length < s.min * 0.8) return `only ${t.length} characters, needs at least ${s.min}`;
  if (s.orig && t.toLowerCase() === String(s.orig).toLowerCase() && /[a-z]/i.test(s.orig) && wantsCyr(language)) return 'left the English template text';
  if (s.role === 'stat' && s.part === 'value' && !/\d/.test(t) && !hasCyr(t)) return 'a figure must contain a number';
  if (wantsCyr(language) && !hasCyr(t) && !(s.role === 'stat' && s.part === 'value') && /[a-z]{4,}/i.test(t) && !/^[A-Z][\w.+-]*(\s[A-Z0-9][\w.+-]*)*$/.test(t)) return 'not in the presentation language';
  return null;
}

/** Детерминді қорғаныс: LLM бермеген/қате слотқа жалпы мазмұннан мәтін. */
function fallbackFor(s, slide, used) {
  const { title, body } = linesForSlide(slide || {});
  const take = (pred) => { const i = body.findIndex((b, k) => !used.has(k) && pred(b)); if (i < 0) return ''; used.add(i); return body[i]; };
  switch (s.role) {
    case 'title': return title;
    case 'subtitle': return take((b) => b.length <= s.max * 1.3) || '';
    case 'card': {
      if (s.part === 'heading') { const b = take(() => true); const m = b.match(/^([^:–—]{2,40})[:–—]\s*(.+)$/); s._carry = m ? m[2] : b; return m ? m[1] : b.split(/\s+/).slice(0, 3).join(' '); }
      return '';
    }
    case 'body': return take(() => true);
    case 'label': return take((b) => b.length <= s.max * 1.5);
    default: return '';
  }
}

const lineOf = (c) => (c.label ? `${c.label}: ${c.value}` : c.value);

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

/**
 * @param {object} o
 * @param {object} o.schema — analyzeTemplate(...) нәтижесі
 * @param {Array}  o.slides — жалпы мазмұн (generateSlides нәтижесі; әр слайдтың фактілері)
 * @param {string} o.topic, o.language, o.deckTitle
 * @param {object} [o.coverMeta] — { performedBy, checkedBy, group, university, faculty, department }
 * @param {Function} [o.llm] — deepseekJson сигнатурасы
 * @param {Function} [o.creditLines] — (coverMeta, language) → [{label, value}]
 */
async function writeSlots(o) {
  const { schema, slides, topic, language } = o;
  const llm = o.llm || require('../../core/llm').deepseekJson;
  const deckTitle = o.deckTitle || topic;
  const report = { llmFailed: 0, retried: 0, fallback: 0, problems: [] };

  // ── 1) бүкіл презентация деңгейі: chrome + tag ────────────────────────
  const deck = {};
  const deckSlots = [...schema.deck.chrome.map((c) => ({ ...c, role: 'chrome' })), ...schema.deck.tags.filter((t) => t.count > 1).map((t) => ({ ...t, role: 'tag' }))];
  if (deckSlots.length) {
    try {
      const r = await llm('You localise the decorative texts of a presentation template. Respond with valid JSON only.',
        buildDeckPrompt({ topic, language, deckTitle, chrome: schema.deck.chrome, tags: schema.deck.tags.filter((t) => t.count > 1) }),
        'template-deck', 800, { temperature: 0.3, timeoutMs: 45_000 });
      for (const s of deckSlots) {
        const v = clean(r && r.deck && r.deck[s.key]);
        if (v && !slotProblem(s, v, language)) deck[s.key] = fitToLimit(v, s.max);
      }
    } catch (e) { report.llmFailed++; console.warn(`[TemplateWriter] deck LLM failed: ${e.message}`); }
    // қорғаныс: брендке — презентацияның қысқа атауы; қалғаны бос (ағылшын мәтін қалмайды)
    const brand = schema.deck.chrome.find((c) => c.bold) || schema.deck.chrome[0];
    for (const s of deckSlots) {
      if (deck[s.key] != null) continue;
      report.fallback++;
      deck[s.key] = s === brand || (brand && s.key === brand.key) ? fitToLimit(deckTitle, s.max) : '';
    }
  }

  // ── 2) слайдтар ─────────────────────────────────────────────────────
  const out = schema.slides.map(() => ({ texts: {}, logo: null }));
  const items = schema.slides.map((sch, i) => ({ sch, slide: slides[i] || {} }));
  const llmSlots = (sch) => sch.slots.filter((s) => !s.deck && s.role !== 'credit' && s.role !== 'info');
  const todo = items.filter(({ sch }) => llmSlots(sch).length || sch.logo);
  const runGroup = async (group) => {
    const r = await llm('You write slide text that fits the fixed text boxes of a designed template. Respond with valid JSON only.',
      buildSlidesPrompt({ topic, language, deckTitle, items: group }), 'template-slots', 3500, { temperature: 0.4, timeoutMs: 90_000 });
    for (const s of Array.isArray(r && r.slides) ? r.slides : []) {
      const i = Number(s && s.index) - 1;
      if (!out[i] || !group.some((g) => g.sch.index === i + 1)) continue;
      for (const [k, v] of Object.entries((s && s.slots) || {})) out[i].texts[k] = clean(v);
      if (Array.isArray(s.logo)) out[i].logo = s.logo.map(clean).filter(Boolean);
    }
  };
  for (const group of chunk(todo, BATCH)) {
    try { await runGroup(group); } catch (e) {
      report.llmFailed++;
      console.warn(`[TemplateWriter] slides ${group.map((g) => g.sch.index).join(',')} LLM failed: ${e.message}`);
      // жауап кесілсе/құласа — слайдтарды жеке-жеке (қысқа жауап) қайта сұраймыз
      if (group.length > 1) {
        for (const one of group) {
          try { await runGroup([one]); } catch (e2) { report.llmFailed++; console.warn(`[TemplateWriter] slide ${one.sch.index} LLM failed: ${e2.message}`); }
        }
      }
    }
  }

  // ── 3) тексеру → тек қате слоттарды бір рет қайта жаздыру ───────────────
  const problemsOf = () => {
    const list = [];
    items.forEach(({ sch }, i) => {
      for (const s of llmSlots(sch)) { const p = slotProblem(s, out[i].texts[s.key], language); if (p) list.push({ i, s, p }); }
      if (sch.logo) {
        const w = out[i].logo || [];
        if (w.length !== sch.logo.words || w.some((x) => lettersOf(x).length > sch.logo.wordMax)) list.push({ i, s: { key: 'logo' }, p: `needs exactly ${sch.logo.words} word(s), each ≤ ${sch.logo.wordMax} letters` });
      }
    });
    return list;
  };
  let probs = problemsOf();
  if (probs.length) {
    report.retried = probs.length;
    const bySlide = new Map();
    for (const x of probs) { if (!bySlide.has(x.i)) bySlide.set(x.i, []); bySlide.get(x.i).push(x); }
    for (const group of chunk([...bySlide.entries()], 4)) {
      const text = group.map(([i, list]) => `Slide ${i + 1} — facts: ${sourceOf(items[i].slide)}
Current slots: ${JSON.stringify(out[i].texts)}
Fix these slots:
${list.map((x) => (x.s.key === 'logo' ? `  "logo": ${x.p}` : `${slotLine(x.s)}  ← PROBLEM: ${x.p}`)).join('\n')}`).join('\n\n');
      try {
        const r = await llm('You fix slide text so it fits fixed template boxes. Respond with valid JSON only.',
          `Presentation: "${deckTitle}". Language: ${language || 'Kazakh'}.\nRewrite ONLY the listed slots so that each problem is solved (obey the limits, complete phrases, no "…", no English template words).\n\n${text}\n\nReturn JSON only: {"slides":[{"index":<number>,"slots":{"<key>":"<text>"},"logo":["…"]}]}`,
          'template-slots-fix', 2500, { temperature: 0.3, timeoutMs: 60_000 });
        for (const s of Array.isArray(r && r.slides) ? r.slides : []) {
          const i = Number(s && s.index) - 1;
          if (!out[i]) continue;
          const want = new Set((bySlide.get(i) || []).map((x) => x.s.key));
          for (const [k, v] of Object.entries((s && s.slots) || {})) if (want.has(k)) out[i].texts[k] = clean(v);
          if (want.has('logo') && Array.isArray(s.logo)) out[i].logo = s.logo.map(clean).filter(Boolean);
        }
      } catch (e) { report.llmFailed++; console.warn(`[TemplateWriter] fix LLM failed: ${e.message}`); }
    }
    probs = problemsOf();
  }

  // ── 4) детерминді қорғаныс ───────────────────────────────────────────
  items.forEach(({ sch, slide }, i) => {
    const used = new Set();
    const t = out[i].texts;
    for (const s of llmSlots(sch)) {
      let v = t[s.key];
      const p = slotProblem(s, v, language);
      if (p === 'empty' || p === 'left the English template text' || p === 'not in the presentation language') {
        v = fallbackFor(s, slide, used);
        if (s.role === 'card' && s.part === 'heading' && s._carry) {
          const bk = s.key.replace(/h$/, 'b');
          if (!t[bk] || slotProblem(sch.slots.find((x) => x.key === bk) || {}, t[bk], language)) t[bk] = s._carry;
        }
        report.fallback++;
      }
      t[s.key] = fitToLimit(v || '', s.max);
    }
    if (sch.logo) {
      let w = (out[i].logo || []).filter(Boolean);
      if (w.length !== sch.logo.words) {
        const src = String((slide && slide.title) || deckTitle).split(/\s+/).filter(Boolean);
        w = src.slice(0, sch.logo.words);
        report.fallback++;
      }
      out[i].logo = w;
    }
  });
  report.problems = probs.map((x) => `${x.i + 1}:${x.s.key}:${x.p}`);

  // ── 5) авторлар (детерминді) ──────────────────────────────────────────
  const credits = (o.creditLines ? o.creditLines(o.coverMeta, language) : []).filter((c) => c && c.value);
  const coverChrome = {};
  schema.slides.forEach((sch, i) => {
    if (sch.kind === 'content') return;
    const t = out[i].texts;
    const pairs = [];
    for (const s of sch.slots) {
      if (s.role !== 'credit') continue;
      const k = s.key.replace(/[lv]$/, '');
      let p = pairs.find((x) => x.k === k);
      if (!p) { p = { k }; pairs.push(p); }
      p[s.part === 'label' ? 'label' : 'value'] = s;
    }
    // Титул парағының стандарты: университет — жоғарыда; топ — орындаушының астында
    let queue = credits.slice();
    const take = (kind) => { const k = queue.findIndex((c) => c.kind === kind); return k < 0 ? null : queue.splice(k, 1)[0]; };
    if (sch.kind === 'cover') {
      const top = sch.slots.filter((s) => s.role === 'chrome' && s.yRel != null && s.yRel < 0.2).sort((a, b) => a.xRel - b.xRel)[0];
      const uni = queue.find((c) => c.kind === 'university');
      if (top && uni) { coverChrome[i] = coverChrome[i] || {}; coverChrome[i][top.key] = uni.value; queue = queue.filter((c) => c !== uni); }
    }
    const perf = queue.find((c) => c.kind === 'performed');
    const grp = queue.find((c) => c.kind === 'group');
    if (perf && grp && pairs.length) { perf.extra = `${grp.label}: ${grp.value}`; queue = queue.filter((c) => c !== grp); }
    for (const p of pairs) {
      const c = take('performed') || take('checked') || queue.shift();
      if (p.label) t[p.label.key] = c ? caseLike(p.label.orig, c.label, 'label') : '';
      if (p.value) t[p.value.key] = c ? caseLike(p.value.orig, (p.label ? c.value : lineOf(c)) + (c.extra ? `\n${c.extra}` : ''), 'label') : '';
    }
    // жұп жоқ немесе жетпесе: титул ақпарат жолдары → (титулдағы) белгілер → subtitle-ге қосымша жол
    if (sch.kind === 'cover') {
      // қалған титул жолдары бір блокта, табиғи ретпен (орындаған → тексерген → топ → …) — ең үлкен ақпарат орнына
      const infos = sch.slots.filter((s) => s.role === 'info').sort((a, b) => b.max - a.max);
      if (infos.length && queue.length) {
        t[infos[0].key] = queue.map(lineOf).join('\n');
        queue = [];
        for (const s of infos.slice(1)) t[s.key] = '';
      } else for (const s of infos) t[s.key] = '';
      if (queue.length) {
        const sub = sch.slots.find((s) => s.role === 'subtitle');
        const extra = queue.map(lineOf).join('\n');
        if (sub) t[sub.key] = t[sub.key] && (t[sub.key].length + extra.length) <= sub.max * 1.5 ? `${t[sub.key]}\n${extra}` : extra;
      }
    } else {
      for (const s of sch.slots.filter((x) => x.role === 'info')) if (!t[s.key]) t[s.key] = '';
    }
  });

  // ── 6) id → жолдар ───────────────────────────────────────────────────
  // бір жолға арналған қысқа қораптар: тасымалданбайды (сөз үзілмейді), сыймаса кегль кішірейеді
  const SINGLE = new Set(['tag', 'chrome', 'credit', 'stat', 'label', 'accent', 'info']);
  const plan = schema.slides.map((sch, i) => {
    const byId = {};
    const single = {};
    for (const s of sch.slots) {
      let v = s.deck ? (coverChrome[i] && coverChrome[i][s.key] != null ? coverChrome[i][s.key] : deck[s.key]) : out[i].texts[s.key];
      if (v == null) v = '';
      v = caseLike(s.orig, v, s.role);
      byId[s.id] = v ? String(v).split('\n').map((x) => x.trim()).filter(Boolean) : [];
      if (s.oneLine && (SINGLE.has(s.role) || s.role === 'title' || (s.role === 'card' && s.part === 'heading'))) single[s.id] = true;
    }
    return { byId, single, logo: out[i].logo || null };
  });
  return { plan, deck, report };
}

module.exports = { writeSlots, buildSlidesPrompt, buildDeckPrompt, slotProblem, fitToLimit, caseLike, slotLine };
