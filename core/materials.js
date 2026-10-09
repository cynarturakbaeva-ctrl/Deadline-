'use strict';
/**
 * Материалдарды толық талдау модулі (Mode 2 / Mode 3 үшін).
 *
 * Пайдаланушы берген файлдарды жай filename немесе алғашқы жол бойынша емес,
 * мазмұны бойынша түсінуге тырысады:
 *   TXT   → utf8 мәтін
 *   PDF   → pdf-parse арқылы барлық беттер
 *   DOCX  → zip+XML (word/document.xml, header/footer) — сыртқы пакетсіз
 *   PPTX  → zip+XML, слайдтардың нақты реті бойынша барлық мәтін
 *   PPT   → ескі OLE бинар: UTF-16LE/ASCII жолдарды сығындылау (best-effort)
 *   Сурет → vision API (Anthropic/Gemini) болса сипаттама; болмаса атауы ғана
 *
 * Бәрі қауіпсіз: ешқашан лақтырмайды, сәтсіз болса { kind, text:'', note } қайтарады.
 * Бірнеше файл бір контекст ретінде қарастырылады (materialsToText).
 */

const { readZip } = require('../design-dna/pptxDna');
const { orderedSlides } = require('../design-dna/structure');

const MAX_TEXT = 200_000; // бір файлдан алынатын мәтіннің шегі (токенді үнемдеу)
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

function detectKind(name, buffer) {
  const n = String(name || '').toLowerCase();
  if (IMAGE_EXT.test(n)) return 'image';
  if (/\.pdf$/i.test(n)) return 'pdf';
  if (/\.docx$/i.test(n)) return 'docx';
  if (/\.pptx$/i.test(n)) return 'pptx';
  if (/\.ppt$/i.test(n)) return 'ppt';
  if (/\.doc$/i.test(n)) return 'doc'; // ескі OLE Word — best-effort
  if (/\.txt|\.md|\.rtf|\.csv|\.json|\.log$/i.test(n)) return 'text';
  if (!buffer || !buffer.length) return 'unknown';
  // Магия-байттар бойынша
  if (buffer[0] === 0x25 && buffer[1] === 0x50) return 'pdf';           // %PDF
  if (buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50) {      // ZIP
    const head = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
    if (/\[Content_Types\]\.xml/.test(head) && /word\//.test(head)) return 'docx';
    if (/\[Content_Types\]\.xml/.test(head) && /ppt\//.test(head)) return 'pptx';
    return 'zip';
  }
  if (buffer.length > 8 && buffer.readUInt32LE(0) === 0xE011CFD0) return 'doc'; // OLE
  return 'binary';
}

const norm = (s) => String(s || '').replace(/\r/g, '').trim();

function clip(text, max) {
  let t = String(text || '').replace(/\u0000/g, '');
  t = t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (t.length <= max) return t;
  return t.slice(0, max) + `\n…[${Math.round((max / t.length) * 100)}% көрсетілді]`;
}

// ─── TXT ────────────────────────────────────────────────────────────────────
function textFromBuffer(buf) {
  let t = buf.toString('utf8');
  if (t.includes('\uFFFD') && /[\u0400-\u04FF]/.test(buf.toString('latin1'))) {
    // Windows-1251 болуы мүмкін (кириллица latin1-де оқылады)
    const alt = buf.toString('binary');
    if (/[А-Яа-яЁё]/.test(alt)) t = alt;
  }
  return norm(t);
}

// ─── PDF ────────────────────────────────────────────────────────────────────
async function pdfText(buf) {
  let pdfParse;
  try { pdfParse = require('pdf-parse'); } catch { return { text: '', note: 'pdf-parse жоқ' }; }
  try {
    const data = await pdfParse(buf);
    const pages = Array.isArray(data) ? data : null;
    const text = pages
      ? pages.map((p) => p && p.text).filter(Boolean).join('\n\n')
      : String(data.text || '');
    return { text: norm(text), meta: { pages: pages ? pages.length : (data.numpages || null) } };
  } catch (e) {
    return { text: '', note: 'PDF оқылмады: ' + e.message };
  }
}

// ─── DOCX ───────────────────────────────────────────────────────────────────
function docxText(buf) {
  try {
    const files = readZip(buf);
    const parts = [];
    for (const key of files.keys()) {
      if (/^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(key)) {
        const xml = files.get(key) || '';
        // Параграфтарды бөліп оқу: <w:p ...>...</w:p>
        const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
        for (const p of paras) {
          const runs = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);
          const line = runs.join('').replace(/\s+/g, ' ').trim();
          if (line) parts.push(line);
        }
      }
    }
    if (!parts.length) {
      const xml = files.get('word/document.xml') || '';
      const all = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(' ');
      if (all.trim()) parts.push(all.trim());
    }
    return { text: parts.join('\n'), meta: { xmlParts: [...files.keys()].filter((k) => /^word\//.test(k)).length } };
  } catch (e) {
    return { text: '', note: 'DOCX оқылмады: ' + e.message };
  }
}

// ─── PPTX ───────────────────────────────────────────────────────────────────
function pptxText(buf) {
  try {
    const files = readZip(buf);
    const slides = orderedSlides(files);
    const out = [];
    slides.forEach((key, i) => {
      const xml = files.get(key) || '';
      const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ').replace(/\s+/g, ' ').trim();
      if (texts) out.push(`[Слайд ${i + 1}] ${texts}`);
    });
    if (!out.length) {
      for (const key of files.keys()) {
        if (!/^ppt\/(slides|notesSlides)\//.test(key)) continue;
        const xml = files.get(key) || '';
        const t = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ').trim();
        if (t) out.push(t);
      }
    }
    return { text: out.join('\n'), meta: { slides: slides.length } };
  } catch (e) {
    return { text: '', note: 'PPTX оқылмады: ' + e.message };
  }
}

// ─── PPT / DOC (ескі OLE бинар) ─────────────────────────────────────────────
function oleText(buf) {
  // PowerPoint/Word мәтінді UTF-16LE жүзінде сақтайды. Оқылатын жолдарды жинаймыз.
  try {
    const chunks = [];
    let run = '';
    for (let i = 0; i + 1 < buf.length; i += 2) {
      const code = buf.readUInt16LE(i);
      if (code === 0) { if (run.length >= 4) chunks.push(run); run = ''; continue; }
      if (code >= 0x20 && code !== 0xFFFE && code !== 0xFFFF) run += String.fromCharCode(code);
      else if (run.length >= 4) { chunks.push(run); run = ''; }
    }
    if (run.length >= 4) chunks.push(run);
    const seen = new Set();
    const out = [];
    for (const c of chunks) {
      const s = c.replace(/\s+/g, ' ').trim();
      const low = s.toLowerCase();
      if (s.length < 4 || s.length > 500) continue;
      if (!/[\p{L}\p{N}]/u.test(s)) continue;
      if (seen.has(low)) continue;
      seen.add(low);
      out.push(s);
    }
    return { text: out.join('\n'), meta: { binary: true } };
  } catch {
    return { text: '', note: 'ескі бинар формат оқылмады' };
  }
}

// ─── Сурет (vision) ─────────────────────────────────────────────────────────
function visionAvailable() {
  return !!(process.env.ANTHROPIC_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
}

async function imageAnthropic(b64, name, mime) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.VISION_ANTHROPIC_MODEL || process.env.VISUAL_ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: b64 } },
            { type: 'text', text: 'Describe what this image contains in detail. If it is a document/screenshot/requirements text, transcribe ALL readable text verbatim, then summarize any visual structure (tables, boxes, slide layouts). Respond in the same language as the image content. No preamble.' },
          ],
        }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function imageGemini(b64, mime) {
  const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.VISION_GEMINI_MODEL || 'gemini-2.0-flash';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: mime, data: b64 } },
            { text: 'Describe what this image contains in detail. If it is a document/screenshot/requirements text, transcribe ALL readable text verbatim, then summarize any visual structure. Respond in the same language as the image content. No preamble.' },
          ],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text).join('\n').trim() || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function describeImage(buf, name) {
  const mime = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : /\.gif$/i.test(name) ? 'image/gif' : 'image/jpeg';
  if (!visionAvailable()) return { text: '', note: 'vision API кілті жоқ — сурет мазмұны оқылмады (тек атауы ғана ескеріледі)' };
  const b64 = buf.toString('base64');
  let text = await imageAnthropic(b64, name, mime);
  if (!text) text = await imageGemini(b64, mime);
  return text ? { text, meta: { vision: true } } : { text: '', note: 'сурет сипатталмады' };
}

