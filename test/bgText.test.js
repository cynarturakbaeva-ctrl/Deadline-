'use strict';
// PPTX фоны мәтінсіз болуы керек: әр дизайн жүйесінде hideText-тен кейін ешбір сөз суретте қалмайды
// (swiss/journal/atelier-дің кілт сөзі !important стилімен фонда қалып, PPTX-те екі рет шығатын).
const test = require('node:test');
const assert = require('node:assert');
const { build3DPresentationHTML } = require('../products/presentation/html3DBuilder');
const { applyDeckTheme } = require('../products/presentation/deckPolish');
const SYS = require('../products/presentation/design/systems');
const { hideText, textLeaks } = require('../products/presentation/textLayer');

const deck = () => [
  { title: 'Абайдың «толық адам» ұғымы мен әл-Фарабидің «қайырымды қала» идеясы', subtitle: 'Салыстырмалы талдау', bullets: ['Орындаған: Нуркаев М.'], composition: { visualPurpose: 'cover' } },
  { title: 'Әл-Фарабидің «қайырымды қала» идеясы', bullets: ['Бақыт — адамның ең жоғары мақсаты.', 'Әділетті басшы қаланы ақылмен басқарады.', 'Ізгілік қоғамның негізі болады.'] },
  { title: 'Негізгі кезеңдер', bullets: ['1890 — Қара сөздер жазылды', '1920 — Кеңес дәуірі', '1991 — Тәуелсіздік'], composition: { visualPurpose: 'timeline' } },
  { title: 'Абай мен әл-Фараби мұрасы', bullets: ['Білім беру жүйесіне енгізу.', 'Пікірталас алаңдарын ашу.'], composition: { visualPurpose: 'conclusion' } },
];

test('no design system leaves text in the PPTX background picture', { timeout: 120000 }, async (t) => {
  let browser;
  try { browser = await require('../products/presentation/renderer').launchBrowser(require('puppeteer')); } catch (e) { t.skip('Chromium жоқ: ' + e.message); return; }
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    for (const id of Object.keys(SYS.SYSTEMS)) {
      const d = deck();
      applyDeckTheme(d, { seed: 'bgtext', keep: { system: id, mood: SYS.SYSTEMS[id].moods[0] } });
      await page.setContent(build3DPresentationHTML(d, d[0].title, { style: 'academic' }), { waitUntil: 'load' });
      await page.evaluate(() => (window.__qaDone ? window.__qaDone : null));
      const n = await page.evaluate(() => document.querySelectorAll('.slide').length);
      const before = await page.evaluate(textLeaks, 0);
      assert.ok(before.length > 0, `${id}: тексеруші жасырылмаған мәтінді көруі керек`);
      await page.evaluate(hideText, true);
      for (let i = 0; i < n; i++) assert.deepStrictEqual(await page.evaluate(textLeaks, i), [], `${id} слайд ${i + 1}: фонда мәтін қалды`);
      await page.evaluate(hideText, false);
      assert.ok((await page.evaluate(textLeaks, 0)).length > 0, `${id}: hideText(false) мәтінді қайтарады`);
      assert.strictEqual(await page.evaluate(() => document.querySelectorAll('[data-pptx-hidden]').length), 0);
    }
  } finally { await browser.close(); }
});
