'use strict';

const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function exportToPptx(pngPaths, presentationTitle) {
  const pptx = new PptxGenJS();

  pptx.layout = 'LAYOUT_WIDE'; // 16:9
  pptx.title = presentationTitle || 'Presentation';

  for (const pngPath of pngPaths) {
    const slide = pptx.addSlide();
    slide.addImage({
      path: pngPath,
      x: 0,
      y: 0,
      w: '100%',
      h: '100%',
    });
  }

  const outPath = path.join(os.tmpdir(), `presentation-${Date.now()}.pptx`);
  await pptx.writeFile({ fileName: outPath });

  return outPath;
}

module.exports = { exportToPptx };
