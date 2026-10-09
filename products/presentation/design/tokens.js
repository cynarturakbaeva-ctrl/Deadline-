'use strict';
/**
 * DESIGN TOKENS — single source of truth for every visual decision.
 * Layouts, style and renderer only read from here; nothing is hard-coded elsewhere.
 * Canvas is 1920×1080 (16:9). All numbers are px on that canvas.
 */

// ── Colour helpers ─────────────────────────────────────────────────────────
function safeColor(hex, fb) {
  if (typeof hex !== 'string') return fb;
  const c = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{3,8}$/.test(c)) return fb;
  return '#' + (c.length === 3 ? c.split('').map((x) => x + x).join('') : c.slice(0, 6));
}
function hexToRgb(h) {
  let c = String(h || '').replace('#', '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const n = parseInt(c.slice(0, 6), 16);
  if (!isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2)).join('');
}
function mixHex(a, b, t) {
  const A = hexToRgb(a); const B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const la = luminance(a); const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Nudge `fg` towards `toward` until it reaches the contrast ratio against `bg`. */
function ensureContrast(fg, bg, toward, min) {
  let c = fg; let t = 0;
  while (contrast(c, bg) < min && t < 1) { t += 0.08; c = mixHex(fg, toward, t); }
  return c;
}
function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

// ── Scales ─────────────────────────────────────────────────────────────────
const SPACE = Object.freeze({ 0: 0, 1: 8, 2: 16, 3: 24, 4: 32, 5: 48, 6: 64, 7: 96, 8: 128, 9: 160 });
const RADIUS = Object.freeze({ none: 0, sm: 4, md: 10, lg: 18, pill: 999 });
const SHADOW = Object.freeze({
  none: 'none',
  sm: '0 2px 10px rgba(0,0,0,.18)',
  md: '0 18px 48px rgba(0,0,0,.28)',
  lg: '0 34px 90px rgba(0,0,0,.42)',
});

// 12-column grid; margins are the safe area for ALL content.
const GRID = Object.freeze({
  W: 1920, H: 1080, cols: 12, gutter: 32,
  marginX: 128, marginTop: 104, marginBottom: 96,
  baseline: 8,
  get contentW() { return this.W - this.marginX * 2; },
  get contentH() { return this.H - this.marginTop - this.marginBottom; },
  get colW() { return (this.contentW - this.gutter * (this.cols - 1)) / this.cols; },
  /** width in px of a block that spans n columns */
  span(n) { return this.colW * n + this.gutter * (n - 1); },
});

// Type scale (px). Display sizes are chosen per title length by fitSize().
const TYPE_SCALE = Object.freeze({
  display: [144, 124, 108, 96, 84, 72],
  title: [92, 80, 70, 62, 54, 48],
  subtitle: 34,
  lead: 42,
  bodyLg: 32,
  body: 28,
  small: 24,
  meta: 20,       // captions / metadata — never smaller
  numeral: [168, 132, 104, 84],
});

// Typography personalities. `display` is used for major titles, `text` for everything else.
const FONT_STACKS = Object.freeze({
  sans: 'Inter,"Segoe UI","Noto Sans","Helvetica Neue",Arial,system-ui,sans-serif',
  serif: '"DisplayFace","Iowan Old Style","Palatino Linotype","Book Antiqua","Noto Serif","DejaVu Serif",Georgia,serif',
});
const TYPE_STYLES = Object.freeze({
  editorial: {
    display: FONT_STACKS.serif, text: FONT_STACKS.sans,
    displayWeight: 500, titleWeight: 500, displayTracking: '-0.02em', titleTracking: '-0.015em',
    displayLine: 1.02, titleLine: 1.08, caps: false, italicQuote: true,
  },
  modern: {
    display: FONT_STACKS.sans, text: FONT_STACKS.sans,
    displayWeight: 800, titleWeight: 750, displayTracking: '-0.045em', titleTracking: '-0.035em',
    displayLine: 0.98, titleLine: 1.04, caps: false, italicQuote: false,
  },
  technical: {
    display: FONT_STACKS.sans, text: FONT_STACKS.sans,
    displayWeight: 650, titleWeight: 650, displayTracking: '-0.03em', titleTracking: '-0.025em',
    displayLine: 1.0, titleLine: 1.06, caps: false, italicQuote: false,
  },
});

// Mood → base colours + image treatment + decoration kind. The accent is layered on top.
// `deco` picks the background decoration drawn on plain (photo-less) slides — see style.js (.deco-*).
const MOODS = ({
  // ── dark ──
  dark:     { bg: '#07090d', text: '#f3f5f8', accent: '#d6b25e', tone: 'modern',    deco: 'orbs',     img: 'saturate(.92) contrast(1.04) brightness(.96)', scrim: 0.55 },
  warm:     { bg: '#140e0a', text: '#f3e8da', accent: '#d9954f', tone: 'editorial', deco: 'diagonal', img: 'sepia(.14) saturate(.94) contrast(1.03)',    scrim: 0.55 },
  cold:     { bg: '#060d15', text: '#e9f1f8', accent: '#62b0e0', tone: 'technical', deco: 'rings',    img: 'saturate(.86) contrast(1.04) hue-rotate(-4deg)', scrim: 0.55 },
  vivid:    { bg: '#0b0612', text: '#f8f3fd', accent: '#d65bc4', tone: 'modern',    deco: 'orbs',     img: 'saturate(1.05) contrast(1.04)',              scrim: 0.55 },
  archive:  { bg: '#110d0a', text: '#efe4d3', accent: '#c19a5b', tone: 'editorial', deco: 'rings',    img: 'sepia(.22) saturate(.86) contrast(1.05)',    scrim: 0.6 },
  midnight: { bg: '#0a1224', text: '#eaf0fb', accent: '#5aa9ff', tone: 'technical', deco: 'grid',     img: 'saturate(.9) contrast(1.05)',                scrim: 0.55 },
  forest:   { bg: '#08150f', text: '#e8f4ec', accent: '#4fc08d', tone: 'editorial', deco: 'dots',     img: 'saturate(.95) contrast(1.03)',               scrim: 0.55 },
  wine:     { bg: '#16080d', text: '#f7e9ec', accent: '#e5677f', tone: 'editorial', deco: 'diagonal', img: 'saturate(.95) contrast(1.04)',               scrim: 0.55 },
  graphite: { bg: '#131416', text: '#f1f1ef', accent: '#ff7a45', tone: 'modern',    deco: 'bands',    img: 'saturate(.9) contrast(1.06)',                scrim: 0.55 },
  // ── light ──
  light:    { bg: '#f1ece4', text: '#15171c', accent: '#a5432f', tone: 'editorial', deco: 'bands',    img: 'saturate(.95) contrast(1.02)',               scrim: 0.0 },
  ivory:    { bg: '#f7f5ee', text: '#14213d', accent: '#1d4e89', tone: 'editorial', deco: 'rings',    img: 'saturate(.95) contrast(1.02)',               scrim: 0.0 },
  cloud:    { bg: '#f2f6fb', text: '#0e1a2b', accent: '#1f6fd1', tone: 'technical', deco: 'grid',     img: 'saturate(.98) contrast(1.02)',               scrim: 0.0 },
  mint:     { bg: '#eef6f1', text: '#10241a', accent: '#1f8a5b', tone: 'modern',    deco: 'dots',     img: 'saturate(.98) contrast(1.02)',               scrim: 0.0 },
  blush:    { bg: '#fbf1ee', text: '#2a1519', accent: '#c2415a', tone: 'modern',    deco: 'orbs',     img: 'saturate(.98) contrast(1.02)',               scrim: 0.0 },
  sand:     { bg: '#f3ebdc', text: '#2a2118', accent: '#b8651b', tone: 'editorial', deco: 'diagonal', img: 'sepia(.08) saturate(.96) contrast(1.02)',    scrim: 0.0 },
});

/** Register a theme derived from a client's reference PPTX. Key is content-hashed → idempotent, bounded. */
function registerMood(def) {
  const bg = safeColor(def.bg, '#ffffff'); const text = safeColor(def.text, '#111111'); const accent = safeColor(def.accent, '#1f6fd1');
  const key = 'ref_' + strHash(bg + text + accent + (def.deco || '') + (def.tone || '') + (def.radius || '')).toString(16);
  if (!MOODS[key]) {
    const light = luminance(bg) > 0.4;
    MOODS[key] = {
      bg, text, accent, tone: def.tone || 'modern', deco: def.deco || 'bands', radius: def.radius || 'md', ref: true,
      img: 'saturate(.98) contrast(1.02)', scrim: light ? 0.0 : 0.55,
    };
  }
  return key;
}

// Which themes suit which deck style. Unlisted style → every theme.
const THEME_POOLS = Object.freeze({
  business: ['midnight', 'cold', 'cloud', 'graphite', 'ivory'],
  minimal:  ['cloud', 'ivory', 'light', 'mint', 'sand', 'blush'],
  creative: ['vivid', 'blush', 'graphite', 'wine', 'mint', 'sand', 'forest'],
  academic: ['ivory', 'cloud', 'mint', 'sand', 'light', 'midnight', 'forest'],
  pitch:    ['vivid', 'graphite', 'midnight', 'wine', 'cloud'],
});

function strHash(str) {
  let h = 2166136261 >>> 0;
  const t = String(str || '');
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function isLightMood(key) { return !!MOODS[key] && luminance(MOODS[key].bg) > 0.4; }

/**
 * The CODE (not the LLM) chooses the deck theme, so decks stop looking identical.
 *  - the client's explicit wish ("қара фон", "светлая тема", "dark theme") wins;
 *  - otherwise a theme from the style pool is picked from `seed` (topic + job id);
 *  - `avoid` (previous deck's theme) is skipped so two decks in a row never match.
 * Returns the mood key (a key of MOODS).
 */
function pickTheme(opts) {
  const o = opts || {};
  const brief = String(o.brief || '');
  // 'dark' (қара+алтын) — бұрынғы әдепкі; енді тек клиент қара фон сұраса ғана таңдалады
  const allThemes = Object.keys(MOODS).filter((k) => k !== 'dark');
  let pool = (THEME_POOLS[String(o.style || '').toLowerCase()] || allThemes).slice();
  const wantsDark = /(қара|тұнық|тёмн\p{L}*|темн\p{L}*|dark|black)\s*(фон|тема|түс|стиль|дизайн|background|theme|mode)/iu.test(brief);
  const wantsLight = /(ақ|жарық|светл\p{L}*|бел\p{L}*|light|white)\s*(фон|тема|түс|стиль|дизайн|background|theme|mode)/iu.test(brief);
  if (wantsDark && !wantsLight) pool = Object.keys(MOODS).filter((k) => !isLightMood(k));
  else if (wantsLight && !wantsDark) pool = Object.keys(MOODS).filter(isLightMood);
  pool = pool.filter((k) => MOODS[k]);
  if (!pool.length) pool = allThemes;
  const start = strHash(o.seed) % pool.length;
  for (let i = 0; i < pool.length; i++) {
    const k = pool[(start + i) % pool.length];
    if (k !== o.avoid || pool.length === 1) return k;
  }
  return pool[start];
}

const STYLE_HINTS = Object.freeze({
  business: { tone: 'technical', radius: 'sm' },
  minimal: { tone: 'editorial', radius: 'none' },
  creative: { tone: 'modern', radius: 'md' },
  academic: { tone: 'editorial', radius: 'sm' },
  pitch: { tone: 'modern', radius: 'sm' },
});

/**
 * Build a complete deck palette. Every colour is derived from a small seed
 * (mood + accent) so the whole deck stays coherent.
 */
function buildPalette(mood, accent, styleKey) {
  const m = MOODS[String(mood || 'dark').toLowerCase()] || MOODS.dark;
  const isLight = luminance(m.bg) > 0.4;
  const bg = m.bg;
  const text = m.text;
  let acc = safeColor(accent, m.accent);
  // Accent must be readable as text/graphic on the background.
  acc = ensureContrast(acc, bg, text, 3.4);
  const hint = STYLE_HINTS[String(styleKey || '').toLowerCase()] || {};
  return {
    mood: String(mood || 'dark').toLowerCase() in MOODS ? String(mood || 'dark').toLowerCase() : 'dark',
    isLight,
    bg,
    bg2: mixHex(bg, text, isLight ? 0.045 : 0.055),
    bg3: mixHex(bg, text, isLight ? 0.09 : 0.1),
    text,
    text2: ensureContrast(mixHex(text, bg, 0.34), bg, text, 5),
    text3: mixHex(text, bg, 0.55),
    line: mixHex(bg, text, 0.2),
    lineSoft: mixHex(bg, text, 0.11),
    accent: acc,
    accentSoft: mixHex(bg, acc, 0.22),
    accentInk: contrast('#000000', acc) >= contrast('#ffffff', acc) ? '#0a0a0a' : '#ffffff',
    image: m.img,
    deco: m.deco || 'orbs',
    scrim: m.scrim,
    tone: m.ref ? m.tone : (hint.tone || m.tone),
    radius: m.ref ? m.radius : (hint.radius || 'md'),
  };
}

function typeStyleFor(palette) {
  return TYPE_STYLES[palette.tone] || TYPE_STYLES.modern;
}

module.exports = {
  SPACE, RADIUS, SHADOW, GRID, TYPE_SCALE, FONT_STACKS, TYPE_STYLES, MOODS, THEME_POOLS, STYLE_HINTS,
  buildPalette, typeStyleFor, pickTheme, isLightMood, registerMood,
  safeColor, hexToRgb, mixHex, luminance, contrast, ensureContrast, rgba,
};
