'use strict';

/**
 * PPTX export — EDITABLE deck.
 *
 * The HTML deck is only our drawing engine. Each slide becomes:
 *   • a full-bleed background picture rendered WITHOUT text (photos, cards, charts, decoration), and
 *   • native PowerPoint text boxes on top — same position, lines, size, weight and colour as the design,
 *     so the client can fix a word, retype a title or change a colour like in a hand-made deck.
 * Text uses Calibri / Times New Roman (present in every PowerPoint and Google Slides); the renderer measured
 * it with their metric-compatible clones, so line breaks match.
 * If a slide's text layer is missing (render error) that slide falls back to the full rendered picture.
 */

const PptxGenJS = require('pptxgenjs');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { uniqueId } = require('../../core/tmpFiles');

const STAGE_W_IN = 13.333;
const STAGE_H_IN = 7.5;
const PX_PER_IN = 1920 / STAGE_W_IN; // 144 — the HTML stage is 1920×1080
const PT_PER_PX = 72 / PX_PER_IN;    // 0.5

const inch = (px) => Math.round((px / PX_PER_IN) * 10000) / 10000;
const pt = (px) => Math.round(px * PT_PER_PX * 100) / 100;

/** Office font for a CSS family (our stacks start with the Office name already). */
function officeFont(family) {
  const f = String(family || '');
  if (/times|serif|lora|georgia|cambria|displayface/i.test(f) && !/sans/i.test(f)) return 'Times New Roman';
  return 'Calibri';
}

/** Proofing language per run — otherwise PowerPoint marks every Kazakh/Russian word as an English typo. */
function proofLang(text) {
  if (/[әғқңөұүһіӘҒҚҢӨҰҮҺІ]/.test(text)) return 'kk-KZ';
  if (/[а-яёА-ЯЁ]/.test(text)) return 'ru-RU';
  return 'en-US';
}

function sameStyle(a, b) {
  return a.font === b.font && a.size === b.size && a.bold === b.bold && a.italic === b.italic &&
    a.color === b.color && a.alpha === b.alpha && a.spacing === b.spacing && a.upper === b.upper;
}

/** One measured block → pptxgenjs text runs (one paragraph, browser line breaks kept as soft breaks). */
function blockRuns(block, deckLang) {
  const runs = [];
  block.lines.forEach((line, li) => {
    let cur = null;
    line.forEach((w, wi) => {
      const txt = (w.s.upper ? w.text.toUpperCase() : w.text);
      const piece = (wi > 0 && w.space ? ' ' : '') + txt;
      if (cur && wi > 0 && sameStyle(cur.s, w.s)) { cur.text += piece; return; }
      cur = { text: piece, s: w.s, softBreakBefore: li > 0 && wi === 0 };
      runs.push(cur);
    });
  });
  let lang = proofLang(runs.map((r) => r.text).join(' '));
  // short Kazakh words without ә/ғ/қ… ("Топ", "Мақсат") look Russian — trust the deck language for Cyrillic
  if (lang === 'ru-RU' && deckLang === 'kk-KZ') lang = 'kk-KZ';
  return runs.map((r) => {
    const s = r.s;
    const options = {
      fontFace: officeFont(s.font),
      fontSize: pt(s.size),
      bold: !!s.bold,
      italic: !!s.italic,
      color: s.color,
      lang,
    };
    if (s.alpha < 0.99) options.transparency = Math.round((1 - s.alpha) * 100);
    if (Math.abs(s.spacing) >= 0.2) options.charSpacing = pt(s.spacing);
    if (r.softBreakBefore) options.softBreakBefore = true;
    return { text: r.text, options };
  });
}

/**
 * Text box geometry. Width gets a little slack so a font-metric rounding difference never pushes the last word
 * to a new line; centred/right-aligned boxes grow symmetrically/leftwards so the text stays where it was.
 */
function blockBox(block) {
  const ink = block.ink || block;
  let x = Math.min(block.x, ink.x);
  let w = Math.max(block.w, ink.x + ink.w - x);
  const slack = block.nowrap ? Math.max(24, w * 0.08) : Math.max(8, w * 0.04);
  if (block.align === 'center') x -= slack / 2;
  else if (block.align === 'right') x -= slack;
  w += slack;
  const lines = Math.max(1, block.lines.length);
  const h = Math.max(block.h, lines * block.lineHeight);
  return { x: Math.max(0, x), y: Math.max(0, block.y), w: Math.min(w, 1920 - Math.max(0, x)), h };
}

