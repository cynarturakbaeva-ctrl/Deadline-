'use strict';

const PptxGenJS = require('pptxgenjs');
const path = require('path');
const os = require('os');

// pngPaths — HTML-ден рендерленген слайд суреттері (HTML-мен бірдей).
// slides — speakerNotes үшін ғана қолданылады.
async function exportToPptx(pngPaths, presentationTitle, slides = []) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 дюйм, 16:9
  pptx.title = presentationTitle || 'Presentation';

  for (let i = 0; i < pngPaths.length; i++) {
    const slide = pptx.addSlide();
    const notes = slides[i] && (slides[i].speakerNotes || slides[i].notes);
    if (notes && typeof slide.addNotes === 'function') slide.addNotes(String(notes));
    slide.addImage({ path: pngPaths[i], x: 0, y: 0, w: 13.333, h: 7.5 });
  }

  const outPath = path.join(os.tmpdir(), `presentation-${Date.now()}.pptx`);
  await pptx.writeFile({ fileName: outPath });
  return outPath;
}

module.exports = { exportToPptx };
