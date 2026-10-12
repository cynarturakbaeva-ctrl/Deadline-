'use strict';
/**
 * PHOTO PLAN — ask the stock-photo APIs only for the slides that will actually SHOW a photo.
 *
 * The layout engine picks a slide's composition from its content AND from whether it has a photo, and most
 * layouts (lists, numbers, timelines, tables, infographics…) never show one. Searching a photo for every slide
 * wasted ~10–30 API calls per deck and burned the Unsplash/Pexels hourly limits.
 *
 * So, before any search, we run the same deck planner with a placeholder photo on every slide that may carry one
 * and keep only the slides whose planned layout really displays it. Photos therefore land exactly where they did
 * before; the rest of the slides cost no request at all. A budget caps the count (cover first).
 */
const A = require('./design/analyze');
const { validateInfographic } = require('./design/infographics');

const PLACEHOLDER = 'about:photo'; // not a data: URI → size unknown → treated as sharp enough, like a real photo
/** Layouts that display the slide photo (see design/layouts.js). */
const SHOWS_PHOTO = new Set(['cover', 'imageFocus', 'split', 'fullImage', 'stackSplit', 'section', 'closing', 'editorial']);
/** Which photo slides win when the budget is tight. */
const PRIORITY = { cover: 0, imageFocus: 1, fullImage: 1, split: 2, stackSplit: 2, section: 3, closing: 4, editorial: 5 };

function mayCarryPhoto(slide) {
  const s = slide || {};
  if (s.composition && s.composition.image === 'none') return false;
  if (validateInfographic(s.infographic)) return false;
  return true;
}

/**
 * @param {object[]} slides
 * @param {{ budget?: number }} [opts]
 * @returns {{ indexes: Set<number>, planned: string[] }} slides to search a photo for + their planned layouts
 */
function planPhotoSlides(slides, opts = {}) {
  const list = Array.isArray(slides) ? slides : [];
  const budget = Number.isFinite(opts.budget) ? opts.budget : 4;
  const sim = list.map((s) => Object.assign({}, s, { webImageUrl: mayCarryPhoto(s) ? PLACEHOLDER : '' }));
  const plan = A.planDeck(sim);
  const cands = [];
  plan.forEach((p, i) => {
    if (sim[i].webImageUrl && SHOWS_PHOTO.has(p.layout)) cands.push({ i, layout: p.layout, rank: PRIORITY[p.layout] });
  });
  cands.sort((a, b) => a.rank - b.rank || a.i - b.i);
  const keep = cands.slice(0, Math.max(0, budget));
  return { indexes: new Set(keep.map((c) => c.i)), planned: plan.map((p) => p.layout) };
}

module.exports = { planPhotoSlides, mayCarryPhoto, SHOWS_PHOTO };
