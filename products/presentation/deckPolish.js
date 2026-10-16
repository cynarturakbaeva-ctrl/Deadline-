'use strict';
/**
 * Deck-level guarantees applied by CODE after the LLM wrote the slides.
 * The model copies whatever its prompt example shows, so look & variety must not depend on it.
 */
const T = require('./design/tokens');
const SYS = require('./design/systems');
const IG = require('./design/infographics');
const { truncate } = require('./design/analyze');

const norm = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
const hasTable = (s) => !!(s && s.table && ((s.table.headers || []).length || (s.table.rows || []).length));

/** Table rows → short bullets ("Label: Header: value; Header: value") — the first ':' is what the layouts split label/detail on. */
function tableToBullets(table) {
  const headers = (table.headers || []).map(norm);
  const rows = (table.rows || []).filter((r) => Array.isArray(r) && r.some((c) => norm(c)));
  return rows.slice(0, 4).map((r) => {
    const cells = r.map(norm);
    const label = cells[0];
    const rest = cells.slice(1).map((c, j) => {
      if (!c) return '';
      return cells.length > 2 && headers[j + 1] ? headers[j + 1] + ': ' + c : c;
    }).filter(Boolean);
    const line = rest.length ? label + ': ' + rest.join('; ') : label;
    return truncate(line, 200);
  }).filter(Boolean);
}

/**
 * At most max(1, floor(n/4)) tables per deck and never two in a row; the extra tables become bullets.
 * Returns how many slides were converted.
 */
function limitTables(slides) {
  const list = Array.isArray(slides) ? slides : [];
  const maxTables = Math.max(1, Math.floor(list.length / 4));
  let kept = 0; let prevKept = false; let converted = 0;
  list.forEach((s, i) => {
    if (!hasTable(s)) { prevKept = false; return; }
    if (i > 0 && kept < maxTables && !prevKept) { kept += 1; prevKept = true; return; }
    prevKept = false;
    const bullets = tableToBullets(s.table);
    const existing = (Array.isArray(s.bullets) ? s.bullets : []).filter((b) => norm(b));
    if (existing.length < 2 && bullets.length) s.bullets = bullets;
    s.table = null;
    const c = s.composition || (s.composition = {});
    if (c.layout === 'comparison_table') c.layout = 'two_column_bullets';
    if (c.visualPurpose === 'table' || c.visualPurpose === 'comparison') c.visualPurpose = 'evidence';
    converted += 1;
  });
  return converted;
}

/**
 * Infographic families: two charts of one family read as "the same slide twice" (two line charts of growth).
 * line + column are both a trend over time; donut + pictogram both a share of a whole.
 */
const IG_FAMILY = { line: 'trend', column: 'trend', donut: 'share', pictogram: 'share', funnel: 'flow', cycle: 'flow' };
const igFamily = (kind) => IG_FAMILY[kind] || kind;
const REFS_RE = /әдебиет|\breferences?\b|пайдаланылған|библиограф|литератур|источник|\bsources\b/i;

/** Drawn infographic of a slide: the LLM's field, else what the layout engine would detect from its content. */
function slideInfographic(s) {
  if (!s || s.noInfographic) return null;
  return IG.validateInfographic(s.infographic) || IG.autoInfographic(s);
}

/** "Label: detail" line of an infographic item. */
function itemLine(it, d) {
  const v = it.display ? (d.unit && !/[^\d\s.,+\-]/.test(it.display) ? it.display + (d.unit === '%' ? '%' : ' ' + d.unit) : it.display) : '';
  const head = [it.label, v].filter(Boolean).join(' — ');
  const line = it.detail ? (head ? head + ': ' + it.detail : it.detail) : head;
  return truncate(line, 200);
}

/**
 * A dropped infographic keeps its meaning as ordinary slide content: one or two headline numbers become stat
 * cards, everything else short "label — value: detail" bullets. Bullets on purpose: such a slide gets a
 * text + photo layout, which is exactly what a chart-heavy deck lacks.
 */
function infographicToContent(s, d) {
  const items = d.items.filter((it) => it.label || it.display);
  const existing = (Array.isArray(s.bullets) ? s.bullets : []).filter((b) => norm(b));
  const hasText = existing.length >= 2 || norm(s.body).split(' ').length >= 12;
  const numeric = items.filter((it) => it.display && it.value != null);
  if (!hasText) {
    if (['compare', 'pictogram'].includes(d.kind) && numeric.length >= 1 && numeric.length <= 2) {
      s.stats = numeric.map((it) => ({ value: itemLine({ display: it.display }, d), label: it.label + (it.detail ? ' — ' + it.detail : '') }));
    } else {
      s.bullets = items.slice(0, 6).map((it) => itemLine(it, d));
    }
  }
  if (d.source && !norm(s.body) && hasText) s.body = d.source;
  s.infographic = null;
  s.noInfographic = true;
  const c = s.composition || (s.composition = {});
  if (c.image === 'none') c.image = null; // the slide may carry a photo now
}

