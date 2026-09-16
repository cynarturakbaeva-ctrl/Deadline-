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
    // deviceScaleFactor:2 — PNG-ді 2560x1440 (Retina/HiDPI) ажыратымдылықпен
    // генерациялайды, HTML/CSS пиксель өлшемдерін (1280x720) өзгертпей-ақ.
    // Бұрын 1 тұрған кезде PNG тек 1280x720 болатын — PowerPoint слайд
    // (960x540pt стандарт) осы суретті "жеткілікті" деп ойлағанмен, кез
    // келген zoom/preview режимінде (PowerPoint Online, Google Slides,
    // mobile preview) 1280px сурет slide енінен төмен нақты пиксель тығыздығы
    // беріп, мәтінді сынған/blur/кішкентай етіп көрсетеді — дәл байқалған
    // "мәтін кішкентай, фонмен түсі жақын көрінеді" шағымының бір бөлігі.
    // 2× scale бұл мәселені PNG деңгейінде түбегейлі шешеді: presenter
    // қандай құрылғыда ашса да, мәтін әрдайым өткір.
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);

    // МАҢЫЗДЫ: 'networkidle0' сурет download-ы БІТКЕНІН білдіреді, бірақ
    // JPEG/PNG DECODE (браузердің оны GPU-ға дайын пиксельге айналдыруы)
    // әлі аяқталмаған болуы мүмкін — үлкен немесе баяу сервер суретінде
    // осы decode кідірісі скриншотты "жартылай жүктелген/бұзылған" күйде
    // ұстап алады (нақты байқалған баг: "Практикалық қолдану" слайды,
    // фон суреті artefact түрде шыққан). img.decode() әр <img> үшін
    // толық decode аяқталғанша күтеді — тек тексеру ғана емес, кепілдік.
    await page.evaluate(async () => {
      const imgs = Array.from(document.querySelectorAll('img'));
      await Promise.all(imgs.map(img => {
        if (img.complete) {
          return img.decode().catch(() => {}); // сурет жоқ/қате болса үнсіз өт
        }
        return new Promise(resolve => {
          img.addEventListener('load', () => img.decode().then(resolve).catch(resolve));
          img.addEventListener('error', resolve);
        });
      }));
    });

    // background-image арқылы қойылған суреттер (CSS background) де бар —
    // оларды браузер decode() арқылы тексере алмайды, сондықтан қосымша
    // кідіріс қосамыз, GPU composite-тің толық аяқталуына кепілдік үшін.
    await new Promise(resolve => setTimeout(resolve, 300));

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
                                           