// ─── Негізгі API ────────────────────────────────────────────────────────────
/**
 * Бір файлды толық талдау.
 * @param {{buffer: Buffer, name: string}} file
 * @returns {Promise<{kind:string, name:string, text:string, preview:string, meta:object, note:string}>}
 */
async function analyzeMaterialFile(file) {
  const name = String(file && file.name || 'file');
  const buf = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer || '');
  const kind = detectKind(name, buf);
  const out = { kind, name, text: '', preview: '', meta: {}, note: '' };
  try {
    if (kind === 'image') {
      if (buf.length > MAX_IMAGE_BYTES) { out.note = 'сурет тым үлкен'; return out; }
      const r = await describeImage(buf, name);
      out.text = r.text || ''; out.note = r.note || ''; out.meta = r.meta || {};
    } else if (kind === 'pdf') {
      const r = await pdfText(buf);
      out.text = r.text || ''; out.note = r.note || ''; out.meta = r.meta || {};
    } else if (kind === 'docx') {
      const r = docxText(buf);
      out.text = r.text || ''; out.note = r.note || ''; out.meta = r.meta || {};
    } else if (kind === 'pptx') {
      const r = pptxText(buf);
      out.text = r.text || ''; out.note = r.note || ''; out.meta = r.meta || {};
    } else if (kind === 'ppt' || kind === 'doc') {
      const r = oleText(buf);
      out.text = r.text || ''; out.note = r.note || 'ескі бинар формат: мәтін best-effort жолмен алынды';
      out.meta = r.meta || {};
    } else if (kind === 'text') {
      const t = textFromBuffer(buf);
      out.text = t;
      if (!t) out.note = 'мәтін табылмады';
    } else {
      out.kind = 'binary';
      out.note = 'бұл файл түрі танылмады немесе мәтін емес';
    }
  } catch (e) {
    out.note = 'талдау қатесі: ' + e.message;
  }
  out.text = clip(out.text, MAX_TEXT);
  out.preview = out.text.slice(0, 300);
  return out;
}

/** Бірнеше файлды бір тапсырма контексті ретінде біріктіреді (бөлек емес). */
function materialsToText(list) {
  const parts = [];
  for (const m of list || []) {
    const head = `===== ФАЙЛ: ${m.name} (${m.kind}) =====`;
    if (m.text && m.text.trim()) parts.push(head + '\n' + m.text.trim());
    else parts.push(head + '\n[мазмұны алынбады' + (m.note ? ': ' + m.note : '') + ']');
  }
  return parts.join('\n\n');
}

module.exports = { analyzeMaterialFile, materialsToText, detectKind, visionAvailable };
