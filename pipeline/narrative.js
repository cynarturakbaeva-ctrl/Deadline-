'use strict';

/**
 * Deck-level narrative critic + bounded targeted repairs.
 * Judges the presentation AS A WHOLE — not only individual slides.
 *
 * Prefer deterministic transforms (reorder, merge, strengthen conclusion).
 * LLM repair is optional and limited to rewrite_section / strengthen_transition
 * for at most a few slides.
 */

const { recordApiUsage } = require('./cost');

const SEV = Object.freeze({ critical: 4, high: 3, medium: 2, low: 1 });
const DEEPSEEK_MODEL = process.env.QUALITY_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';

function words(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean);
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function issue(code, severity, affectedSlides, explanation, repairAction) {
  return {
    code,
    severity,
    severityRank: SEV[severity] || 2,
    affectedSlides: Array.isArray(affectedSlides) ? affectedSlides : [],
    explanation: String(explanation || '').slice(0, 280),
    repairAction: repairAction || 'none',
  };
}

function slideTitle(s) {
  return String(s && s.title || '').trim();
}

function isCover(s, i) {
  return i === 0 || /мұқаба|cover|титул|title slide/i.test(slideTitle(s));
}

function isClosing(s, i, n) {
  return i === n - 1 || /қорытынды|conclusion|резюме|summary|әдебиет|reference|takeaway/i.test(slideTitle(s));
}

/**
 * Deterministic deck-level narrative analysis.
 */
function analyzeNarrative(slides, title, topic) {
  const list = Array.isArray(slides) ? slides : [];
  const n = list.length;
  const issues = [];
  const titles = list.map(slideTitle);
  const topicN = norm(topic);
  const titleN = norm(title);

  // Slide count appropriateness
  if (n < 4) {
    issues.push(issue('inappropriate_slide_count', 'high', [], 'Deck is too short for a coherent arc', 'adjust_slide_count'));
  } else if (n > 16) {
    issues.push(issue('inappropriate_slide_count', 'medium', [], 'Deck is very long — risk of shallow or repetitive coverage', 'adjust_slide_count'));
  }

  // Title vs content mismatch
  if (titleN && titles.length) {
    const bodyText = norm(titles.join(' ') + ' ' + list.map((s) => (s.subtitle || '')).join(' '));
    const titleWords = titleN.split(' ').filter((w) => w.length > 3);
    const hit = titleWords.filter((w) => bodyText.includes(w)).length;
    if (titleWords.length >= 2 && hit / titleWords.length < 0.25) {
      issues.push(issue('title_content_mismatch', 'medium', [1], 'Presentation title weakly reflected in slide titles', 'strengthen_transition'));
    }
  }

  // Duplicate titles / redundancy
  const seen = new Map();
  titles.forEach((t, i) => {
    const k = norm(t);
    if (!k) return;
    if (seen.has(k)) {
      issues.push(issue('unnecessary_repetition', 'high', [seen.get(k), i + 1], `Duplicate theme: "${t.slice(0, 40)}"`, 'remove_redundancy'));
    } else seen.set(k, i + 1);
  });

  // Near-duplicate adjacent slides (title similarity)
  for (let i = 1; i < n; i++) {
    const a = norm(titles[i - 1]);
    const b = norm(titles[i]);
    if (a && b && (a.includes(b) || b.includes(a)) && a !== b) {
      issues.push(issue('unnecessary_repetition', 'medium', [i, i + 1], 'Adjacent slides share nearly the same title', 'merge_slides'));
    }
  }

  // Arc: need development in the middle
  if (n >= 5) {
    const mid = list.slice(1, -1);
    const midWeight = mid.reduce((sum, s) => {
      let w = words(s.title).length + words(s.subtitle).length + words(s.body).length;
      if (Array.isArray(s.bullets)) w += s.bullets.length * 3;
      return sum + w;
    }, 0);
    if (midWeight < mid.length * 6) {
      issues.push(issue('inconsistent_depth', 'medium', mid.map((_, i) => i + 2), 'Middle slides are thin — weak development', 'rebalance_information'));
    }
  }

  // Weak conclusion
  if (n >= 3) {
    const last = list[n - 1];
    const bullets = Array.isArray(last.bullets) ? last.bullets.filter(Boolean) : [];
    if (!isClosing(last, n - 1, n) && bullets.length < 2 && words(last.body).length < 8) {
      issues.push(issue('weak_conclusion', 'high', [n], 'Final slide does not function as a conclusion', 'strengthen_conclusion'));
    } else if (bullets.length === 0 && words(last.body).length < 5 && !/әдебиет|reference/i.test(slideTitle(last))) {
      issues.push(issue('weak_conclusion', 'medium', [n], 'Closing slide lacks takeaways', 'strengthen_conclusion'));
    }
  }

  // Abrupt transitions: topic keyword disappears then returns
  if (topicN && topicN.length > 4 && n >= 6) {
    const key = topicN.split(' ').filter((w) => w.length > 4).slice(0, 3);
    if (key.length) {
      const presence = list.map((s) => {
        const blob = norm([s.title, s.subtitle, s.body, ...(s.bullets || [])].join(' '));
        return key.some((k) => blob.includes(k));
      });
      for (let i = 1; i < n - 1; i++) {
        if (presence[i - 1] && !presence[i] && presence[i + 1]) {
          issues.push(issue('abrupt_transition', 'low', [i + 1], 'Topic keywords drop out mid-deck', 'strengthen_transition'));
          break;
        }
      }
    }
  }

  // Information hierarchy: cover should not be denser than body average
  if (n >= 4) {
    const coverW = words(titles[0]).length + (Array.isArray(list[0].bullets) ? list[0].bullets.length * 4 : 0);
    const avgMid = list.slice(1, -1).reduce((s, x) => s + (Array.isArray(x.bullets) ? x.bullets.length : 0), 0) / Math.max(n - 2, 1);
    if (coverW > 20 && avgMid < 2) {
      issues.push(issue('information_hierarchy', 'low', [1], 'Cover is dense while body slides are sparse', 'rebalance_information'));
    }
  }

  // Clear objective: first non-cover slide should state goals/overview-ish or concrete concept
  if (n >= 4) {
    const s1 = list[1];
    const t1 = slideTitle(s1);
    if (!t1 || words(t1).length < 2) {
      issues.push(issue('unclear_objective', 'medium', [2], 'Early slide lacks a clear objective title', 'rewrite_section'));
    }
  }

  // Density variance across deck
  const densities = list.map((s) => {
    let w = words(s.body).length;
    if (Array.isArray(s.bullets)) w += s.bullets.reduce((n, b) => n + words(b).length, 0);
    return w;
  });
  if (densities.length >= 4) {
    const mid = densities.slice(1, -1);
    const max = Math.max(...mid);
    const min = Math.min(...mid.filter((d) => d > 0).concat([max]));
    if (max >= 40 && min <= 3) {
      issues.push(issue('inconsistent_depth', 'medium', [], 'Large depth gap between sections', 'rebalance_information'));
    }
  }

  // Score narrative 0-100
  let penalty = 0;
  for (const iss of issues) {
    penalty += iss.severityRank === 4 ? 16 : iss.severityRank === 3 ? 10 : iss.severityRank === 2 ? 5 : 2;
  }
  const score = Math.max(0, Math.min(100, 100 - Math.min(penalty, 65)));

  return { issues, score, slideCount: n };
}