function addTextBlock(pgSlide, block, deckLang) {
  if (!block || !Array.isArray(block.lines) || !block.lines.length) return false;
  const runs = blockRuns(block, deckLang);
  if (!runs.length) return false;
  const box = blockBox(block);
  // Hero numerals / display lines use a line-height tighter than the font itself (0.8–1.0em); PowerPoint and
  // LibreOffice then push the glyphs up. One-line blocks get natural spacing and the box is shifted to compensate.
  let lineH = block.lineHeight;
  const size = Math.max(...block.lines[0].map((w) => w.s.size));
  if (block.lines.length === 1 && lineH < size * 1.15) {
    // browser centres the font's content box (ascent+descent = H) in the line; with 1.2em spacing the office
    // renderers sit it at the bottom of the line → move the box by the difference (measured with LibreOffice)
    const natural = size * 1.2;
    const H = size * (officeFont(block.lines[0][0].s.font) === 'Times New Roman' ? 1.107 : 1.221);
    box.y += lineH / 2 + H / 2 - natural;
    box.h = Math.max(box.h, natural);
    lineH = natural;
  } else {
    const H = size * (officeFont(block.lines[0][0].s.font) === 'Times New Roman' ? 1.107 : 1.221);
    if (lineH > H) box.y -= (lineH - H) / 2;
  }
  pgSlide.addText(runs, {
    x: inch(box.x), y: inch(box.y), w: inch(box.w), h: inch(box.h),
    margin: [0, 0, 0, 0],
    align: block.align === 'justify' ? 'justify' : block.align,
    valign: 'top',
    lineSpacing: pt(lineH),
    paraSpaceBefore: 0,
    paraSpaceAfter: 0,
    wrap: !block.nowrap,
    fit: 'none',
  });
  return true;
}

/**
 * "Made in DeadLine" card (free decks): one picture with a link in the bottom-right corner — a real PowerPoint
 * object the client can move or delete (like Gamma's badge); clicking it brings classmates to the bot.
 * A picture (not a text run) so PowerPoint does not underline/recolour it as a hyperlink.
 */
const BADGE = { w: 268, h: 48, right: 128, bottom: 32 };
const BADGE_PNG = { dark: path.join(__dirname, 'assets', 'badge-dark.png'), light: path.join(__dirname, 'assets', 'badge-light.png') };
function addBadge(pgSlide, badge) {
  const file = badge.dark === false ? BADGE_PNG.light : BADGE_PNG.dark;
  if (!fs.existsSync(file)) return;
  const img = {
    path: file,
    x: inch(1920 - BADGE.right - BADGE.w), y: inch(1080 - BADGE.bottom - BADGE.h), w: inch(BADGE.w), h: inch(BADGE.h),
    altText: 'Made in DeadLine',
  };
  if (badge.url) img.hyperlink = { url: badge.url, tooltip: 'DeadLine — презентация 3 минутта' };
  pgSlide.addImage(img);
}

/**
 * @param {string[]} pngPaths — full rendered slides (fallback per slide)
 * @param {string} presentationTitle
 * @param {object[]} [slides] — speaker notes
 * @param {{ bgPaths?: (string|null)[], textLayers?: (object[]|null)[], language?: string, badge?: {url?:string|null, dark?:boolean}|null }} [layers] — editable text layer from renderer
 * @returns {Promise<string>} pptx file path
 */
async function exportToPptx(pngPaths, presentationTitle, slides = [], layers = {}) {
  if (!Array.isArray(pngPaths) || pngPaths.length === 0) {
    throw new Error('exportToPptx: pngPaths empty');
  }
  const bgPaths = (layers && layers.bgPaths) || [];
  const textLayers = (layers && layers.textLayers) || [];
  const deckLang = { kazakh: 'kk-KZ', russian: 'ru-RU', english: 'en-US' }[String((layers && layers.language) || '').toLowerCase()] || null;

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 × 7.5 in, 16:9
  pptx.title = presentationTitle || 'Presentation';

  let editable = 0;
  for (let i = 0; i < pngPaths.length; i++) {
    const pngPath = pngPaths[i];
    if (!pngPath || !fs.existsSync(pngPath)) {
      throw new Error(`exportToPptx: missing PNG for slide ${i + 1}: ${pngPath}`);
    }

    const pgSlide = pptx.addSlide();
    const slide = Array.isArray(slides) ? slides[i] : null;
    const notes = slide && (slide.speakerNotes || slide.notes);
    if (notes && typeof pgSlide.addNotes === 'function') {
      pgSlide.addNotes(String(notes));
    }

    const bg = bgPaths[i];
    const layer = textLayers[i];
    const canEdit = bg && fs.existsSync(bg) && Array.isArray(layer) && layer.length > 0;
    pgSlide.addImage({ path: canEdit ? bg : pngPath, x: 0, y: 0, w: STAGE_W_IN, h: STAGE_H_IN });
    if (canEdit) {
      layer.forEach((block) => addTextBlock(pgSlide, block, deckLang));
      editable += 1;
    }
    if (layers && layers.badge) addBadge(pgSlide, layers.badge);
  }
  if (bgPaths.length) console.log(`[PPTX] editable text on ${editable}/${pngPaths.length} slide(s)`);

  const outPath = path.join(os.tmpdir(), `presentation-${uniqueId()}.pptx`);
  await pptx.writeFile({ fileName: outPath });
  return outPath;
}

module.exports = { exportToPptx, blockRuns, blockBox, officeFont, proofLang };
