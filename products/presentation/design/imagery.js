'use strict';
/**
 * IMAGERY — photos are design objects: crop, focal point, treatment, relationship with text.
 * Never stretches (always object-fit: cover/contain), chooses panel shape from the
 * photo's orientation and refuses full-bleed for low-resolution sources.
 */
const { RADIUS, SHADOW } = require('./tokens');

const FOCUS_WORDS = {
  top: '50% 12%', bottom: '50% 88%', left: '12% 50%', right: '88% 50%', center: '50% 50%',
  'top-left': '20% 20%', 'top-right': '80% 20%', 'bottom-left': '20% 80%', 'bottom-right': '80% 80%',
};

/** Focal point. Honour explicit hints; otherwise bias upward (subjects/horizons sit above centre). */
function focalPoint(meta, hint) {
  const h = String(hint || '').trim().toLowerCase();
  if (FOCUS_WORDS[h]) return FOCUS_WORDS[h];
  const m = h.match(/^(\d{1,3})%?\s+(\d{1,3})%?$/);
  if (m) return Math.min(100, +m[1]) + '% ' + Math.min(100, +m[2]) + '%';
  if (meta.orientation === 'portrait') return '50% 28%';
  if (meta.orientation === 'square') return '50% 40%';
  return '50% 42%';
}

/** Is the source sharp enough to fill `boxW` px? (unknown size → assume yes) */
function sharpEnough(meta, boxW) {
  if (!meta.w) return true;
  return meta.w >= boxW * 0.6;
}
/**
 * May the photo fill the WHOLE slide (cover / closing / fullImage)? At most ~1.25× upscale (a 1080/1280 px
 * rendition stretched to 1920 turns into a blur) and not portrait (a portrait shows only ~40% of itself there).
 */
function bleedOK(meta, boxW = 1920, ai = false) {
  if (!meta || !meta.w) return true;
  // AI сурет (1K ≈ 1376px) таза, шусыз → 1.4× үлкейтуге шыдайды; фото-сайттың 1080/1280px суреті бұлыңғырланады
  if (meta.w < boxW * (ai ? 0.7 : 0.8)) return false;
  return !(meta.h && meta.w / meta.h < 1.15);
}

/**
 * Panel geometry for a framed photo placed in `cols` grid columns.
 * Portrait → tall 4:5, square → 1:1-ish, landscape → 4:3. Returned as aspect-ratio string.
 */
function panelRatio(meta, avail) {
  const o = meta.orientation;
  if (o === 'portrait') return avail === 'tall' ? 'auto' : '4 / 5';
  if (o === 'square') return avail === 'tall' ? 'auto' : '1 / 1';
  return avail === 'tall' ? 'auto' : '4 / 3';
}

function radiusPx(palette) { return RADIUS[palette.radius] != null ? RADIUS[palette.radius] : RADIUS.md; }

/** <img> element with crop + treatment. `cls` adds a role class. */
function imgTag(url, meta, palette, o = {}) {
  const pos = focalPoint(meta, o.focus);
  const esc = String(url).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const filter = o.plain ? '' : 'filter:' + palette.image + ';';
  return '<img class="ph ' + (o.cls || '') + '" alt="" src="' + esc + '" decoding="async" style="object-position:' + pos + ';' + filter + '">';
}

/** Framed photo panel (inset from edges, hairline border, restrained shadow). */
function framedPhoto(url, meta, palette, o = {}) {
  const r = radiusPx(palette);
  const tall = o.fill === true;
  const style = [
    'border-radius:' + r + 'px',
    'box-shadow:' + (palette.isLight ? SHADOW.md : SHADOW.sm),
    tall ? 'height:100%' : 'aspect-ratio:' + (o.ratio || panelRatio(meta)),
    o.style || '',
  ].filter(Boolean).join(';');
  return '<figure class="photo ' + (o.cls || '') + '" data-role="photo" style="' + style + '">' +
    imgTag(url, meta, palette, o) + '</figure>';
}

/** Scrim recipes keyed by intent. All derive from the palette background — no arbitrary black. */
function scrim(kind, palette) {
  const bg = palette.bg;
  const rgb = (a) => 'color-mix(in srgb,' + bg + ' ' + Math.round(a * 100) + '%,transparent)';
  switch (kind) {
    case 'bottom': return 'linear-gradient(180deg,' + rgb(0.0) + ' 0%,' + rgb(0.25) + ' 38%,' + rgb(0.88) + ' 100%)';
    case 'left': return 'linear-gradient(90deg,' + rgb(0.94) + ' 0%,' + rgb(0.72) + ' 42%,' + rgb(0.05) + ' 82%)';
    case 'flat': return 'linear-gradient(0deg,' + rgb(0.78) + ',' + rgb(0.78) + ')';
    default: return 'none';
  }
}

module.exports = { focalPoint, sharpEnough, bleedOK, panelRatio, imgTag, framedPhoto, scrim, radiusPx };