/**
 * Deterministic targeted narrative repairs (no LLM).
 */
function applyDeterministicNarrativeRepairs(slides, narrative) {
  let list = (slides || []).map((s) => ({ ...s, composition: s.composition ? { ...s.composition } : s.composition }));
  const applied = [];
  const issues = narrative.issues || [];

  // remove_redundancy: blank out duplicate titles by suffixing section context — prefer merge of empty-ish
  for (const iss of issues) {
    if (iss.repairAction === 'remove_redundancy' && iss.affectedSlides.length >= 2) {
      const [a, b] = iss.affectedSlides;
      const ia = list.findIndex((s) => (s.index || 0) === a);
      const ib = list.findIndex((s) => (s.index || 0) === b);
      if (ia >= 0 && ib >= 0 && ia !== ib) {
        const sa = list[ia];
        const sb = list[ib];
        const aThin = !(sa.bullets && sa.bullets.length) && !sa.body;
        const bThin = !(sb.bullets && sb.bullets.length) && !sb.body;
        if (aThin && !bThin) {
          list.splice(ia, 1);
          applied.push({ action: 'merge_slides', removed: a });
        } else if (bThin && !aThin) {
          list.splice(ib, 1);
          applied.push({ action: 'merge_slides', removed: b });
        } else if (ib > 0) {
          list[ib] = {
            ...sb,
            title: (sb.title || '') + (sb.subtitle ? '' : ''),
            subtitle: sb.subtitle || sa.subtitle || 'Жалғасы',
          };
          applied.push({ action: 'strengthen_transition', index: b });
        }
      }
    }

    if (iss.repairAction === 'strengthen_conclusion') {
      const last = list[list.length - 1];
      if (last && !/әдебиет|reference/i.test(String(last.title || ''))) {
        const bullets = Array.isArray(last.bullets) ? last.bullets.filter(Boolean) : [];
        if (bullets.length < 2) {
          const fromPrev = list.slice(1, -1).map((s) => s.title).filter(Boolean).slice(0, 3);
          last.bullets = bullets.length ? bullets : fromPrev.map((t) => String(t).slice(0, 60));
          if (!/қорытынды|conclusion|takeaway|резюме/i.test(String(last.title || ''))) {
            last.title = last.title || 'Қорытынды';
          }
          if (!last.subtitle) last.subtitle = 'Негізгі тұжырымдар';
          applied.push({ action: 'strengthen_conclusion', index: last.index });
        }
      }
    }
  }

  list.forEach((s, i) => { s.index = i + 1; });
  return { slides: list, applied };
}

