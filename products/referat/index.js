'use strict';
/**
 * Реферат генераторы (.docx).
 *  Талаптар (университет рефераттарының стандартты критерийлері):
 *   - Титул беті, Мазмұны (бет нөмірлерімен), Кіріспе, Негізгі бөлім (тараулар), Қорытынды, Әдебиеттер тізімі
 *   - Times New Roman 14, жол аралығы 1.5, жиектер 30/10/20/20 мм, қызыл жол 1.25 см, мәтін ені бойынша тураланған
 *   - Бет нөмірі төменде ортада, титулда нөмір жоқ
 *   - БОС ОРЫН ЖОҚ: тараулар жаңа беттен басталмайды, тақырып беттің түбінде жалғыз қалмайды,
 *     көлем сұралған бет санына дәл келтіріледі және соңғы бет дерлік толық болады.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { recordApiUsage } = require('../../core/cost');
const { buildDocx } = require('./docx');
const { paginate, splitSentences, PAGE_LINES } = require('./layout');

const LANG_NAME = { kk: 'Kazakh', ru: 'Russian', en: 'English' };
const HEAD = {
  kk: { intro: 'Кіріспе', concl: 'Қорытынды', refs: 'Әдебиеттер тізімі' },
  ru: { intro: 'Введение', concl: 'Заключение', refs: 'Список литературы' },
  en: { intro: 'Introduction', concl: 'Conclusion', refs: 'References' },
};
const AVG_CPL = 73;                 // орташа таңба/жол (жоспарлау үшін)
const FILL_MIN = 0.88;              // соңғы бет кемінде осыншалық толуы тиіс
const FILL_MAX = 0.97;              // ... және артық бет шықпауы үшін осыдан аспауы тиіс

function normLang(l) {
  const s = String(l || '').toLowerCase();
  if (s === 'ru' || s.startsWith('rus') || s.includes('рус') || s.includes('орыс')) return 'ru';
  if (s === 'en' || s.startsWith('eng') || s.includes('англ') || s.includes('ағылшын')) return 'en';
  return 'kk';
}

// ─── DeepSeek (JSON) ─────────────────────────────────────────────────────
async function deepseekJson(system, user, label, maxTokens = 8000) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error('DEEPSEEK_API_KEY жоқ');
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        signal: controller.signal,
        body: JSON.stringify({
          model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
          thinking: { type: 'disabled' },
          temperature: 0.7,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
      if (!res.ok) throw new Error(`[${res.status}] ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      recordApiUsage(data.usage || null, { label: 'referat:' + label, model: 'deepseek' });
      const text = data.choices?.[0]?.message?.content || '';
      if (!text) throw new Error('empty response');
      try { return JSON.parse(text); } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('invalid JSON');
        return JSON.parse(m[0]);
      }
    } catch (e) {
      lastErr = e;
      console.warn(`[Referat] ${label} attempt ${attempt + 1} failed: ${e.message}`);
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

// ─── Көлем жоспары ───────────────────────────────────────────────────────
function planFor(pages) {
  const bodyPages = pages - 2; // титул + мазмұны
  const totalLines = bodyPages * PAGE_LINES * 0.93;
  const chapters = pages <= 7 ? 2 : pages <= 22 ? 3 : 4;
  const subs = pages >= 9 ? 2 : 0;
  const refsCount = pages <= 7 ? 5 : pages <= 12 ? 8 : pages <= 20 ? 10 : 12;
  const refsLines = refsCount * 1.3 + 1;
  const introLines = Math.max(7, totalLines * 0.11);
  const conclLines = Math.max(6, totalLines * 0.08);
  const headLines = (chapters * 1.6) + (chapters * subs * 1.2);
  const chapLines = Math.max(10, totalLines - introLines - conclLines - refsLines - headLines);
  const unitCount = subs ? chapters * subs : chapters;
  return {
    bodyPages, chapters, subs, refsCount,
    introChars: Math.round(introLines * AVG_CPL),
    conclChars: Math.round(conclLines * AVG_CPL),
    unitChars: Math.round((chapLines / unitCount) * AVG_CPL),
  };
}

// ─── Мәтінді тазалау ─────────────────────────────────────────────────────
function cleanPara(t, maxCite) {
  let s = String(t || '')
    .replace(/\*\*|__|`|^#+\s*/g, '')
    .replace(/^\s*[-•*]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  // жоқ дереккөзге сілтемелерді өшіру
  s = s.replace(/\s?\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, (m, inner) => {
    const nums = inner.split(/[,–-]/).map(x => parseInt(x, 10)).filter(Boolean);
    return nums.every(n => n >= 1 && n <= maxCite) ? m : '';
  });
  return s;
}

