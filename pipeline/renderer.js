'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { pathToFileURL } = require('url');

const SLIDE_W = 1920;
const SLIDE_H = 1080;

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
  const overflowWarnings = [];

  const browser = await puppeteer.launch({
    headless: 'new',
    // Termux/Android-да Puppeteer-дің өз Chromium жүктемесі көбіне сәтсіз
    // болады немесе мүлде жұмыс істемейді (ARM/Android binary шектеуі).
    // PUPPETEER_EXECUTABLE_PATH қойылса (мыс. termux-chromium немесе
    // жүйедегі Chrome жолы), соны қолданады; қойылмаса — бұрынғыдай
    // Puppeteer-дің өз бумаланған Chromium-ын іздейді (мінез-құлық өзгермейді).
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
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
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 60000 });

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

      // Скриншот тек ағымдағы слайдты көрсетуі КЕРЕК. goTo()-дың класс тазалау
      // setTimeout-ы (1300мс) мен CSS transition ұзақтығы (var(--dur)=1250мс)
      // арасы тар — баяу ортада (Termux/Colab/CI) "leaving" слайд screenshot
      // сәтінде әлі DOM-да, opacity толық 0-ге жетпей қалуы мүмкін, сол кезде
      // ол алдыңғы слайдтың мәтіні/карточкалары ағымдағы слайдтың үстіне
      // "елес" болып қабатталып түседі (PPTX-те қабатталған мәтін ретінде
      // көрінетін баг дәл осыдан). Сондықтан CSS transition-ге сенбей, скриншот
      // алдында белсенді слайдтан басқаның бәрін СӨЗСІЗ жасырамыз.
      await page.evaluate((idx) => {
        document.querySelectorAll('.slide').forEach((el, j) => {
          if (j !== idx) {
            el.style.setProperty('display', 'none', 'important');
          } else {
            el.classList.remove('is-leaving', 'from', 'to');
            el.style.removeProperty('display');
            el.style.setProperty('opacity', '1', 'important');
            el.style.setProperty('visibility', 'visible', 'important');
            el.style.setProperty('transform', 'none', 'important');
            el.style.setProperty('filter', 'none', 'important');
          }
        });
      }, i);

      // ТЕКСЕРУ: мәтін блогы стейдж шегінен шықпағанын өлшейміз (бұзылған слайд үнсіз PPTX-ке кетпесін)
      const fit = await page.evaluate((idx) => {
        const st = document.getElementById('stage');
        const s = document.querySelectorAll('.slide')[idx];
        const fig = s.querySelector('.figure img');
        if (fig && !(fig.complete && fig.naturalWidth > 0)) return { ok: false, top: 0, bottom: 0, figure: true };
        const bl = s.querySelector('.block');
        if (!bl) return { ok: true };
        const k = parseFloat(getComputedStyle(st).getPropertyValue('--fit')) || 1;
        const sr = st.getBoundingClientRect();
        const br = bl.getBoundingClientRect();
        const top = (br.top - sr.top) / k;
        const bottom = (br.bottom - sr.top) / k;
        const right = (br.right - sr.left) / k;
        return { ok: top >= 0 && bottom <= 1080 && right <= 1920, top: Math.round(top), bottom: Math.round(bottom) };
      }, i);
      if (!fit.ok) {
        overflowWarnings.push(fit.figure ? ('слайд ' + (i + 1) + ': SVG фигура жүктелмеді') : ('слайд ' + (i + 1) + ': ' + fit.top + '..' + fit.bottom + ' / 1080'));
        console.warn('[Render] ⚠️ слайд ' + (i + 1) + ' стейджден асады (' + fit.top + '..' + fit.bottom + ')');
      }

      const stage = await page.$('#stage');
      const outPath = path.join(tmpDir, 'slide-' + String(i + 1).padStart(3, '0') + '.png');
      await stage.screenshot({ path: outPath, type: 'png' });
      pngPaths.push(outPath);
    }
  } finally {
    await browser.close();
  }

  return { pngPaths, tmpDir, overflowWarnings };
}

module.exports = { renderHtmlToPngs };
