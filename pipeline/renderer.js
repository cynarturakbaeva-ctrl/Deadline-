'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');

async function renderSlide(html, outputPath) {
  const puppeteer = require('puppeteer');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: outputPath, type: 'png' });
  } finally {
    await browser.close();
  }
}

async function renderAllSlides(htmlSlides) {
  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-'));
  const pngPaths = [];

  for (let i = 0; i < htmlSlides.length; i++) {
    const outPath = path.join(tmpDir, `slide-${String(i + 1).padStart(3, '0')}.png`);
    await renderSlide(htmlSlides[i], outPath);
    pngPaths.push(outPath);
  }

  return { pngPaths, tmpDir };
}

module.exports = { renderAllSlides };
