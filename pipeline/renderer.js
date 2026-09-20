'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { pathToFileURL } = require('url');
const { SLIDE_W, SLIDE_H } = require('./presentationHtml');

/**
 * Дайын презентация HTML файлын ашып, әр слайдты PNG-ге түсіреді.
 * PPTX осы PNG-лерден жасалады, сондықтан PPTX мен HTML бірдей болады.
 *
 * Бір браузер, бір бет — слайдтар арасында тек ?slide=N ауысады.
 */
async function renderHtmlToPngs(htmlPath) {
  const puppeteer = require('puppeteer');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slides-'));
  const pngPaths = [];

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
    await page.setViewport({ width: SLIDE_W, height: SLIDE_H, deviceScaleFactor: 1 });

    const baseUrl = pathToFileURL(htmlPath).href;

    // Слайд санын бірінші рет ашқанда аламыз
    await page.goto(baseUrl + '?slide=1', { waitUntil: 'networkidle0', timeout: 60000 });
    await page.waitForFunction('window.__ready === true', { timeout: 15000 });
    const count = await page.evaluate(() => window.__slideCount || 0);
    if (!count) throw new Error('HTML-де слайд табылмады');

    for (let i = 1; i <= count; i++) {
      if (i > 1) {
        await page.goto(baseUrl + '?slide=' + i, { waitUntil: 'networkidle0', timeout: 60000 });
        await page.waitForFunction('window.__ready === true', { timeout: 15000 });
      }

      // Ішкі iframe-дегі шрифттер мен суреттер толық жүктелгенше күтеміз
      for (const frame of page.frames()) {
        if (frame === page.mainFrame()) continue;
        try {
          await frame.evaluate(() => document.fonts && document.fonts.ready);
        } catch { /* iframe қолжетімсіз болса — өткізіп жібереміз */ }
      }

      const outPath = path.join(tmpDir, 'slide-' + String(i).padStart(3, '0') + '.png');
      await page.screenshot({
        path: outPath,
        type: 'png',
        clip: { x: 0, y: 0, width: SLIDE_W, height: SLIDE_H },
      });
      pngPaths.push(outPath);
    }
  } finally {
    await browser.close();
  }

  return { pngPaths, tmpDir };
}

module.exports = { renderHtmlToPngs };
                                
