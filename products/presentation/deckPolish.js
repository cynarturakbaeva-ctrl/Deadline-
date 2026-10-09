'use strict';
/**
 * Deck-level guarantees applied by CODE after the LLM wrote the slides.
 * The model copies whatever its prompt example shows, so look & variety must not depend on it.
 */
const T = require('./design/tokens');

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
    return line.length > 160 ? line.slice(0, 157).trimEnd() + '…' : line;
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

let lastTheme = null;
/** Pick the deck theme in code and stamp it on every slide (HTML builder + SVG visuals read it from there). */
function applyDeckTheme(slides, opts) {
  const o = opts || {};
  let mood;
  if (o.refTheme) mood = T.registerMood(o.refTheme); // клиенттің референс PPTX-і: түс/реңк/радиус сол күйі
  else { mood = T.pickTheme({ seed: o.seed, style: o.style, brief: o.brief, avoid: lastTheme }); lastTheme = mood; }
  const accent = T.MOODS[mood].accent;
  (Array.isArray(slides) ? slides : []).forEach((s) => {
    const c = s.composition || (s.composition = {});
    c.mood = mood;
    c.accentColor = accent;
    c.decorative = [];
  });
  return mood;
}

module.exports = { limitTables, applyDeckTheme, tableToBullets };
