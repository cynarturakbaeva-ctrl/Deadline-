'use strict';

const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { pathToFileURL } = require('url');
const { extractTextLayer, hideText, textLeaks } = require('./textLayer');
const { fitSvgLabels } = require('./svgFit');
const { placeDecor } = require('./design/decor');

const SLIDE_W = 1920;
const SLIDE_H = 1080;

const LAUNCH_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'];

/** Chrome-ды табу: env → puppeteer өз жолы → екі кэш папкасы (жоба/.cache және ~/.cache) → жүйелік Chromium. */
function findChrome(puppeteer) {
  const out = [];
  if (process.env.PUPPETEER_EXECUTABLE_PATH) out.push(process.env.PUPPETEER_EXECUTABLE_PATH);
  try { out.push(puppeteer.executablePath()); } catch {}
  const roots = [
    path.join(__dirname, '..', '..', '.cache', 'puppeteer'),
    path.join(os.homedir(), '.cache', 'puppeteer'),
    '/root/.cache/puppeteer', '/app/.cache/puppeteer',
  ];
  for (const r of roots) {
    for (const kind of ['chrome', 'chrome-headless-shell']) {
      const dir = path.join(r, kind);
      let vers = [];
      try { vers = fs.readdirSync(dir).sort().reverse(); } catch { continue; }
      for (const v of vers) {
        for (const bin of ['chrome-linux64/chrome', 'chrome-headless-shell-linux64/chrome-headless-shell']) out.push(path.join(dir, v, bin));
      }
    }
  }
  out.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable');
  return [...new Set(out)].filter((p) => { try { return p && fs.statSync(p).isFile(); } catch { return false; } });
}