/**
 * Data slides (infographics + tables) are the strongest element of a deck only when they are rare:
 *   • at most ~30% of slides are infographics, and together with tables at most ~40%;
 *   • never two data slides in a row; never two infographics of one family (two growth charts);
 *   • the LLM's own infographics win over auto-detected ones, then earlier slides.
 * The rest keep their content as stats / steps / bullets, so they get text + photo layouts.
 * Run AFTER limitTables. Returns how many slides were converted.
 */
function limitInfographics(slides) {
  const list = Array.isArray(slides) ? slides : [];
  const n = list.length;
  const tables = list.map((s, i) => i > 0 && hasTable(s));
  const tableCount = tables.filter(Boolean).length;
  const cap = n < 4 ? 1 : Math.max(1, Math.min(Math.round(n * 0.3), Math.round(n * 0.4) - tableCount));
  const cands = [];
  list.forEach((s, i) => {
    const d = i > 0 && !REFS_RE.test(norm(s && s.title)) ? slideInfographic(s) : null;
    if (d) cands.push({ i, d, explicit: !!IG.validateInfographic(s.infographic) });
    else if (s && s.infographic && i === 0) s.infographic = null;
  });
  cands.sort((a, b) => (b.explicit - a.explicit) || (a.i - b.i));
  const taken = new Set(); const families = new Set();
  const busy = (i) => tables[i - 1] || tables[i + 1] || taken.has(i - 1) || taken.has(i + 1);
  let converted = 0;
  for (const c of cands) {
    if (taken.size < cap && !busy(c.i) && !families.has(igFamily(c.d.kind))) {
      taken.add(c.i); families.add(igFamily(c.d.kind));
      continue;
    }
    infographicToContent(list[c.i], c.d);
    converted += 1;
  }
  return converted;
}

// Пайдаланушы белгісіз болғандағы (тест, ішкі шақыру) резерв: процестің соңғы таңдауы. Нақты студент үшін
// server.js оның соңғы дизайндарын options.designAvoid арқылы береді (бұрын бұл ЖАЛҒЫЗ ортақ айнымалы еді —
// студенттің келесі презентациясы оның өзінікінен емес, кез келген адамның соңғысынан ғана ерекшеленетін).
let lastTheme = null;
let lastSystem = null;
/**
 * Презентацияның дизайн жүйесі мен палитрасын КОД таңдайды және әр слайдқа жазады
 * (HTML builder пен SVG визуалдар composition.mood / composition.design-ты оқиды).
 * @param {object[]} slides
 * @param {{seed?:string, style?:string, brief?:string, refTheme?:object, avoid?:{systems?:string[], moods?:string[]}, keep?:{mood:string, system:string}}} opts
 *   keep — талаптар тексеруінен кейін қайта қолданғанда ТАҢДАУ ӨЗГЕРМЕЙДІ (бұрын келесі палитраға ауысып кететін)
 * @returns {{mood:string, system:string}}
 */
function applyDeckTheme(slides, opts) {
  const o = opts || {};
  let mood; let system = SYS.DEFAULT;
  if (o.keep && o.keep.mood && T.MOODS[o.keep.mood]) { mood = o.keep.mood; system = o.keep.system || SYS.DEFAULT; }
  else if (o.refTheme) mood = T.registerMood(o.refTheme); // клиенттің референс PPTX-і: түс/реңк/радиус сол күйі
  else {
    const av = o.avoid || {};
    const avoidSystems = Array.isArray(av.systems) && av.systems.length ? av.systems : (lastSystem ? [lastSystem] : []);
    const avoidMoods = Array.isArray(av.moods) && av.moods.length ? av.moods : (lastTheme ? [lastTheme] : []);
    const d = SYS.pickDesign({ seed: o.seed, style: o.style, brief: o.brief, field: o.field, avoidSystems, avoidMoods });
    mood = d.mood; system = d.system;
    lastTheme = mood; lastSystem = system;
  }
  const accent = T.MOODS[mood].accent;
  (Array.isArray(slides) ? slides : []).forEach((s) => {
    const c = s.composition || (s.composition = {});
    c.mood = mood;
    c.accentColor = accent;
    c.design = system;
    c.layoutSeed = T.strHash(String(o.seed || '') + '|layout') & 0xffff; // ырғақ (analyze.planDeck): фото жағы, баламалар
    c.decorative = [];
  });
  return { mood, system };
}

module.exports = { limitTables, limitInfographics, infographicToContent, applyDeckTheme, tableToBullets };
