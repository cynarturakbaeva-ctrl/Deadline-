'use strict';
/**
 * Референс құрылымын слайдтарға қолдану:
 *  1) әр слайдқа референстің макет түрін (refArchetype) тағайындау;
 *  2) мазмұнды сол макетке сәйкестендіру (карточка, кесте, үлкен сан) — тек детерминді түрде, ойдан дерек қоспай;
 *  3) қорытынды: дайын слайдтар референс макетіне қаншалықты сәйкес келді.
 */
const A = require('./design/analyze');
const { ROLE_RE } = require('../../design-dna/structure');

const ROLE_LABEL = {
  conclusion: { kk: 'Қорытынды', ru: 'Заключение', en: 'Conclusion' },
  goal: { kk: 'Мақсаты', ru: 'Цель', en: 'Goal' },
  relevance: { kk: 'Өзектілік', ru: 'Актуальность', en: 'Relevance' },
  tasks: { kk: 'Міндеттер', ru: 'Задачи', en: 'Tasks' },
  intro: { kk: 'Кіріспе', ru: 'Введение', en: 'Introduction' },
  agenda: { kk: 'Мазмұны', ru: 'Содержание', en: 'Agenda' },
};
function langOf(text) {
  if (/[әіңғүұқөһӘІҢҒҮҰҚӨҺ]/.test(text)) return 'kk';
  return /[а-яё]/i.test(text) ? 'ru' : 'en';
}
/** Референс слайдының рөлі (қорытынды, мақсат…) бар болса, тақырып сол рөлді көрсетуі керек — мұғалім талабын тексеруге болсын */
function ensureRoleTitle(s, role) {
  const lab = ROLE_LABEL[role]; const hit = ROLE_RE.find(([r]) => r === role);
  if (!lab || !hit) return false;
  const title = String(s.title || '').trim();
  if (hit[1].test(title)) return false;
  const lang = langOf([title, ...(Array.isArray(s.bullets) ? s.bullets : [])].join(' '));
  s.title = (title ? lab[lang] + ': ' + title : lab[lang]).slice(0, 110);
  return true;
}

const NUM_RE = /(\d[\d\s]*(?:[.,]\d+)?)\s*(%|млн|млрд|трлн|тыс|мың|км|кг|тг|₸|\$|€|x|×|рет|жыл|лет|years?)?/i;

