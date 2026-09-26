'use strict';

/**
 * Deterministic composition / layout repair.
 * CONTENT REPAIR ≠ COMPOSITION REPAIR ≠ RENDER REPAIR.
 *
 * Operates on slide.composition + content density — no LLM calls.
 * Used after quality loop and/or when render overflow warnings point at a slide.
 */

function wordCount(s) {
  return String(s || '').trim().split(/\s+/).filter(Boolean).length;
}

function contentWeight(slide) {
  if (!slide || typeof slide !== 'object') return 0;
  let w = wordCount(slide.title) + wordCount(slide.subtitle) + wordCount(slide.body);
  if (Array.isArray(slide.bullets)) w += slide.bullets.reduce((n, b) => n + wordCount(b), 0);
  if (Array.isArray(slide.stats)) w += slide.stats.length * 4;
  if (slide.table && (slide.table.headers || slide.table.rows)) w += 20;
  if (slide.visualSvg || (slide.visual && slide.visual.type)) w += 8;
  return w;
}

function ensureComposition(slide) {
  if (!slide.composition || typeof slide.composition !== 'object') {
    slide.composition = {};
  }
  const c = slide.composition;
  if (!c.image) c.image = 'full_background';
  if (!c.overlay) c.overlay = 'dark_gradient_bottom';
  if (!c.textPosition) c.textPosition = 'center_left';
  if (!c.layout) c.layout = 'single_column';
  if (!c.mood) c.mood = 'dark';
  if (!c.accentColor) c.accentColor = '#e11d2e';
  return c;
}


/**
 * Infer semantic visual purpose from slide content (deterministic).
 * Guides layout away from generic card grids toward meaning-matched composition.
 */
function inferSemanticPurpose(slide) {
  const title = String(slide.title || '');
  const sub = String(slide.subtitle || '');
  const body = String(slide.body || '');
  const blob = (title + ' ' + sub + ' ' + body + ' ' + (Array.isArray(slide.bullets) ? slide.bullets.join(' ') : '')).toLowerCase();
  const hasTable = !!(slide.table && (slide.table.headers || slide.table.rows));
  const stats = Array.isArray(slide.stats) ? slide.stats : [];
  const bullets = Array.isArray(slide.bullets) ? slide.bullets.filter(Boolean) : [];

  if (hasTable) return 'comparison';
  if (stats.length === 1 && bullets.length === 0 && !body) return 'stats';
  if (stats.length >= 2) return 'stats';
  if (/салыстыр|versus|vs\.|before.?after|до и после|артықшылық|comparison|before\/after/i.test(blob)) return 'comparison';
  if (/кезең|этап|process|pipeline|қадам|шаг|workflow|цикл|cycle|алгоритм/i.test(blob)) return 'process';
  if (/иерархи|hierarchy|архитектур|architecture|құрылым|структура|система/i.test(blob)) return 'hierarchy';
  if (/уақыт|timeline|хронолог|тарих|history|жыл|year/i.test(blob)) return 'timeline';
  if (/қорытынды|conclusion|резюме|takeaway|тұжырым/i.test(title)) return 'conclusion';
  if (/анықтама|definition|ұғым|понятие|what is/i.test(blob)) return 'definition';
  if (/мысал|example|case study|кейс/i.test(blob)) return 'example';
  if (slide.visual && slide.visual.type === 'diagram') return 'process';
  if (slide.visual && slide.visual.type === 'infographic') return 'stats';
  if (slide.visual && slide.visual.type === 'map') return 'evidence';
  return 'definition';
}