function parseParagraphs(obj, maxCite) {
  const arr = Array.isArray(obj?.paragraphs) ? obj.paragraphs : (typeof obj?.text === 'string' ? obj.text.split(/\n{2,}/) : []);
  return arr.map(p => cleanPara(p, maxCite)).filter(p => p.length > 60);
}

const styleRules = (lang, prof) => `
You are an academic writer producing a university referat (essay-report). Output language: ${LANG_NAME[lang]} ONLY (every sentence), even if the topic is given in another language.
Rules:
- Formal academic prose, coherent, specific, informative. No filler, no repetition of the same idea, no meta-comments about the text itself.
- Plain text paragraphs only: NO markdown, NO bullet lists, NO numbered lists, NO headings inside paragraphs.
- Each paragraph 500-900 characters (4-7 sentences), starting with a clear topic sentence.
- Do NOT invent statistics, dates, laws or quotations. Use only facts you are sure about; otherwise describe in general terms.
- Cite sources with square-bracket numbers like [1] or [2, 3] ONLY from the provided numbered source list, roughly one citation per 1-2 paragraphs where relevant.
- Return JSON only.${prof ? '\n' + sampleRules(prof) : ''}`;

// ─── Үлгі реферат (мұғалім қабылдаған/талап еткен) — терең талдау ───────────────
/**
 * Үлгі мәтінінен «профиль» шығарады: құрылым (тарау/бөлім саны), бөлім атаулары, кіріспе элементтері,
 * жазу стилі, сілтеме және әдебиет форматы, мұғалімнің байқалатын талаптары. Мазмұны КӨШІРІЛМЕЙДІ —
 * тек форма мен стиль үлгі ретінде алынады. Қате болса null (реферат әдеттегідей жасалады).
 */
async function analyzeSample(llm, sampleText, lang) {
  const text = String(sampleText || '').replace(/\s+\n/g, '\n').trim();
  if (text.length < 400) return null;
  // ұзын үлгі: басы (титул, мазмұны, кіріспе), ортасы және соңы (қорытынды, әдебиет) — құрылым толық көрінсін
  const N = 24000;
  const body = text.length <= N ? text
    : text.slice(0, 12000) + '\n…\n' + text.slice(Math.floor(text.length / 2) - 3000, Math.floor(text.length / 2) + 3000) + '\n…\n' + text.slice(-6000);
  const system = 'You are an experienced university teacher who analyses a sample referat (one the teacher accepts) to extract its exact requirements and form. Return JSON only.';
  const user = `Below is a SAMPLE referat that the teacher accepted. Analyse it deeply: its structure, section naming, what the introduction contains, academic style, paragraph length, how citations are made in the text, how the reference list is formatted, and any requirements the teacher evidently expects.
Do NOT summarise its topic content — we only need its FORM, so a new referat on a different topic can follow it.

SAMPLE:
"""
${body}
"""

JSON schema (write string values in ${LANG_NAME[lang]}, except where an example must be copied verbatim from the sample):
{"chapters": <number of main chapters in the main part, integer>,
 "subsections": <sub-sections per chapter: 0 if none, else typical integer>,
 "headings": {"intro":"exact heading used for the introduction","conclusion":"exact heading for the conclusion","references":"exact heading for the reference list"},
 "intro_elements": ["elements the introduction contains, e.g. relevance, aim, tasks, object, subject, methods, structure"],
 "style": "2-3 sentences: tone, person (we/impersonal), sentence complexity, use of examples/definitions/tables",
 "paragraph_chars": <typical paragraph length in characters, integer>,
 "citations": "brackets" | "brackets_with_pages" | "footnotes" | "none",
 "citation_example": "one in-text citation copied verbatim from the sample, or empty",
 "reference_example": "one reference list entry copied verbatim from the sample, or empty",
 "reference_count": <number of entries in the reference list, integer>,
 "chapter_title_style": "how chapter titles are phrased (e.g. theoretical chapter first, then practical/analysis)",
 "requirements": ["other requirements the teacher evidently expects, max 6 short items"]}`;
  let o;
  try { o = await llm(system, user, 'sample', 3000); } catch (e) { console.warn('[Referat] sample analysis failed:', e.message); return null; }
  if (!o || typeof o !== 'object') return null;
  const int = (v, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null; };
  const str = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const head = (v) => str(v, 60).replace(/^\s*\d+(\.\d+)*[.)]?\s*/, '');
  const arr = (v, n, k) => (Array.isArray(v) ? v : []).map((x) => str(x, k)).filter(Boolean).slice(0, n);
  const prof = {
    chapters: int(o.chapters, 2, 5),
    subs: int(o.subsections, 0, 3),
    headings: { intro: head(o.headings && o.headings.intro), concl: head(o.headings && o.headings.conclusion), refs: head(o.headings && o.headings.references) },
    introElements: arr(o.intro_elements, 8, 40),
    style: str(o.style, 400),
    paraChars: int(o.paragraph_chars, 300, 1400),
    citations: ['brackets', 'brackets_with_pages', 'footnotes', 'none'].includes(o.citations) ? o.citations : 'brackets',
    citationExample: str(o.citation_example, 40),
    referenceExample: str(o.reference_example, 220),
    refCount: int(o.reference_count, 3, 25),
    chapterStyle: str(o.chapter_title_style, 250),
    requirements: arr(o.requirements, 6, 160),
  };
  console.log(`[Referat] sample profile: chapters=${prof.chapters} subs=${prof.subs} cite=${prof.citations} refs=${prof.refCount} heads=${JSON.stringify(prof.headings)}`);
  return prof;
}