function cardsFromBullets(bullets, n) {
  const out = [];
  for (const b of bullets) {
    const t = String(b || '').trim();
    if (!t) continue;
    const nd = A.toNode(t);
    out.push(nd.detail ? `${nd.label}: ${nd.detail}` : t);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Референсте кесте/диаграмма/сан жоқ слайдқа бізде де ол шықпауы керек:
 * құрылымдық өрістерді (table, steps, timeline, hierarchy, visual, stats) қарапайым буллетке айналдырамыз.
 * Мәтін жоғалмайды — тек түрі өзгереді. Референс өзі сұрайтын түрлер (table/chart/big-number) тиіспейді.
 */
const KEEPS = { table: ['table'], chart: ['visual', 'table'], 'big-number': ['stats'] };
function flattenStructure(s, arche, adapted, n) {
  const keep = KEEPS[arche] || [];
  const lines = [];
  const take = (arr, fmt) => (Array.isArray(arr) ? arr : []).forEach((x) => { const t = fmt(x); if (t) lines.push(t); });
  const txt = (x) => (typeof x === 'string' ? x : x && (x.label || x.title || x.name || x.step || x.text) ? [x.label || x.title || x.name || x.step || x.text, x.detail || x.description || x.desc].filter(Boolean).join(': ') : '');
  const changed = [];
  for (const k of ['steps', 'timeline', 'hierarchy']) {
    if (Array.isArray(s[k]) && s[k].length) { take(s[k], (x) => (x && x.date ? `${x.date}: ${txt(x)}` : txt(x))); delete s[k]; changed.push(k); }
  }
  if (!keep.includes('table') && s.table && Array.isArray(s.table.rows) && s.table.rows.length) {
    s.table.rows.forEach((r) => { const c = (Array.isArray(r) ? r : []).map((v) => String(v || '').trim()).filter(Boolean); if (c.length >= 2) lines.push(`${c[0]}: ${c.slice(1).join(', ')}`); else if (c[0]) lines.push(c[0]); });
    delete s.table; changed.push('table');
  }
  if (!keep.includes('stats') && Array.isArray(s.stats) && s.stats.length) {
    take(s.stats, (x) => (x && x.value ? `${x.label ? x.label + ': ' : ''}${x.value}` : '')); delete s.stats; changed.push('stats');
  }
  if (!keep.includes('visual') && s.visual) { delete s.visual; delete s.visualSvg; changed.push('visual'); }
  if (!changed.length) return;
  const have = Array.isArray(s.bullets) ? s.bullets.filter(Boolean) : [];
  const seen = new Set(have.map((b) => String(b).toLowerCase()));
  const extra = lines.filter((l) => !seen.has(l.toLowerCase()));
  if (extra.length && have.length < 5) s.bullets = [...have, ...extra].slice(0, 6);
  adapted.push({ n, what: 'flatten ' + changed.join('+') });
}

/** slides[i].composition.refArchetype қояды және мазмұнды түзетеді. Қайтарады: { assigned, adapted:[{n,what}] } */
function applyReferencePlan(slides, outline) {
  const adapted = []; let assigned = 0;
  const n = Math.min(slides.length, outline.slides.length);
  for (let i = 0; i < n; i++) {
    const ref = outline.slides[i]; const s = slides[i];
    if (!s) continue;
    const c = s.composition || (s.composition = {});
    c.refArchetype = ref.archetype; c.refRole = ref.role; assigned++;
    flattenStructure(s, ref.archetype, adapted, i + 1);
    if (i > 0 && ensureRoleTitle(s, ref.role)) adapted.push({ n: i + 1, what: 'title role ' + ref.role });
    const bullets = Array.isArray(s.bullets) ? s.bullets.filter((b) => b && String(b).trim()) : [];

    const cards = /^cards-(\d)/.exec(ref.archetype);
    if (cards && bullets.length >= 2) {
      const want = Math.min(+cards[1], 6);
      const next = cardsFromBullets(bullets, want);
      if (next.length !== bullets.length) adapted.push({ n: i + 1, what: `cards ${bullets.length}→${next.length}` });
      s.bullets = next; s.body = s.body && next.length ? '' : s.body;
    }
    if (ref.archetype === 'table' && !(s.table && (s.table.rows || []).length) && bullets.length >= 3) {
      const rows = bullets.map((b) => { const nd = A.toNode(b); return nd.detail ? [nd.label, nd.detail] : null; }).filter(Boolean);
      if (rows.length >= 3) { s.table = { headers: [], rows: rows.slice(0, 6) }; s.bullets = []; adapted.push({ n: i + 1, what: 'table from bullets' }); }
    }
    if (ref.archetype === 'big-number' && !(Array.isArray(s.stats) && s.stats.length)) {
      const src = [...bullets, s.subtitle, s.title].filter(Boolean);
      for (const t of src) {
        const m = NUM_RE.exec(String(t));
        if (m && /\d/.test(m[1]) && (m[2] || String(m[1]).replace(/\s/g, '').length >= 2)) {
          const label = String(t).replace(m[0], '').replace(/^[\s:–—-]+|[\s:–—-]+$/g, '').slice(0, 70) || s.title;
          s.stats = [{ value: m[0].trim(), label }]; s.bullets = []; adapted.push({ n: i + 1, what: 'stat from text' }); break;
        }
      }
    }
  }
  return { assigned, adapted };
}

/** Қорытынды: refArchetype бар слайдтардың нақты макеті күтілгенге сәйкес пе. */
const TEXT_FAMILY = ['points', 'stackPoints', 'stackSplit', 'stackRefs', 'editorial', 'split', 'imageFocus', 'statement', 'closing', 'references', 'cards', 'concepts', 'section', 'quote'];
const EXPECT = (arche) => {
  if (/^cards-/.test(arche)) return ['cards', 'concepts'];
  if (arche === 'text' || arche === 'two-column') return TEXT_FAMILY;
  return ({
    title: ['cover'], 'text-image-left': ['split'], 'text-image-right': ['split'], 'image-strip-top': ['split'], 'image-strip-bottom': ['split'],
    'full-image': ['fullImage'], 'big-number': ['number'], table: ['table'], chart: ['diagram'], statement: ['statement', 'section'],
  })[arche] || null; // 'text', 'two-column' — еркін
};
function layoutMatch(slides) {
  const plan = A.planDeck(slides);
  let total = 0; let ok = 0; const miss = [];
  slides.forEach((s, i) => {
    const arche = s.composition && s.composition.refArchetype;
    const exp = arche && EXPECT(arche);
    if (!exp) return;
    total++;
    const layout = plan[i].layout;
    const hit = exp.includes(layout) || (arche === 'text-image-left' && layout === 'imageFocus') || (arche === 'text-image-right' && layout === 'imageFocus');
    if (hit) ok++; else miss.push(`${i + 1}-слайд: ${arche} → ${layout}`);
  });
  return { total, ok, pct: total ? Math.round((ok / total) * 100) : 100, miss };
}

module.exports = { applyReferencePlan, layoutMatch };