function applySemanticComposition(slide, purpose) {
  const c = ensureComposition(slide);
  const actions = [];
  const stats = Array.isArray(slide.stats) ? slide.stats : [];
  const bullets = Array.isArray(slide.bullets) ? slide.bullets.filter(Boolean) : [];
  const hasTable = !!(slide.table && (slide.table.headers || slide.table.rows));

  c.visualPurpose = purpose;

  if (purpose === 'comparison' || hasTable) {
    if (hasTable) {
      c.layout = 'comparison_table';
      c.image = 'none';
      c.overlay = 'none';
      actions.push('semantic_comparison_table');
    } else {
      c.image = 'full_background';
      c.overlay = 'dark_gradient_bottom';
      c.textPosition = 'center_left';
      c.layout = 'two_column_bullets';
      actions.push('semantic_comparison');
    }
  } else if (purpose === 'stats') {
    if (stats.length === 1 && bullets.length === 0) {
      c.layout = 'big_stat_hero';
      c.image = 'none';
      actions.push('semantic_big_stat');
    } else {
      c.layout = 'stat_cards_row';
      c.image = 'full_background';
      c.overlay = 'dark_gradient_bottom';
      actions.push('semantic_stat_row');
    }
  } else if (purpose === 'process' || purpose === 'hierarchy' || purpose === 'timeline') {
    c.image = slide.visual || slide.visualSvg ? 'full_background' : 'right_half';
    c.textPosition = 'left_column';
    c.overlay = 'dark_gradient_left';
    c.layout = 'single_column';
    actions.push('semantic_process_split');
  } else if (purpose === 'conclusion') {
    c.image = 'full_background';
    c.overlay = 'dark_gradient_bottom';
    c.textPosition = 'center';
    c.layout = 'single_column';
    c.decorative = [];
    actions.push('semantic_conclusion');
  } else if (purpose === 'definition') {
    // Simple powerful: center, space, no clutter
    c.image = c.image === 'full_background' ? 'full_background' : 'none';
    c.textPosition = 'center';
    c.overlay = c.image === 'full_background' ? 'dark_gradient_bottom' : 'none';
    c.layout = 'single_column';
    c.decorative = [];
    actions.push('semantic_definition_simple');
  } else if (purpose === 'quote') {
    c.layout = 'quote_hero';
    c.image = 'none';
    actions.push('semantic_quote');
  }

  // Cap decorative noise
  if (Array.isArray(c.decorative) && c.decorative.length > 1) {
    c.decorative = c.decorative.slice(0, 1);
    actions.push('cap_decorative');
  }

  return actions;
}

/**
 * Fix a single slide's composition for known layout risks.
 * Returns { slide, changed, actions[] }
 */
function repairSlideComposition(slide, hints = {}) {
  if (!slide || typeof slide !== 'object') {
    return { slide, changed: false, actions: [] };
  }
  const actions = [];
  const s = { ...slide, composition: { ...(slide.composition || {}) } };
  const c = ensureComposition(s);
  const purpose = (s.composition && s.composition.visualPurpose) || inferSemanticPurpose(s);
  actions.push(...applySemanticComposition(s, purpose));
  const weight = contentWeight(s);
  const bullets = Array.isArray(s.bullets) ? s.bullets.filter((b) => b && String(b).trim()) : [];
  const stats = Array.isArray(s.stats) ? s.stats : [];
  const hasTable = !!(s.table && (s.table.headers || s.table.rows));
  const hasVisual = !!(s.visualSvg || (s.visual && s.visual.type));

  // Overflow / collision hint from renderer
  const overflow = !!hints.overflow;
  const blank = !!hints.blank;

  // 1) Stats + split image → full background (stats need width)
  if (stats.length >= 2 && (c.image === 'right_half' || c.image === 'left_half' || c.image === 'corner_accent')) {
    c.image = 'full_background';
    c.overlay = c.overlay === 'none' ? 'dark_gradient_bottom' : c.overlay;
    c.textPosition = 'center_left';
    actions.push('stats_need_full_width');
  }

  // 2) Table → avoid narrow columns
  if (hasTable && (c.image === 'right_half' || c.image === 'left_half')) {
    c.image = 'full_background';
    c.layout = 'single_column';
    actions.push('table_full_width');
  }

  // 3) Heavy text + half image → center or full with stronger overlay
  if (weight >= 55 && (c.image === 'right_half' || c.image === 'left_half')) {
    c.image = 'full_background';
    c.overlay = 'dark_full';
    c.textPosition = 'center';
    actions.push('heavy_text_recenter');
  }

  // 4) big_stat_hero only valid with single stat and no bullets/body
  if (c.layout === 'big_stat_hero' && (bullets.length || wordCount(s.body) > 0 || stats.length !== 1)) {
    c.layout = stats.length >= 2 ? 'stat_cards_row' : 'single_column';
    actions.push('invalid_big_stat_hero');
  }

  // 5) quote_hero only without bullets/stats
  if (c.layout === 'quote_hero' && (bullets.length || stats.length)) {
    c.layout = 'single_column';
    actions.push('invalid_quote_hero');
  }

  // 6) Visual present → prefer visual-friendly text density
  if (hasVisual && bullets.length > 2) {
    s.bullets = bullets.slice(0, 2);
    actions.push('trim_bullets_for_visual');
  }

  // 7) Too many bullets → keep strongest 4
  if (bullets.length > 4) {
    s.bullets = bullets.slice(0, 4);
    actions.push('trim_excess_bullets');
  }

  // 8) Tiny readability: long title
  if (wordCount(s.title) > 12) {
    const parts = String(s.title).trim().split(/\s+/);
    s.title = parts.slice(0, 10).join(' ');
    actions.push('shorten_title');
  }

  // 9) Full background without overlay → unreadable text risk
  if (c.image === 'full_background' && (!c.overlay || c.overlay === 'none' || c.overlay === 'light_full')) {
    c.overlay = 'dark_gradient_bottom';
    actions.push('add_overlay_for_contrast');
  }

  // 10) Overflow from render: force safe layout
  if (overflow) {
    c.image = 'full_background';
    c.overlay = 'dark_full';
    c.textPosition = 'center';
    c.layout = 'single_column';
    if (bullets.length > 3) s.bullets = bullets.slice(0, 3);
    if (wordCount(s.body) > 35) {
      s.body = String(s.body).trim().split(/\s+/).slice(0, 30).join(' ');
      actions.push('trim_body_on_overflow');
    }
    actions.push('safe_layout_on_overflow');
  }

  // 11) Blank render hint: ensure minimum content + solid composition
  if (blank) {
    if (!s.title) s.title = s.subtitle || '—';
    c.image = 'none';
    c.overlay = 'none';
    c.mood = c.mood || 'dark';
    c.textPosition = 'center';
    actions.push('blank_safe_fallback');
  }

  // 12) Excessive whitespace risk: very light content with strip image
  if (weight < 12 && !stats.length && !hasTable && (c.image === 'top_strip' || c.image === 'bottom_strip')) {
    c.image = 'full_background';
    c.textPosition = 'center';
    actions.push('avoid_sparse_strip');
  }

  s.composition = c;
  return { slide: s, changed: actions.length > 0, actions };
}