/** Профильді LLM-ге берілетін қысқа нұсқаулыққа айналдырады. */
function sampleRules(prof) {
  if (!prof) return '';
  const L = [];
  L.push('FOLLOW THE TEACHER-ACCEPTED SAMPLE (form and style only; never copy its sentences):');
  if (prof.style) L.push('- Style: ' + prof.style);
  if (prof.introElements.length) L.push('- The introduction must contain: ' + prof.introElements.join(', ') + '.');
  if (prof.chapterStyle) L.push('- Chapter logic: ' + prof.chapterStyle);
  if (prof.citations === 'none') L.push('- Do NOT put in-text citations.');
  else if (prof.citationExample) L.push(`- In-text citations look like: ${prof.citationExample} (use the numbered source list).`);
  if (prof.requirements.length) L.push('- Also: ' + prof.requirements.join('; ') + '.');
  return L.join('\n');
}

async function genOutline(llm, topic, lang, plan, brief) {
  const system = `You plan a university referat. Output language: ${LANG_NAME[lang]} ONLY. Return JSON only.`;
  const user = `Topic: ${topic}
${brief ? 'Student brief / requirements: ' + brief + '\n' : ''}${plan.sampleRules ? plan.sampleRules + '\n' : ''}Create the structure of a referat with exactly ${plan.chapters} main chapters${plan.subs ? `, each with exactly ${plan.subs} sub-sections` : ' (no sub-sections)'}.
Also list exactly ${plan.refsCount} references (spisok literatury).
REFERENCE RULES (very important): include ONLY real, well-known, verifiable sources that you are certain exist: classic or standard textbooks, major monographs, official laws/documents, well-known international organization reports or official websites. NEVER invent authors, titles, DOIs, page numbers or URLs. If you are not certain of exact details, cite the work at the level you are sure about (author, title, city, year) and skip anything uncertain. Format ${plan.refExample ? 'exactly like this sample entry: ' + plan.refExample : 'in GOST style (Author. Title. – City: Publisher, Year.)'}, WITHOUT a leading number.
JSON schema:
{"title":"concise formal title of the referat (no quotes)",
 "intro_focus":"1 sentence: relevance/aim/tasks to cover",
 "chapters":[{"title":"chapter title"${plan.subs ? ',"sections":[{"title":"sub-section title","focus":"what it covers"}]' : ',"focus":"what it covers"'}}],
 "conclusion_focus":"1 sentence",
 "references":["..."]}
Titles must be specific and not start with numbers.`;
  const o = await llm(system, user, 'outline', 4000);
  const chapters = (o.chapters || []).slice(0, plan.chapters).map(c => ({
    title: String(c.title || '').replace(/^\s*\d+(\.\d+)*[.)]?\s*/, '').trim(),
    focus: c.focus || '',
    sections: plan.subs ? (c.sections || []).slice(0, plan.subs).map(s => ({
      title: String(s.title || '').replace(/^\s*\d+(\.\d+)*[.)]?\s*/, '').trim(), focus: s.focus || '',
    })) : [],
  }));
  if (chapters.length < 2 || chapters.some(c => !c.title) || (plan.subs && chapters.some(c => c.sections.length < plan.subs || c.sections.some(s => !s.title)))) {
    throw new Error('outline invalid');
  }
  const refs = (o.references || []).map(r => String(r).replace(/^\s*\d+[.)]\s*/, '').trim()).filter(r => r.length > 8).slice(0, plan.refsCount);
  return {
    title: String(o.title || topic).replace(/["«»]/g, '').trim().slice(0, 160) || topic,
    introFocus: o.intro_focus || '', conclFocus: o.conclusion_focus || '',
    chapters, refs,
  };
}

function outlineText(ol) {
  return ol.chapters.map((c, i) => `${i + 1}. ${c.title}` + (c.sections.length ? ' → ' + c.sections.map((s, j) => `${i + 1}.${j + 1} ${s.title}`).join('; ') : '')).join('\n');
}

async function writeUnit(llm, ctx, unit) {
  const pc = (ctx.prof && ctx.prof.paraChars) || 700;
  const nPar = Math.max(1, Math.round(unit.chars / pc));
  const srcList = ctx.ol.refs.map((r, i) => `[${i + 1}] ${r}`).join('\n');
  const system = styleRules(ctx.lang, ctx.prof);
  const user = `Referat title: ${ctx.ol.title}
Topic: ${ctx.topic}
Full structure:
${outlineText(ctx.ol)}

Write ONLY this part: "${unit.title}" (${unit.role}).
Focus: ${unit.focus || '—'}
Length: about ${unit.chars} characters in total = ${nPar} paragraphs of about ${pc} characters each. Stay within this part; do not repeat other parts.
${unit.extra || ''}
Numbered source list for citations:
${srcList && !(ctx.prof && ctx.prof.citations === 'none') ? srcList : '(none — do not cite)'}

JSON: {"paragraphs":["...", "..."]}`;
  const o = await llm(system, user, 'write', 6000);
  return parseParagraphs(o, ctx.ol.refs.length);
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// ─── Блоктарды құрастыру ─────────────────────────────────────────────────
/** sections: [{headType,heading,paras:[]}] → blocks */
function toBlocks(sections, refs, lang, refsHead) {
  const blocks = [];
  for (const s of sections) {
    if (s.heading) blocks.push({ type: s.headType, text: s.heading, secId: s.id });
    for (const p of s.paras) blocks.push({ type: 'p', text: p, secId: s.id });
  }
  blocks.push({ type: 'h1', text: refsHead || HEAD[lang].refs, secId: 'refs' });
  refs.forEach((r, i) => blocks.push({ type: 'ref', text: `${i + 1}. ${r.replace(/\.?\s*$/, '.')}`, secId: 'refs' }));
  return blocks;
}

function metrics(sections, refs, lang, bodyPages) {
  const blocks = toBlocks(sections, refs, lang, sections.refsHead);
  const sim = paginate(blocks);
  sim.forced.forEach(i => { blocks[i].forceBreak = true; });
  const total = (sim.pages - 1) * PAGE_LINES + sim.usedLastPage;
  const target = (bodyPages - 1) * PAGE_LINES + PAGE_LINES * ((FILL_MIN + FILL_MAX) / 2);
  const ok = sim.pages === bodyPages && sim.lastFill >= FILL_MIN && sim.lastFill <= FILL_MAX;
  return { blocks, sim, total, target, ok };
}

/** Ең ұзын бөлімнің соңынан бір сөйлемді алып тастау. */
function trimOne(sections) {
  const order = sections.filter(s => s.kind === 'body').sort((a, b) =>
    b.paras.reduce((n, p) => n + p.length, 0) - a.paras.reduce((n, p) => n + p.length, 0));
  for (const s of order) {
    for (let k = s.paras.length - 1; k >= 0; k--) {
      const sent = splitSentences(s.paras[k]);
      if (sent.length >= 4) {
        sent.pop();
        s.paras[k] = sent.join(' ');
        return true;
      }
    }
  }
  // соңғы амал: қорытындыдан
  for (const s of sections.filter(x => x.kind === 'concl' || x.kind === 'intro')) {
    for (let k = s.paras.length - 1; k >= 0; k--) {
      const sent = splitSentences(s.paras[k]);
      if (sent.length >= 4) { sent.pop(); s.paras[k] = sent.join(' '); return true; }
    }
  }
  return false;
}

async function growBy(llm, ctx, sections, missingLines) {
  const bodies = sections.filter(s => s.kind === 'body');
  // ең қысқа бөлімдерге қосамыз (ұзындықты теңестіру)
  const sorted = [...bodies].sort((a, b) => a.paras.reduce((n, p) => n + p.length, 0) - b.paras.reduce((n, p) => n + p.length, 0));
  let chars = Math.round(missingLines * AVG_CPL * 1.05);
  const jobs = [];
  for (const s of sorted) {
    if (chars < 350) break;
    const take = Math.min(chars, 1700);
    jobs.push({ s, take });
    chars -= take;
  }
  await pool(jobs, 3, async ({ s, take }) => {
    const unit = {
      title: s.heading || s.title, role: 'additional paragraphs continuing this part', focus: s.focus,
      chars: take,
      extra: `These paragraphs will be APPENDED to the existing text of this part. Existing text ends with: "${(s.paras[s.paras.length - 1] || '').slice(-220)}". Add NEW substantive content (examples, implications, comparison, problems, perspectives) without repeating what is already written.`,
    };
    try {
      const add = await writeUnit(llm, ctx, unit);
      if (add.length) s.paras.push(...add);
    } catch (e) { console.warn('[Referat] grow failed:', e.message); }
  });
}

/** Көлемді сұралған бетке дәл келтіру. */
async function fitToPages(llm, ctx, sections, refs, lang, bodyPages, onProgress) {
  for (let round = 0; round < 4; round++) {
    let m = metrics(sections, refs, lang, bodyPages);
    if (m.ok) return m;
    const diff = m.target - m.total; // + болса қосу керек
    if (diff > 5) {
      if (onProgress) await onProgress('fit', 'Көлем бетке келтірілуде...');
      await growBy(llm, ctx, sections, diff);
      continue;
    }
    // сөйлемдермен қию / аздап толықтыру
    let guard = 0;
    while (!m.ok && guard++ < 80) {
      if (m.total > m.target + 0.5 || m.sim.pages > bodyPages) {
        if (!trimOne(sections)) break;
      } else {
        break; // аздап тапшы — төменде шешіледі
      }
      m = metrics(sections, refs, lang, bodyPages);
    }
    if (m.ok) return m;
    if (m.target - m.total > 1.5) {
      await growBy(llm, ctx, sections, m.target - m.total + 3);
      continue;
    }
  }
  // соңғы қию
  let m = metrics(sections, refs, lang, bodyPages);
  let guard = 0;
  while ((m.sim.pages > bodyPages || (m.sim.pages === bodyPages && m.sim.lastFill > FILL_MAX)) && guard++ < 120 && trimOne(sections)) m = metrics(sections, refs, lang, bodyPages);
  return m;
}

/** Үлгі профилін көлем жоспарына қолданады: тарау/бөлім/әдебиет санын үлгідегідей етеді (бет саны көтерсе). */
function applyProfile(plan, prof, pages) {
  const unitsBudget = plan.unitChars * (plan.subs ? plan.chapters * plan.subs : plan.chapters);
  const ch = prof.chapters || plan.chapters;
  let subs = prof.subs == null ? plan.subs : (prof.subs >= 2 ? prof.subs : 0);
  // бір бөлімге кемінде ~1100 таңба қалсын, әйтпесе бөлімдерді азайтамыз
  const per = (c, sb) => unitsBudget / (sb ? c * sb : c);
  if (subs && per(ch, subs) < 1100) subs = per(ch, 2) >= 1100 ? 2 : 0;
  const chapters = per(ch, subs) >= 1100 ? ch : plan.chapters;
  if (chapters !== ch) subs = plan.subs;
  plan.chapters = chapters;
  plan.subs = subs;
  plan.unitChars = Math.round(per(chapters, subs));
  if (prof.refCount) plan.refsCount = Math.max(3, Math.min(prof.refCount, pages <= 7 ? 7 : 15));
  plan.refExample = prof.referenceExample || '';
  plan.sampleRules = sampleRules(prof);
}

// ─── Негізгі функция ─────────────────────────────────────────────────────
async function generateReferat(opts = {}) {
  const lang = normLang(opts.language);
  const topic = String(opts.topic || '').trim();
  if (topic.length < 3) throw new Error('topic too short');
  const pages = Math.max(5, Math.min(30, parseInt(opts.pages, 10) || 10));
  const meta = Object.assign({}, opts.meta || {});
  meta.year = meta.year || String(new Date().getFullYear());
  const onProgress = opts.onProgress || (async () => {});
  const llm = opts.llm || deepseekJson;
  const plan = planFor(pages);
  // Үлгі реферат берілсе: алдымен терең талдау, құрылым мен стиль соған бейімделеді
  let prof = null;
  if (opts.sample) {
    await onProgress('outline', 'Үлгі реферат талдануда...');
    prof = await analyzeSample(llm, opts.sample, lang);
  }
  if (prof) applyProfile(plan, prof, pages);
  console.log(`[Referat] topic="${topic.slice(0, 80)}" pages=${pages} lang=${lang} sample=${!!prof} plan=${JSON.stringify({ ...plan, sampleRules: undefined })}`);

  await onProgress('outline', 'Құрылым жасалуда...');
  let ol;
  for (let a = 0; a < 2 && !ol; a++) {
    try { ol = await genOutline(llm, topic, lang, plan, opts.brief); } catch (e) { console.warn('[Referat] outline retry:', e.message); if (a) throw e; }
  }
  const ctx = { topic, lang, ol, prof };

  // бөлімдер
  const H = { ...HEAD[lang] };
  if (prof) for (const k of ['intro', 'concl', 'refs']) if (prof.headings[k]) H[k] = prof.headings[k];
  const sections = [];
  sections.push({ id: 'intro', kind: 'intro', headType: 'h1', heading: H.intro, title: H.intro, focus: ol.introFocus, paras: [] });
  ol.chapters.forEach((c, ci) => {
    sections.push({ id: `c${ci}`, kind: c.sections.length ? 'chap' : 'body', headType: 'h1', heading: `${ci + 1} ${c.title}`, title: c.title, focus: c.focus, paras: [] });
    c.sections.forEach((s, si) => {
      sections.push({ id: `c${ci}s${si}`, kind: 'body', headType: 'h2', heading: `${ci + 1}.${si + 1} ${s.title}`, title: s.title, focus: s.focus, paras: [] });
    });
  });
  sections.push({ id: 'concl', kind: 'concl', headType: 'h1', heading: H.concl, title: H.concl, focus: ol.conclFocus, paras: [] });

  sections.refsHead = H.refs;
  await onProgress('write', 'Мәтін жазылуда...');
  const units = sections.filter(s => s.kind !== 'chap').map(s => ({
    s,
    chars: s.kind === 'intro' ? plan.introChars : s.kind === 'concl' ? plan.conclChars : plan.unitChars,
    role: s.kind === 'intro' ? 'introduction: relevance, aim, tasks, object, structure of the work' : s.kind === 'concl' ? 'conclusion: concise synthesis of findings, no new facts, no citations needed' : 'main part',
  }));
  let done = 0;
  await pool(units, 3, async (u) => {
    let paras = [];
    for (let a = 0; a < 2 && paras.length === 0; a++) {
      paras = await writeUnit(llm, ctx, { title: u.s.title, role: u.role, focus: u.s.focus, chars: u.chars });
    }
    if (!paras.length) throw new Error('empty section: ' + u.s.title);
    u.s.paras = paras;
    done++;
    await onProgress('write', `Мәтін жазылуда... (${done}/${units.length})`);
  });
  // тараудың өз кіріспе абзацы жоқ (тек тақырып) — ескертпе: 'chap' бөлімдерінде paras бос, тақырыптар қатар тұрады

  await onProgress('fit', 'Көлем реттелуде...');
  const m = await fitToPages(llm, ctx, sections, ol.refs, lang, plan.bodyPages, onProgress);
  console.log(`[Referat] fit: pages=${m.sim.pages}/${plan.bodyPages} lastFill=${m.sim.lastFill.toFixed(2)} ok=${m.ok}`);

  // мазмұны
  const tocEntries = [];
  m.blocks.forEach((b, i) => {
    if (b.type === 'h1' || b.type === 'h2') tocEntries.push({ level: b.type === 'h1' ? 1 : 2, text: b.text, page: m.sim.headingPages.get(i) + 2 });
  });

  await onProgress('docx', 'Word файлы жасалуда...');
  const buf = buildDocx({ lang, title: ol.title, meta, blocks: m.blocks, tocEntries });
  const file = path.join(os.tmpdir(), `deadline-referat-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.docx`);
  fs.writeFileSync(file, buf);

  const words = m.blocks.reduce((n, b) => n + (b.text.split(/\s+/).length), 0);
  return { docxPath: file, title: ol.title, pages: m.sim.pages + 2, words, fillOk: m.ok, lastFill: m.sim.lastFill };
}

module.exports = { generateReferat, planFor, normLang, analyzeSample, applyProfile, sampleRules };
