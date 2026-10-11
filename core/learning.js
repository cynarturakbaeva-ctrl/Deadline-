'use strict';
/**
 * Үйрену жүйесінің талдау қабаты (таза функциялар, БД-сыз).
 *   templates — listLearnedTemplates() нәтижесі: [{ fingerprint, uses, data: readTemplate(...) }]
 *   uses      — listLearnUses() нәтижесі: [{ fingerprint, topic, topicWords, outcome, fit, rating, ... }]
 *
 * Бұл кезеңде жүйе ЕШТЕҢЕНІ автоматты өзгертпейді: тек жинақтайды және көрсетеді.
 * Ережелер деректі бірге қарап шыққан соң, саналы түрде енгізіледі.
 */

const STOP = new Set(['және', 'туралы', 'үшін', 'негіздері', 'при', 'для', 'про', 'the', 'and', 'for', 'about', 'with', 'from']);

/** Тақырыптан іздеуге жарамды сөздер (кіші әріп, ≥4 әріп, ең көбі 12). */
function topicWords(topic) {
  const seen = new Set();
  for (const w of String(topic || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length >= 4 && !STOP.has(w)) seen.add(w);
    if (seen.size >= 12) break;
  }
  return [...seen];
}

const inc = (m, k, d = 1) => { if (k != null && k !== '') m.set(k, (m.get(k) || 0) + d); };
const top = (m, n = 5) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const avg1 = (a) => { const s = a.filter(Number.isFinite); return s.length ? Math.round((s.reduce((x, y) => x + y, 0) / s.length) * 10) / 10 : null; };

/** Сыйғызу таза өтті ме (қалған ақау жоқ). */
const cleanFit = (u) => u && u.outcome === 'done' && !(u.fit && u.fit.after > 0) && !(u.fit && u.fit.qa && u.fit.qa.found > u.fit.qa.fixed);

/** Слайд макет «отбасылары»: бірдей қолтаңбасы бар слайдтар әртүрлі шаблонда қанша рет кездесті. */
function layoutFamilies(templates) {
  const fam = new Map();
  for (const t of templates || []) {
    const seenHere = new Set();
    for (const s of (t.data && t.data.slides) || []) {
      if (!s.signature || seenHere.has(s.signature)) continue;
      seenHere.add(s.signature);
      const f = fam.get(s.signature) || { signature: s.signature, templates: 0, archetypes: new Map(), roles: new Map() };
      f.templates += 1; inc(f.archetypes, s.archetype); inc(f.roles, s.role);
      fam.set(s.signature, f);
    }
  }
  return [...fam.values()].sort((a, b) => b.templates - a.templates)
    .map((f) => ({ signature: f.signature, templates: f.templates, archetype: (top(f.archetypes, 1)[0] || [null])[0], role: (top(f.roles, 1)[0] || [null])[0] }));
}

function aggregate(templates, uses) {
  const T = (templates || []).filter((t) => t && t.data);
  const U = (uses || []).filter(Boolean);
  const pair = new Map(); const titleCls = new Map(); const bodyCls = new Map(); const arche = new Map(); const sizes = new Map();
  const titleRel = []; const bodyRel = []; const hier = []; const mLeft = []; const mTop = []; const words = [];
  let dark = 0; let slidesTotal = 0;
  for (const t of T) {
    const d = t.data; const tp = d.template || {};
    if (tp.pairing) {
      inc(pair, [tp.pairing.title, tp.pairing.body].filter(Boolean).join(' + '));
      inc(titleCls, tp.pairing.titleClass); inc(bodyCls, tp.pairing.bodyClass);
    }
    inc(sizes, tp.slideCount);
    if (tp.typography) { titleRel.push(tp.typography.titleSizeRel); bodyRel.push(tp.typography.bodySizeRel); hier.push(tp.typography.hierarchy); }
    if (tp.margins) { mLeft.push(tp.margins.left); mTop.push(tp.margins.top); }
    words.push(tp.avgWords);
    for (const s of d.slides || []) { inc(arche, s.archetype); slidesTotal += 1; }
    if (tp.darkBackgrounds && tp.slideCount && tp.darkBackgrounds / tp.slideCount >= 0.5) dark += 1;
  }
  const rated = U.filter((u) => u.rating != null);
  return {
    templates: T.length,
    slides: slidesTotal,
    uses: U.length,
    done: U.filter((u) => u.outcome === 'done').length,
    failed: U.filter((u) => u.outcome === 'failed').length,
    cleanFitPct: pct(U.filter(cleanFit).length, U.length),
    // соңғы тексеруші: қанша қолдануда геометриялық ақау табылды / бәрі түзелді
    qa: { withIssues: U.filter((u) => u.fit && u.fit.qa && u.fit.qa.found).length, allFixed: U.filter((u) => u.fit && u.fit.qa && u.fit.qa.found && u.fit.qa.fixed === u.fit.qa.found).length },
    rated: rated.length,
    avgRating: avg1(rated.map((u) => u.rating)),
    darkPct: pct(dark, T.length),
    typography: { titleSizeRel: median(titleRel), bodySizeRel: median(bodyRel), hierarchy: median(hier) },
    margins: { left: median(mLeft), top: median(mTop) },
    avgWordsPerSlide: median(words),
    topPairs: top(pair), titleClasses: top(titleCls), bodyClasses: top(bodyCls),
    topArchetypes: top(arche, 8), topSlideCounts: top(sizes),
    families: layoutFamilies(T).slice(0, 10),
  };
}

/**
 * Тақырыпқа ұқсас бұрынғы қолданулар: ортақ сөз саны + сапа (таза сыйды, баға) бойынша.
 * @returns {Array<{fingerprint, topic, score, rating, outcome}>}
 */
function similar(uses, topic, limit = 5) {
  const w = new Set(topicWords(topic));
  if (!w.size) return [];
  const out = [];
  for (const u of uses || []) {
    if (!u) continue;
    const common = (u.topicWords || []).filter((x) => w.has(x)).length;
    if (!common) continue;
    const quality = (cleanFit(u) ? 0.5 : 0) + (u.rating != null ? (u.rating - 3) * 0.25 : 0) - (u.outcome === 'failed' ? 1 : 0);
    out.push({ fingerprint: u.fingerprint, topic: u.topic, rating: u.rating, outcome: u.outcome, score: Math.round((common + quality) * 100) / 100 });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = { topicWords, aggregate, similar, layoutFamilies, cleanFit };
