'use strict';

/**
 * PPTX export — HTML render PNG only (single source of truth).
 * Native addText layer removed: PNG already contains text;
 * adding text again caused double-layer / doubled text.
 */

const PptxGenJS = require('pptxgenjs');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { uniqueId } = require('./tmpFiles');

const STAGE_W_IN = 13.333;
const STAGE_H_IN = 7.5;

/**
 * @param {string[]} pngPaths — Puppeteer HTML → PNG paths
 * @param {string} presentationTitle
 * @param {object[]} [slides] — speaker notes only (no native text layer)
 * @returns {Promise<string>} pptx file path
 */
async function exportToPptx(pngPaths, presentationTitle, slides = []) {
  if (!Array.isArray(pngPaths) || pngPaths.length === 0) {
    throw new Error('exportToPptx: pngPaths empty');
  }

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 × 7.5 in, 16:9
  pptx.title = presentationTitle || 'Presentation';

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

    // Single layer: rendered HTML PNG only
    pgSlide.addImage({
      path: pngPath,
      x: 0,
      y: 0,
      w: STAGE_W_IN,
      h: STAGE_H_IN,
    });
  }

  const outPath = path.join(os.tmpdir(), `presentation-${uniqueId()}.pptx`);
  await pptx.writeFile({ fileName: outPath });
  return outPath;
}

module.exports = { exportToPptx };
