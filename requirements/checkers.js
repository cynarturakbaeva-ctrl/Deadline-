'use strict';
/**
 * Checker тізілімі. Әр checker (item, slides) → { status:'pass'|'fail', actual, message }.
 * Слайд IR: { title, subtitle, body, bullets[], ... } — генератордың өз форматы.
 * Тізілімде жоқ check → 'unverifiable'.
 */
const ROLE_RE = {
  title: /^$/, // титул — бірінші слайд
  agenda: /мазмұн|жоспар|содержани|план\b|agenda|contents|outline/i,
  thanks: /рахмет|спасибо|thank\s*you|назар\s*аудар|внимание/i,
  intro: /кіріспе|введени|introduction|\bintro\b/i,
  relevance: /өзектілік|актуальн|relevance/i,
  goal: /мақсат|цел[ьи]|\bgoals?\b|\baims?\b|objective/i,
  tasks: /міндет|задач|\btasks\b|objectives/i,
  conclusion: /қорытынды|вывод|заключени|conclusion/i,
  references: /әдебиет|пайдаланылған|дереккөз|источник|литератур|список|references|bibliograph|sources/i,
};

const textOf = (s) => [s.title, s.subtitle, s.body].concat(Array.isArray(s.bullets) ? s.bullets : []).filter(Boolean).join(' ');
const words = (str) => (String(str).trim().match(/\S+/g) || []).length;

function cmp(op, a, b) { return op === '==' ? a === b : op === '>=' ? a >= b : a <= b; }
const OPNAME = { '==': 'дәл', '>=': 'кемінде', '<=': 'көпі',  };

function roleSlide(role, slides) {
  if (role === 'title') return slides.length ? 0 : -1;
  const re = ROLE_RE[role];
  if (role === 'references') {
    // әдебиет слайды әдетте соңғы 3 слайдтың бірінде
    for (let i = slides.length - 1; i >= Math.max(0, slides.length - 4); i--) if (re.test(String(slides[i].title || ''))) return i;
    return -1;
  }
  if (role === 'thanks') {
    const last = slides.length - 1;
    return last >= 0 && re.test(String(slides[last].title || '') + ' ' + String(slides[last].subtitle || '')) ? last : -1;
  }
  for (let i = 0; i < slides.length; i++) {
    const t = String(slides[i].title || '');
    if (re.test(t)) return i;
  }
  // мақсат/міндет кіріспе слайдының ішінде де болуы мүмкін
  if (role === 'goal' || role === 'tasks' || role === 'relevance') {
    for (let i = 0; i < Math.min(4, slides.length); i++) if (re.test(textOf(slides[i]))) return i;
  }
  return -1;
}

const REGISTRY = {
  slide_count(item, slides) {
    const n = slides.length;
    const ok = cmp(item.op, n, item.value);
    return { status: ok ? 'pass' : 'fail', actual: n, message: ok ? '' : `${n} слайд бар, ${OPNAME[item.op]} ${item.value} керек` };
  },
  max_words_per_slide(item, slides) {
    const over = [];
    slides.forEach((s, i) => { const w = words(textOf(s)); if (w > item.value) over.push({ n: i + 1, w }); });
    return over.length
      ? { status: 'fail', actual: over, message: over.slice(0, 5).map((o) => `${o.n}-слайд: ${o.w} сөз`).join(', ') + (over.length > 5 ? ` және тағы ${over.length - 5}` : '') }
      : { status: 'pass', actual: Math.max(0, ...slides.map((s) => words(textOf(s)))) };
  },
  has_slide(item, slides) {
    const i = roleSlide(item.value, slides);
    return i >= 0 ? { status: 'pass', actual: i + 1 } : { status: 'fail', message: 'мұндай слайд табылмады' };
  },
  sources_min(item, slides) {
    const i = roleSlide('references', slides);
    if (i < 0) return { status: 'fail', actual: 0, message: 'әдебиет слайды жоқ' };
    const s = slides[i];
    const n = (Array.isArray(s.bullets) ? s.bullets.filter((b) => String(b).trim().length > 8).length : 0);
    return n >= item.value ? { status: 'pass', actual: n } : { status: 'fail', actual: n, message: `${n} дереккөз бар, кемінде ${item.value} керек` };
  },
};

/** Бір элементті тексереді. soft/unverifiable мұнда өңделмейді. */
function runCheck(item, slides, extra) {
  const fn = (extra && extra[item.check]) || REGISTRY[item.check];
  if (!fn) return { status: 'unverifiable', message: 'тексеруші жоқ' };
  try { return fn(item, slides); } catch (e) { return { status: 'unverifiable', message: 'тексеру қатесі: ' + e.message }; }
}

function checkAll(set, slides, extra) {
  const list = Array.isArray(slides) ? slides : [];
  return (set && set.items || []).map((item) => {
    if (item.kind === 'hard') return { id: item.id, item, ...runCheck(item, list, extra) };
    if (item.kind === 'unverifiable') return { id: item.id, item, status: 'unverifiable', message: item.reason };
    return { id: item.id, item, status: 'soft', score: null }; // judge.js толтырады
  });
}

module.exports = { REGISTRY, runCheck, checkAll, roleSlide, textOf, words };
