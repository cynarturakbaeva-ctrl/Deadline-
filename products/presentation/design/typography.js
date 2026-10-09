'use strict';
/**
 * TYPOGRAPHY — sizes a text block so it fits its column by simulating line breaks.
 * No fixed "font-size: 80px for everything": size is derived from text length,
 * column width, allowed line count and the typeface's average glyph width.
 */
const { TYPE_SCALE } = require('./tokens');

// average glyph width (em) per family/weight class; Cyrillic/Kazakh run a bit wider than Latin.
function glyphEm(kind, weight) {
  // Cyrillic/Kazakh glyphs run wider than Latin; measured against Lora + Inter renders
  const base = kind === 'serif' ? 0.60 : 0.605;
  return base + (weight >= 700 ? 0.035 : weight >= 600 ? 0.02 : 0);
}

function simulateLines(text, sizePx, widthPx, em, tracking) {
  const wordsArr = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!wordsArr.length) return { lines: 0, longest: 0 };
  const cw = sizePx * (em + (tracking || 0));
  let lines = 1; let cur = 0; let longest = 0;
  for (const w of wordsArr) {
    const ww = w.length * cw;
    longest = Math.max(longest, ww);
    const sp = cur ? cw * 0.3 : 0;
    if (cur + sp + ww <= widthPx) cur += sp + ww;
    else { lines += 1; cur = ww; }
  }
  return { lines, longest };
}

/**
 * Pick the largest size from `scale` whose text fits in `maxLines` lines.
 * @returns {{size:number, lines:number}}
 */
function fitSize(text, opts) {
  const {
    width, maxLines = 3, scale = TYPE_SCALE.title, kind = 'sans', weight = 700,
    tracking = -0.03, minSize,
  } = opts;
  const em = glyphEm(kind, weight);
  let last = { size: scale[scale.length - 1], lines: 99 };
  for (const size of scale) {
    if (minSize && size < minSize) break;
    const { lines, longest } = simulateLines(text, size, width, em, tracking);
    last = { size, lines };
    if (longest <= width * 0.98 && lines <= maxLines) return last;
  }
  return last;
}

/** Shorten a title only as a last resort (never mid-word). */
function clampWords(text, maxWords) {
  const w = String(text || '').trim().split(/\s+/);
  return w.length <= maxWords ? String(text || '').trim() : w.slice(0, maxWords).join(' ') + '…';
}

/** Body size from density: fewer words → larger, more readable type. Never below `meta`. */
function bodySize(wordCount, opts = {}) {
  const { large = TYPE_SCALE.bodyLg, normal = TYPE_SCALE.body, small = TYPE_SCALE.small } = opts;
  if (wordCount <= 26) return large;
  if (wordCount <= 70) return normal;
  return small;
}

module.exports = { fitSize, simulateLines, clampWords, bodySize, glyphEm };
