'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { pathToFileURL } = require('url');

const SLIDE_W = 1280;
const SLIDE_H = 720;

/**
 * Дайын HTML презентацияны (html3DBuilder) ашып, әр слайдты PNG-ге түсіреді.
 * PPTX осы PNG-лерден жасалады, сондықтан PPTX мен HTML бірдей болады.
 *
 * HTML-дің өз JS-і (goTo, камера ауысулары, счётчиктер) өзгертілмейді.
 * Біз тек: терезені 1280×720 етіп қоямыз, әр слайдқа өтеміз,
 * анимация біткенше күтеміз, #stage-ті түсіреміз.
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
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0', timeout: 60000 });

    const count = await page.evaluate(() => document.querySelectorAll('.slide').length);
    if (!count) throw new Error('HTML-де слайд табылмады');

    // Экспортқа кедергі болатын интерфейсті жасырамыз (батырмалар, нүктелер, подсказка, прогресс).
    // Бұл тек скриншотқа әсер етеді, HTML файлдың өзі өзгермейді.
    await page.addStyleTag({
      content:
        '#controls,#dots,#hint,#progress,#topbar{display:none !important}' +
        '#stage{box-shadow:none !important}' +
        // Экспортта параллакс керек емес (тінтуірдің орнына тұрақты күй)
        '.layer{transform:none !important}',
    });

    for (let i = 0; i < count; i++) {
      // HTML-дің өз механизмі: пернетақта → goTo() → камера ауысуы + кіру анимациясы.
      // Біз ештеңені күштеп өшірмейміз, тек анимацияның аяқталуын күтеміз —
      // сонда нәтиже пайдаланушы браузерде көретінмен бірдей болады.
      if (i > 0) await page.keyboard.press('ArrowRight');

      // Ауысу (1.25с) + кіру анимациялары + счётчик (1.2с) біткенше
      await page.waitForFunction(
        (idx) => {
          const slides = document.querySelectorAll('.slide');
          const s = slides[idx];
          if (!s || !s.classList.contains('is-active')) return false;
          // Ешбір слайд ауысу күйінде қалмауы керек
          return ![].some.call(slides, (el) => el.classList.contains('is-leaving') || el.classList.contains('from') || el.classList.contains('to'));
        },
        { timeout: 15000 },
        i
      );
      await new Promise((r) => setTimeout(r, 1600));

      // Шрифт пен фондық суреттің жүктелуін күтеміз
      await page.evaluate(() => document.fonts && document.fonts.ready);
      await page.evaluate(async (idx) => {
        const s = document.querySelectorAll('.slide')[idx];
        const urls = [];
        s.querySelectorAll('*').forEach((el) => {
          const bg = getComputedStyle(el).backgroundImage;
          const m = bg && bg.match(/url\(["']?(.*?)["']?\)/);
          if (m && m[1] && !m[1].startsWith('data:')) urls.push(m[1]);
        });
        await Promise.all(urls.map((u) => new Promise((res) => {
          const im = new Image();
          im.onload = im.onerror = () => res();
          im.src = u;
        })));
      }, i);

      const stage = await page.$('#stage');
      const outPath = path.join(tmpDir, 'slide-' + String(i + 1).padStart(3, '0') + '.png');
      await stage.screenshot({ path: outPath, type: 'png' });
      pngPaths.push(outPath);
    }
  } finally {
    await browser.close();
  }

  return { pngPaths, tmpDir };
}

module.exports = { renderHtmlToPngs };
