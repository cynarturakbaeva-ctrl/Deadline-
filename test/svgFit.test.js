'use strict';
// Сызбадағы жазу өз пішінінен шықпайды: «Ортақ құндылықтар» таблеткасы (Абай/әл-Фараби слайды)
const test = require('node:test');
const assert = require('node:assert');
const { fitSvgLabels } = require('../products/presentation/svgFit');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
<rect x="0" y="0" width="800" height="450" fill="#eef"/>
<circle cx="300" cy="180" r="120" fill="#cde"/><circle cx="500" cy="180" r="120" fill="#cde"/>
<text x="300" y="150" text-anchor="middle" font-size="22" font-family="sans-serif">Абай</text>
<rect x="355" y="215" width="90" height="50" rx="8" fill="#1e8a5a"/>
<text x="400" y="235" text-anchor="middle" font-size="16" font-weight="700" font-family="sans-serif" fill="#fff"><tspan x="400">Ортақ</tspan><tspan x="400" dy="1.2em">құндылықтар</tspan></text>
</svg>`;
const html = `<!doctype html><body><figure class="figure"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"></figure></body>`;

test('label wider than its pill is shrunk to fit; labels that fit are untouched', { timeout: 60000 }, async (t) => {
  let browser;
  try { browser = await require('../products/presentation/renderer').launchBrowser(require('puppeteer')); } catch (e) { t.skip('Chromium жоқ: ' + e.message); return; }
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const rep = await page.evaluate(fitSvgLabels);
    assert.deepStrictEqual(rep, [{ figure: 0, labels: 1 }]);
    const out = await page.evaluate(() => atob(document.querySelector('.figure img').src.split(',')[1]));
    const m = Buffer.from(out, 'latin1').toString('utf8');
    assert.match(m, /font-size: ?1[0-5]\.\d+px/, 'таблетка жазуы кішірейді');
    assert.ok(/Абай<\/text>/.test(m) && !/font-size: ?2[01]/.test(m), 'сыйып тұрған жазу өзгермеді');
    // қайта тексергенде бәрі сыяды
    assert.deepStrictEqual(await page.evaluate(fitSvgLabels), []);
  } finally { await browser.close(); }
});
