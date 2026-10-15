'use strict';
/**
 * Google Gemini API — ортақ REST көмекшілері (SDK жоқ, тек fetch).
 *
 *  - geminiJson(parts, opts)  — мәтін + суреттер (inline base64) → JSON жауап. Суретті «көзбен» таңдау үшін.
 *  - geminiImage(prompt, opts) — мәтіннен сурет жасау (16:9). Жауаптан base64 сурет алынады.
 *
 * Кілт: GOOGLE_API_KEY немесе GEMINI_API_KEY (тек орта айнымалысы; URL-ге емес, x-goog-api-key тақырыбына жазылады —
 * қате логтарында кілт көрінбейді). Кілт жоқ/қате → null (шақырушы резерв жолға өтеді), ешқашан лақтырмайды.
 */
const { recordApiUsage } = require('./cost');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const apiKey = () => process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
const hasGoogleKey = () => !!apiKey();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* json емес жауап */ }
    return { ok: res.ok, status: res.status, data, text };
  } finally {
    clearTimeout(timer);
  }
}

const transient = (st) => st === 429 || st >= 500 || st === 0;

function usageOf(meta) {
  if (!meta) return null;
  return { prompt_tokens: meta.promptTokenCount, completion_tokens: meta.candidatesTokenCount, total_tokens: meta.totalTokenCount };
}

function parseJsonText(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  try { return JSON.parse(t); } catch { /* төменде */ }
  const m = t.match(/[[{][\s\S]*[\]}]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

/**
 * @param {Array<{text:string}|{inline_data:{mime_type:string,data:string}}>} parts
 * @param {{model?:string, label?:string, timeoutMs?:number, tries?:number, maxTokens?:number, temperature?:number}} [opts]
 * @returns {Promise<object|null>}
 */
async function geminiJson(parts, opts = {}) {
  if (!hasGoogleKey() || !Array.isArray(parts) || !parts.length) return null;
  const model = opts.model || process.env.PHOTO_VISION_MODEL || 'gemini-2.5-flash-lite';
  const tries = opts.tries || 2;
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: opts.temperature == null ? 0 : opts.temperature,
      maxOutputTokens: opts.maxTokens || 1500,
      responseMimeType: 'application/json',
    },
  };
  for (let attempt = 0; attempt < tries; attempt++) {
    let r;
    try {
      r = await post(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, body, opts.timeoutMs || 30_000);
    } catch (err) {
      r = { ok: false, status: 0, text: err.message };
    }
    if (r.ok && r.data) {
      recordApiUsage(usageOf(r.data.usageMetadata), { label: opts.label || 'gemini', model });
      const text = (r.data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      const out = parseJsonText(text);
      if (out) return out;
      console.warn(`[Gemini] ${model} returned non-JSON (${String(text).slice(0, 80)})`);
      return null;
    }
    console.warn(`[Gemini] ${model} HTTP ${r.status} ${String(r.text || '').slice(0, 160)}`);
    if (!transient(r.status) || attempt === tries - 1) return null;
    await sleep(1200 * (attempt + 1));
  }
  return null;
}

/** Жауаптың кез келген жерінен base64 суретті табады (interactions және generateContent пішіндері әртүрлі) */
function findImageData(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  const mime = node.mime_type || node.mimeType || '';
  if (typeof node.data === 'string' && node.data.length > 1000 && (/^image\//.test(mime) || node.type === 'image')) {
    return { mime: /^image\//.test(mime) ? mime : 'image/jpeg', data: node.data };
  }
  for (const k of ['inline_data', 'inlineData', 'output_image', 'image']) {
    if (node[k] && typeof node[k] === 'object') {
      const hit = findImageData(node[k], depth + 1);
      if (hit) return hit;
    }
  }
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    if (v && typeof v === 'object') {
      const hit = findImageData(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

let imageShape = null; // 'interactions' | 'generateContent' — қайсысы жұмыс істегені есте сақталады

/**
 * @param {string} prompt
 * @param {{model?:string, aspectRatio?:string, size?:string, timeoutMs?:number, label?:string}} [opts]
 * @returns {Promise<{dataUri:string, model:string}|null>}
 */
async function geminiImage(prompt, opts = {}) {
  if (!hasGoogleKey() || !prompt) return null;
  const model = opts.model || process.env.IMAGE_GEN_MODEL || 'gemini-3.1-flash-lite-image';
  const aspect = opts.aspectRatio || '16:9';
  const timeoutMs = opts.timeoutMs || 60_000;
  const shapes = imageShape ? [imageShape] : ['interactions', 'generateContent'];
  for (const shape of shapes) {
    let r;
    try {
      r = shape === 'interactions'
        ? await post(`${BASE}/interactions`, {
          model, input: prompt,
          response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: aspect, image_size: opts.size || '1K' },
        }, timeoutMs)
        : await post(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
        }, timeoutMs);
    } catch (err) {
      r = { ok: false, status: 0, text: err.message };
    }
    if (r.ok && r.data) {
      const img = findImageData(r.data);
      recordApiUsage(usageOf(r.data.usageMetadata || r.data.usage_metadata), { label: opts.label || 'image:gen', model });
      if (img) {
        imageShape = shape;
        return { dataUri: `data:${img.mime};base64,${img.data}`, model };
      }
      console.warn(`[ImageGen] ${shape}: no image in response`);
      continue;
    }
    console.warn(`[ImageGen] ${shape} HTTP ${r.status} ${String(r.text || '').slice(0, 160)}`);
    if (r.status === 401 || r.status === 403) return null; // кілт/биллинг мәселесі — басқа пішін де көмектеспейді
  }
  return null;
}

module.exports = { geminiJson, geminiImage, hasGoogleKey, findImageData, parseJsonText };