/**
 * Apply composition repair across a deck.
 * @param {object[]} slides
 * @param {{ overflowByIndex?: Record<number, string>, blankIndexes?: number[] }} hints
 */
function repairDeckComposition(slides, hints = {}) {
  const overflowByIndex = hints.overflowByIndex || {};
  const blankSet = new Set(hints.blankIndexes || []);
  const out = [];
  const log = [];
  (slides || []).forEach((raw, i) => {
    const idx = raw && raw.index != null ? raw.index : i + 1;
    const h = {
      overflow: !!overflowByIndex[idx],
      blank: blankSet.has(idx),
    };
    const { slide, changed, actions } = repairSlideComposition(raw, h);
    if (changed) log.push({ index: idx, actions });
    out.push(slide);
  });
  const rhythm = enforceVisualRhythm(out);
  return { slides: rhythm.slides, repairs: log, rhythmChanges: rhythm.changes };
}

/**
 * Parse renderer overflow warning strings into structured hints.
 */
function hintsFromOverflowWarnings(warnings) {
  const overflowByIndex = {};
  const blankIndexes = [];
  for (const w of warnings || []) {
    const m = String(w).match(/слайд\s+(\d+)/i) || String(w).match(/slide\s+(\d+)/i);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    if (/бос|blank/i.test(w)) blankIndexes.push(idx);
    else overflowByIndex[idx] = String(w);
  }
  return { overflowByIndex, blankIndexes };
}


/**
 * Ensure consecutive slides do not share the same image composition (visual rhythm).
 */
function enforceVisualRhythm(slides) {
  const out = (slides || []).map((s) => ({ ...s, composition: { ...(s.composition || {}) } }));
  const alt = ['right_half', 'left_half', 'top_strip', 'full_background', 'none'];
  let changes = 0;
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1].composition.image || 'full_background';
    const cur = out[i].composition.image || 'full_background';
    if (prev === cur && cur === 'full_background' && i < out.length - 1) {
      // pick alternating split for middle slides without tables/stats overload
      const s = out[i];
      const stats = Array.isArray(s.stats) ? s.stats.length : 0;
      const hasTable = !!(s.table && (s.table.headers || s.table.rows));
      if (!hasTable && stats < 2) {
        out[i].composition.image = alt[i % alt.length];
        if (out[i].composition.image === 'right_half' || out[i].composition.image === 'left_half') {
          out[i].composition.textPosition = out[i].composition.image === 'right_half' ? 'left_column' : 'right_column';
        }
        changes++;
      }
    }
  }
  return { slides: out, changes };
}

module.exports = {
  repairSlideComposition,
  repairDeckComposition,
  hintsFromOverflowWarnings,
  contentWeight,
  ensureComposition,
  inferSemanticPurpose,
  applySemanticComposition,
  enforceVisualRhythm,
};
