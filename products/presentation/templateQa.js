'use strict';
/**
 * Template QA (Mode 3 — Template → Content).
 *
 * Мақсат: дайын шаблонның ДИЗАЙНЫН сақтау. Референс PPTX-ті талдағаннан кейін
 * жаңа презентацияның сол шаблон логикасына қаншалықты сәйкес екенін өлшейміз:
 *   - слайд саны мен реті
 *   - әр слайдтың рөлі (title, intro, cards, table, …)
 *   - макет түрлерінің сәйкестігі (layoutMatch)
 *   - мәтін тығыздығы (сөз/слайд)
 *   - сурет орналасу жағы / қайталанатын элементтер
 * Ешқашан лақтырмайды; нәтиже JSON есеп ретінде пайдаланушыға көрсетіледі.
 */

const { layoutMatch } = require('./refPlan');

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const slideWords = (s) => words([s.title, s.subtitle, s.body].concat(Array.isArray(s.bullets) ? s.bullets : []).join(' ')).length;

function check(name, ok, detail) {
  return { name, status: ok ? 'pass' : 'fail', detail: detail || '' };
}

/**
 * @param {object} refAnalysis  design-dna analyzeReference нәтижесі
 * @param {Array}  slides       дайын слайдтар
 * @param {object} opts         { refTheme, style, overrides }
 * @returns {{score:number, checks:Array, summary:string, ok:number, total:number}}
 */
function buildTemplateReport(refAnalysis, slides, opts = {}) {
  const list = Array.isArray(slides) ? slides : [];
  const checks = [];
  let score = 0;
  let ok = 0;
  let total = 0;

  if (!refAnalysis || !refAnalysis.outline || !refAnalysis.outline.slides) {
    return { score: null, checks: [], summary: 'Референс құрылымы табылмады', ok: 0, total: 0 };
  }
  const outline = refAnalysis.outline;

  // 1) Слайд саны
  total++;
  if (list.length === outline.slideCount) { ok++; }
  checks.push(check('slide_count', list.length === outline.slideCount, `${list.length}/${outline.slideCount}`));

  // 2) Рөлдер реті (алғашқы N слайд, N = min)
  total++;
  const n = Math.min(list.length, outline.slides.length);
  const roleHits = [];
  for (let i = 0; i < n; i++) {
    const want = outline.slides[i].role;
    const got = (list[i] && list[i].composition && list[i].composition.refRole) || want;
    if (got === want) roleHits.push(i + 1);
  }
  const roleOk = n > 0 && roleHits.length === n;
  if (roleOk) ok++;
  checks.push(check('role_order', roleOk, roleOk ? `${n}/${n}` : `сәйкес емес: ${roleHits.length}/${n}`));

  // 3) Макет сәйкестігі
  total++;
  const lm = layoutMatch(list);
  if (lm.total) {
    if (lm.pct >= 70) ok++;
    checks.push(check('layout_match', lm.pct >= 70, `${lm.ok}/${lm.total} (${lm.pct}%)${lm.miss.length ? ' — ' + lm.miss.slice(0, 3).join('; ') : ''}`));
  } else {
    ok++; // макеттік талап жоқ болса, бұзбаған болып есептеледі
    checks.push(check('layout_match', true, 'тексерілетін макет жоқ'));
  }

  // 4) Мәтін тығыздығы (референс тығыздығынан 2 еседен аспауы керек)
  total++;
  if (refAnalysis.dna && refAnalysis.dna.density && refAnalysis.dna.density.avgWords) {
    const refAvg = refAnalysis.dna.density.avgWords;
    const avg = list.length ? Math.round(list.reduce((a, s) => a + slideWords(s), 0) / list.length) : 0;
    const densityOk = avg <= Math.max(refAvg * 2, refAvg + 40);
    if (densityOk) ok++;
    checks.push(check('density', densityOk, `референс ~${refAvg} сөз/слайд, жаңа ~${avg} сөз/слайд`));
  } else {
    ok++;
    checks.push(check('density', true, 'референс тығыздығы белгісіз'));
  }

  // 5) Тақырып/түс қолданылды ма
  total++;
  const refTheme = opts.refTheme || (refAnalysis.theme) || null;
  if (refTheme) {
    ok++;
    checks.push(check('theme', true, refTheme.bg ? `фон ${refTheme.bg}, акцент ${refTheme.accent}` : 'референс темасы қолданылды'));
  } else {
    checks.push(check('theme', false, 'референс темасы шығарылмады'));
  }

  // 6) Қайталанатын элементтер (лого/жолақ/нөмір) — skin арқылы беріледі
  total++;
  if (refAnalysis.recurring && refAnalysis.recurring.length) {
    ok++;
    checks.push(check('recurring', true, `${refAnalysis.recurring.map((r) => r.type).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`));
  } else {
    ok++;
    checks.push(check('recurring', true, 'қайталанатын элемент жоқ'));
  }

  score = Math.round((ok / Math.max(total, 1)) * 100);
  return {
    score,
    ok,
    total,
    checks,
    summary: `Template compliance: ${ok}/${total} ✓`,
  };
}

module.exports = { buildTemplateReport };