/**
 * Multi-dimension presentation score (internal QC, not marketing).
 */
function buildDimensionScores({ contentScore, narrativeScore, visualScore, compositionScore, readabilityScore, sourceScore, renderScore }) {
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n == null ? 70 : n)));
  const dims = {
    content: clamp(contentScore),
    narrative: clamp(narrativeScore),
    visual: clamp(visualScore),
    composition: clamp(compositionScore),
    readability: clamp(readabilityScore),
    factualSourceIntegrity: clamp(sourceScore),
    renderIntegrity: clamp(renderScore),
  };
  // Weighted overall — narrative and content dominate
  const overall = Math.round(
    dims.content * 0.22
    + dims.narrative * 0.22
    + dims.visual * 0.12
    + dims.composition * 0.12
    + dims.readability * 0.12
    + dims.factualSourceIntegrity * 0.1
    + dims.renderIntegrity * 0.1
  );
  return { dimensions: dims, overall };
}

/**
 * Optional LLM narrative pass — structured issues only. Skipped when score high or no key.
 */
async function llmNarrativeCritic(slides, title, topic, language) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key || process.env.QUALITY_LLM === '0') return null;

  const compact = (slides || []).map((s, i) => ({
    index: s.index != null ? s.index : i + 1,
    title: s.title,
    subtitle: s.subtitle,
    bulletCount: Array.isArray(s.bullets) ? s.bullets.length : 0,
  }));

  const system = `You are a presentation narrative critic. JSON only.
Evaluate the DECK as a whole (arc, hierarchy, redundancy, conclusion, title match).
Schema: { "score": 0-100, "issues": [ { "code": "unnecessary_repetition|weak_conclusion|abrupt_transition|unclear_objective|inconsistent_depth|title_content_mismatch|inappropriate_slide_count|information_hierarchy", "severity": "critical|high|medium|low", "affectedSlides": [1], "explanation": "short", "repairAction": "reorder_slides|merge_slides|strengthen_transition|remove_redundancy|strengthen_conclusion|rebalance_information|rewrite_section|none" } ] }
Max 8 issues. Prefer fewer precise findings.`;

  const user = `Title: ${title}\nTopic: ${String(topic).slice(0, 400)}\nLanguage: ${language || 'n/a'}\nSlides: ${JSON.stringify(compact)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        thinking: { type: 'disabled' },
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    recordApiUsage(data.usage || null, { label: 'narrative:critic', model: DEEPSEEK_MODEL });
    const text = data.choices?.[0]?.message?.content || '';
    const raw = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
    const issues = (Array.isArray(raw.issues) ? raw.issues : []).slice(0, 8).map((it) =>
      issue(
        it.code || 'abrupt_transition',
        it.severity || 'medium',
        it.affectedSlides || [],
        it.explanation || '',
        it.repairAction || 'none'
      )
    );
    return { score: Number(raw.score) || 70, issues };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Full narrative pass: deterministic → optional LLM → merge → deterministic repair.
 */
async function runNarrativePass(opts) {
  const {
    slides,
    title = '',
    topic = '',
    language = null,
    enableLlm = true,
  } = opts || {};

  const det = analyzeNarrative(slides, title, topic);
  let llm = null;
  if (enableLlm && det.score < 80 && process.env.DEEPSEEK_API_KEY && process.env.QUALITY_LLM !== '0') {
    llm = await llmNarrativeCritic(slides, title, topic, language);
  }

  const byKey = new Map();
  for (const iss of [...det.issues, ...((llm && llm.issues) || [])]) {
    const k = `${iss.code}|${(iss.affectedSlides || []).join(',')}|${iss.explanation.slice(0, 30)}`;
    const prev = byKey.get(k);
    if (!prev || iss.severityRank > prev.severityRank) byKey.set(k, iss);
  }
  const issues = [...byKey.values()].sort((a, b) => b.severityRank - a.severityRank);
  const score = Math.round(
    llm && Number.isFinite(llm.score)
      ? Math.min(det.score, llm.score) * 0.5 + Math.max(det.score, llm.score) * 0.5
      : det.score
  );

  const narrative = { score, issues, sources: llm ? ['deterministic', 'llm'] : ['deterministic'] };
  const { slides: repaired, applied } = applyDeterministicNarrativeRepairs(slides, narrative);

  return {
    slides: repaired,
    narrative,
    applied,
    narrativeScore: score,
  };
}

module.exports = {
  analyzeNarrative,
  applyDeterministicNarrativeRepairs,
  buildDimensionScores,
  runNarrativePass,
  llmNarrativeCritic,
};
