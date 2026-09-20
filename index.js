'use strict';

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { generateSlides, reviewAndImproveSlides, parseUserInput } = require('./pipeline/gemini');
const { fetchImage }              = require('./pipeline/unsplash');
const { build3DPresentationHTML } = require('./pipeline/html3DBuilder');
const { renderHtmlToPngs }        = require('./pipeline/renderer');
const { exportToPptx }            = require('./pipeline/pptxExporter');

// Query-ді жалпылама етіп қысқарту
function simplifyQuery(query) {
  const words = query.split(/[\s,]+/).filter(w => w.length > 3);
  return words.slice(0, 4).join(' ');
}

// Толық brief емес, тек қысқа кілт сөз (толық brief Unsplash-та 414 қатесін береді)
function shortTopicKeyword(topic) {
  if (!topic || typeof topic !== 'string') return '';
  const quoted = topic.match(/[«"“]([^»"”']{4,60})[»"”']/);
  if (quoted) return quoted[1].trim();
  const line = topic.split(/[\n\r]+/).map(s => s.trim()).find(s =>
    s.length >= 4 && s.length <= 80 &&
    !/^\d+-?слайд/i.test(s) && !/Тексерген|Орындаған|Топ:/i.test(s)
  );
  if (line) return line.replace(/^Тақырып\s*[:：]\s*/i, '').slice(0, 60);
  return topic.slice(0, 40);
}

async function fetchImageWithFallback(query, topic) {
  let url = await fetchImage(query);
  if (url) return url;

  const simple = simplifyQuery(query);
  if (simple && simple !== query) {
    console.log(`[Image] retry with simplified: "${simple}"`);
    url = await fetchImage(simple);
    if (url) return url;
  }

  const kw = shortTopicKeyword(topic);
  if (kw && kw.length >= 3) {
    console.log(`[Image] retry with topic keyword: "${kw}"`);
    url = await fetchImage(kw + ' historical cinematic');
    if (url) return url;
  }
  return null;
}

/**
 * Pipeline:
 *   тақырып → мазмұн (LLM) → QC → суреттер → HTML (DeadLine Motion, шындық көзі)
 *                                                │
 *                                                ├─► HTML файл  (пайдаланушыға)
 *                                                └─► Puppeteer → PNG → PPTX
 *
 * PPTX — HTML-дің өзінен рендерленеді, сондықтан екеуі бірдей.
 */
async function generatePresentation(userInput) {
  const { topic, slideCount, language, style, coverMeta } = parseUserInput(userInput);

  console.log(`[Pipeline] Topic: ${topic}`);
  if (slideCount) console.log(`[Pipeline] Slides: ${slideCount}`);
  if (language)   console.log(`[Pipeline] Language: ${language}`);
  if (style)      console.log(`[Pipeline] Style: ${style}`);
  if (coverMeta && (coverMeta.checkedBy || coverMeta.performedBy || coverMeta.group)) {
    console.log('[Pipeline] Cover meta:', coverMeta);
  }

  // 1. Мазмұн генерациясы
  console.log('[Pipeline] Generating content...');
  const presentation = await generateSlides(topic, {
    slideCount, language, style, clientBrief: userInput, coverMeta,
  });
  console.log(`[Pipeline] ${presentation.slides.length} slides generated`);

  // 2. Визуалды QC
  console.log('[Pipeline] Running visual QC...');
  const reviewed = await reviewAndImproveSlides(presentation);
  const { slides, title } = reviewed;
  slides.forEach((slide, i) => { slide.index = i + 1; });

  // 3. Суреттер
  console.log('[Pipeline] Fetching images...');
  for (const slide of slides) {
    const query = typeof slide.imageQuery === 'string' ? slide.imageQuery : '';
    console.log(`[Image] query="${query}"`);
    const imageUrl = await fetchImageWithFallback(query, topic);
    slide.webImageUrl = imageUrl || '';
  }

  // 4. HTML презентация — БІРІНШІ жасалады және жалғыз шындық көзі
  console.log('[Pipeline] Building HTML presentation...');
  const stamp    = Date.now();
  const htmlPath = path.join(os.tmpdir(), `presentation-${stamp}.html`);
  fs.writeFileSync(htmlPath, build3DPresentationHTML(slides, title), 'utf8');

  // 5. PPTX — сол HTML файлдан рендерленеді
  console.log('[Pipeline] Rendering HTML → PNG → PPTX...');
  let pngPaths = [];
  let tmpDir   = null;
  let pptxPath;
  try {
    ({ pngPaths, tmpDir } = await renderHtmlToPngs(htmlPath));
    pptxPath = await exportToPptx(pngPaths, title, slides);
  } catch (err) {
    // PPTX құрылмаса, HTML-ді де жібермейміз — қате ретінде қайтарамыз,
    // бот кредитті қайтарады. Уақытша HTML-ді тазалаймыз.
    try { fs.unlinkSync(htmlPath); } catch {}
    throw err;
  } finally {
    try {
      for (const p of pngPaths) fs.unlinkSync(p);
      if (tmpDir) fs.rmdirSync(tmpDir);
    } catch {}
  }

  console.log(`[Pipeline] Done: ${pptxPath} + ${htmlPath}`);
  return { pptxPath, htmlPath, title };
}

module.exports = { generatePresentation };