let installTried = false;
async function launchBrowser(puppeteer) {
  const errors = [];
  const tryLaunch = async (executablePath) => {
    try { return await puppeteer.launch({ headless: 'new', executablePath, args: LAUNCH_ARGS }); }
    catch (e) { errors.push(`${executablePath || 'default'}: ${String(e.message).split('\n')[0]}`); return null; }
  };
  for (const p of findChrome(puppeteer)) {
    const b = await tryLaunch(p);
    if (b) return b;
  }
  // Chrome мүлде жоқ — бір рет өзіміз жүктеп көреміз (Railway-де желі бар)
  if (!installTried) {
    installTried = true;
    console.log('[Render] Chrome табылмады — жүктеп жатырмыз (npx puppeteer browsers install chrome)...');
    try {
      require('child_process').execSync('npx --yes puppeteer browsers install chrome', {
        cwd: path.join(__dirname, '..', '..'), stdio: 'pipe', timeout: 300000,
      });
      for (const p of findChrome(puppeteer)) {
        const b = await tryLaunch(p);
        if (b) return b;
      }
    } catch (e) { errors.push('install: ' + String(e.message).split('\n')[0]); }
  }
  const msg = 'Chrome іске қосылмады: ' + errors.join(' | ');
  console.log('[Render] ❌ ' + msg); // info деңгейінде де көрінсін
  throw new Error(msg);
}

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
  const bgPaths = [];      // мәтінсіз фон (өңделетін PPTX үшін)
  const textLayers = [];   // әр слайдтың мәтін блоктары (орны, жолдары, стилі)
  const overflowWarnings = [];
  const bgLeaks = [];       // PPTX фонында жасырылмай қалған мәтін (болмауы керек)

  const browser = await launchBrowser(puppeteer);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: SLIDE_W, height: SLIDE_H, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load', timeout: 120000 });

    const count = await page.evaluate(() => document.querySelectorAll('.slide').length);
    if (!count) throw new Error('HTML-де слайд табылмады');

    // Дизайн-жүйенің ішкі сапа тексеруі (overflow/overlap/safe-area + авто-түзету) HTML ішінде жүреді.
    // Нәтижесін күтеміз: сонда скриншот түзетілген күйде түсіріледі.
    let designReport = [];
    try {
      designReport = (await page.evaluate(() => (window.__qaDone ? window.__qaDone : Promise.resolve([])))) || [];
    } catch (e) {
      console.warn('[Render] design QA unavailable:', e.message);
    }
    for (const rep of designReport) {
      const hard = (rep.issues || []).filter((x) => x.hard);
      if (hard.length) {
        overflowWarnings.push('слайд ' + rep.index + ': дизайн — ' + hard.map((x) => x.type).join(', '));
        console.warn('[Render] ⚠️ слайд ' + rep.index + ' design QA: ' + hard.map((x) => x.type + '(' + x.detail + ')').join(' '));
      } else if (rep.fs < 1 || rep.dropped) {
        console.log('[Render] слайд ' + rep.index + ' авто-түзетілді: fs=' + rep.fs + (rep.dropped ? ' trimmed=' + rep.dropped : ''));
      }
    }

    // Модель салған сызбадағы жазу өз пішінінен (таблетка/шеңбер) шықса — сол жазудың қаріпі кішірейеді
    try {
      const fixed = (await page.evaluate(fitSvgLabels)) || [];
      fixed.forEach((r) => console.log('[Render] сызба ' + (r.figure + 1) + (r.error ? ' тексерілмеді: ' + r.error : ': ' + r.labels + ' жазу пішініне сыйғызылды')));
    } catch (e) {
      console.warn('[Render] svg fit unavailable:', e.message);
    }

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
        await Promise.all([].map.call(s.querySelectorAll('img'), (im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve())));
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

      // Мағыналы әшекей: мәтінге/фотоға тимейтін бос бұрышқа (жоқ болса — алынады)
      await page.evaluate(placeDecor, i).catch(() => []);

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
      const alreadyFlagged = overflowWarnings.some((w) => w.indexOf('слайд ' + (i + 1) + ':') === 0);
      if (!fit.ok && !alreadyFlagged) {
        overflowWarnings.push(fit.figure ? ('слайд ' + (i + 1) + ': SVG фигура жүктелмеді') : ('слайд ' + (i + 1) + ': ' + fit.top + '..' + fit.bottom + ' / 1080'));
        console.warn('[Render] ⚠️ слайд ' + (i + 1) + ' стейджден асады (' + fit.top + '..' + fit.bottom + ')');
      }

      const stage = await page.$('#stage');
      const outPath = path.join(tmpDir, 'slide-' + String(i + 1).padStart(3, '0') + '.png');
      await stage.screenshot({ path: outPath, type: 'png' });
      pngPaths.push(outPath);

      // Өңделетін PPTX: мәтінді өлшеп аламыз да, мәтінсіз фонды бөлек түсіреміз.
      // Сәтсіз болса — бұл слайд PPTX-те толық сурет болып қалады (ешқашан құламаймыз).
      let layer = null; let bgPath = null;
      try {
        layer = await page.evaluate(extractTextLayer, i);
        await page.evaluate(hideText, true);
        // фон суретінде мәтін қалмауы керек (әйтпесе PPTX-те сөз екі рет шығады)
        const leaks = await page.evaluate(textLeaks, i).catch(() => []);
        if (leaks.length) {
          bgLeaks.push({ slide: i + 1, leaks });
          console.warn('[Render] ⚠️ слайд ' + (i + 1) + ' фонында мәтін қалды: ' + leaks.slice(0, 3).join(' | '));
        }
        bgPath = path.join(tmpDir, 'bg-' + String(i + 1).padStart(3, '0') + '.png');
        await stage.screenshot({ path: bgPath, type: 'png' });
      } catch (e) {
        console.warn('[Render] слайд ' + (i + 1) + ' мәтін қабаты алынбады: ' + e.message);
        layer = null; bgPath = null;
      } finally {
        await page.evaluate(hideText, false).catch(() => {});
      }
      textLayers.push(layer);
      bgPaths.push(bgPath);
    }
  } finally {
    await browser.close();
  }

  return { pngPaths, bgPaths, textLayers, tmpDir, overflowWarnings, bgLeaks };
}

module.exports = { renderHtmlToPngs, launchBrowser };
