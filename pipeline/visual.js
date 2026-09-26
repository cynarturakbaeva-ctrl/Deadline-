'use strict';

const { recordApiUsage } = require('./cost');

/**
 * Visual stage — кейбір слайдтарға SVG фигура (диаграмма / инфографика / схема-карта) сызу.
 *
 * Қалай жұмыс істейді:
 *   1. DeepSeek слайд мазмұнын жазғанда, СИРЕК слайдқа `visual: {type, brief, data}` қосады.
 *   2. Осы модуль ТЕК сол слайдтарға арнайы бір шақыру жасайды (DeepSeek немесе Claude — env арқылы).
 *   3. Жауап қатаң тазаланады (sanitizeSvg) және мәтін сыятыны тексеріледі (inspectSvg).
 *   4. Сәтті болса — слайдқа `visualSvg` (data: URI) қосылады да, builder "visual" layout-ын қолданады.
 *      Сәтсіз болса — `slide.visual` өшіріледі, слайд қалыпты мәтін-слайд болып қала береді.
 *
 * Ешқашан лақтырмайды: визуал ешқашан бүкіл презентацияны құлатпауы керек.
 *
 * Провайдер (env):
 *   VISUAL_PROVIDER = deepseek (әдепкі) | anthropic
 *   VISUAL_FALLBACK = anthropic | deepseek | (бос) — негізгі сәтсіз болса, бір рет қана
 *   Толық тізім — .env.example
 */

const { slideSvgPalette } = require('./html3DBuilder');

const DEFAULT_VB = { w: 1100, h: 740 };            // builder-дегі .figure өлшемімен бірдей
const TYPES = new Set(['diagram', 'infographic', 'map']);
const ANTHROPIC_VERSION = '2023-06-01';

// ═══════════════════════════════ Config ═══════════════════════════════

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
}
function flag(v, d) {
  if (v == null || String(v).trim() === '') return d;
  return !/^(0|false|no|off)$/i.test(String(v).trim());
}

// Бағалар: $/1M токен. Anthropic — ресми құжаттан (Sonnet 5: $2/$10).
// DeepSeek — peak кезіндегі (қымбат) баға, консервативті есеп үшін.
const PROVIDER_DEFAULTS = {
  deepseek:  { model: 'deepseek-v4-flash', priceIn: 0.30, priceOut: 1.20,  maxTokens: 6000 },
  anthropic: { model: 'claude-sonnet-5',   priceIn: 2.00, priceOut: 10.00, maxTokens: 4500 },
};

function providerConfig(name, env) {
  const d = PROVIDER_DEFAULTS[name];
  if (!d) return null;
  const P = name.toUpperCase();
  return {
    name,
    apiKey: name === 'deepseek' ? (env.DEEPSEEK_API_KEY || '') : (env.ANTHROPIC_API_KEY || ''),
    model: env[`VISUAL_${P}_MODEL`] || d.model,
    priceIn: num(env[`VISUAL_${P}_PRICE_IN`], d.priceIn),
    priceOut: num(env[`VISUAL_${P}_PRICE_OUT`], d.priceOut),
    maxTokens: Math.floor(num(env[`VISUAL_${P}_MAX_TOKENS`], d.maxTokens)),
    // Sonnet 5-те adaptive thinking әдепкіде ҚОСУЛЫ (ресми құжат) — өшірмесек, thinking токендері де ақыланады.
    sendThinkingDisabled: flag(env[`VISUAL_${P}_THINKING_DISABLED`], true),
  };
}

function getConfig(env = process.env) {
  const primaryName = String(env.VISUAL_PROVIDER || 'deepseek').trim().toLowerCase();
  const fallbackName = String(env.VISUAL_FALLBACK || '').trim().toLowerCase();
  const mp = Number(env.VISUAL_MAX_PER_DECK);
  return {
    enabled: flag(env.VISUAL_ENABLED, true),
    mapsEnabled: flag(env.VISUAL_MAPS, true),
    maxPerDeck: Number.isFinite(mp) && mp >= 0 ? Math.floor(mp) : 2,
    budgetTg: num(env.VISUAL_BUDGET_TG, 50),
    usdKzt: num(env.USD_KZT, 470),
    timeoutMs: Math.floor(num(env.VISUAL_TIMEOUT_MS, 120000)),
    estInputTokens: 2600,               // system+user промпт бағасы (қор ретінде)
    primaryName,
    primary: providerConfig(primaryName, env),
    fallback: fallbackName && fallbackName !== primaryName ? providerConfig(fallbackName, env) : null,
  };
}

function costTg(p, inTok, outTok, cfg) {
  return ((inTok * p.priceIn + outTok * p.priceOut) / 1e6) * cfg.usdKzt;
}
function worstCaseTg(p, cfg) {
  return costTg(p, cfg.estInputTokens, p.maxTokens, cfg);
}
// Бір дек ішінде максимум неше визуал: бюджет пен maxPerDeck-тің кішісі
function allowedSlots(cfg) {
  if (cfg.maxPerDeck <= 0 || !cfg.primary) return 0;
  const w = worstCaseTg(cfg.primary, cfg);
  return Math.max(1, Math.min(cfg.maxPerDeck, Math.floor(cfg.budgetTg / w)));
}

// ═══════════════════════════ Spec normalization ═══════════════════════════

function normalizeVisualSpec(v) {
  if (!v || typeof v !== 'object') return null;
  const type = String(v.type || '').toLowerCase().trim();
  if (!TYPES.has(type)) return null;
  const brief = String(v.brief || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  const data = (Array.isArray(v.data) ? v.data : [])
    .map((x) => (x && typeof x === 'object') ? Object.values(x).join(': ') : String(x == null ? '' : x))
    .map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 140))
    .filter(Boolean)
    .slice(0, 8);
  if (data.length < 2) return null;     // мәліметсіз визуал — мағынасыз, әрі модель ойдан толтырады
  return { type, brief, data };
}

// DeepSeek қайтарған слайдтарды тазалау: жарамсыз/қате visual-ды өшіру, мұқабада ешқашан болмайды
function prepareVisuals(slides) {
  (slides || []).forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    if (i === 0) { delete s.visual; return; }
    const n = normalizeVisualSpec(s.visual);
    if (n) s.visual = n; else delete s.visual;
  });
}

// ═══════════════════════════ SVG sanitizer ═══════════════════════════
// Whitelist принципі: белгілі элементтер мен атрибуттарды ғана қайта жинаймыз.
// Қалғаны (script, foreignObject, image, animate, on*, сыртқы href...) — тасталады.
// Нәтиже <img src="data:image/svg+xml"> ішінде көрсетіледі (онда скрипт/желі бәрібір істемейді) —
// бұл қосымша қорғаныс қабаты.

const ALLOWED_TAGS = {
  svg: 'svg', g: 'g', defs: 'defs', lineargradient: 'linearGradient', radialgradient: 'radialGradient',
  stop: 'stop', rect: 'rect', circle: 'circle', ellipse: 'ellipse', line: 'line', polyline: 'polyline',
  polygon: 'polygon', path: 'path', text: 'text', tspan: 'tspan', title: 'title', desc: 'desc',
  marker: 'marker', use: 'use', symbol: 'symbol', clippath: 'clipPath', pattern: 'pattern', style: 'style',
};
const TEXT_HOSTS = new Set(['text', 'tspan', 'title', 'desc', 'style']);

const ATTR_CANON = {
  viewbox: 'viewBox', preserveaspectratio: 'preserveAspectRatio', gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform', patternunits: 'patternUnits', patterntransform: 'patternTransform',
  patterncontentunits: 'patternContentUnits', markerwidth: 'markerWidth', markerheight: 'markerHeight',
  refx: 'refX', refy: 'refY', markerunits: 'markerUnits', clippathunits: 'clipPathUnits',
};
const ALLOWED_ATTRS = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'transform',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'font-family',
  'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline',
  'alignment-baseline', 'text-decoration', 'dx', 'dy', 'id', 'class', 'offset', 'stop-color', 'stop-opacity',
  'gradientunits', 'gradienttransform', 'patternunits', 'patterntransform', 'patterncontentunits', 'viewbox',
  'preserveaspectratio', 'marker-start', 'marker-mid', 'marker-end', 'markerwidth', 'markerheight', 'refx',
  'refy', 'orient', 'markerunits', 'clip-path', 'clippathunits', 'href', 'xlink:href', 'style', 'visibility',
  'display', 'xmlns',
]);
const STYLE_PROPS = new Set([
  'fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'font-weight',
  'font-family', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'text-decoration',
]);
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…',
  laquo: '«', raquo: '»', copy: '©', deg: '°', middot: '·', times: '×', rarr: '→', larr: '←', bull: '•',
};

const TAG_RE = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=\/>"']+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = (e[1] === 'x' || e[1] === 'X') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return (Number.isFinite(cp) && cp > 0 && cp <= 0x10FFFF) ? String.fromCodePoint(cp) : '';
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, e) ? NAMED_ENTITIES[e] : m;
  });
}
function escText(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return escText(s).replace(/"/g, '&quot;'); }

function safeValue(val) {
  if (val.length > 300) return false;
  if (/javascript:|vbscript:|data:|expression\s*\(|@import|[<>{}]/i.test(val)) return false;
  if (/url\s*\(/i.test(val) && !/^url\(\s*['"]?#[\w:.-]+['"]?\s*\)(\s+\S+)?$/i.test(val)) return false;
  return true;
}
function cleanStyleAttr(v) {
  return v.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    if (i < 0) return null;
    const k = d.slice(0, i).trim().toLowerCase();
    const val = d.slice(i + 1).trim();
    if (!STYLE_PROPS.has(k) || !safeValue(val)) return null;
    return `${k}:${val}`;
  }).filter(Boolean).join(';');
}
function safeStyleElement(css) {
  return css.length <= 4000 && !/@|url\s*\(|expression|javascript|<|\\/i.test(css);
}

function cleanAttrs(attrStr, isRoot) {
  const out = [];
  const seen = new Set();
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(attrStr)) !== null) {
    const raw = m[1];
    const val = m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4]);
    if (val == null) continue;
    if (!/^[A-Za-z_:][\w:.-]*$/.test(raw)) continue;
    let lname = raw.toLowerCase();
    if (/^on/.test(lname)) continue;
    if (lname === 'xlink:href') lname = 'href';         // xlink namespace жариялау қажет болмасын
    if (!ALLOWED_ATTRS.has(lname)) continue;
    if (isRoot && (lname === 'width' || lname === 'height' || lname === 'xmlns')) continue;
    if (seen.has(lname)) continue;
    let v = decodeEntities(val).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    const max = (lname === 'd' || lname === 'points') ? 20000 : 1000;
    if (v.length > max) continue;
    if (lname === 'href') { if (!/^#[\w:.-]{1,64}$/.test(v)) continue; }
    else if (lname === 'id') { if (!/^[\w:.-]{1,64}$/.test(v)) continue; }
    else if (lname === 'style') { v = cleanStyleAttr(v); if (!v) continue; }
    else if (!safeValue(v) && lname !== 'd' && lname !== 'points') continue;
    else if ((lname === 'd' || lname === 'points') && /[^0-9eE\s,.\-+MmLlHhVvCcSsQqTtAaZz]/.test(v)) continue;
    seen.add(lname);
    out.push([ATTR_CANON[lname] || lname, v]);
  }
  return out;
}

/** Модель жауабынан таза, қауіпсіз SVG жасайды. Жарамсыз болса null. */
function sanitizeSvg(input) {
  if (typeof input !== 'string' || input.length > 200000) return null;
  let s = input.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
  const start = s.search(/<svg[\s>\/]/i);
  if (start < 0) return null;
  s = s.slice(start)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t) => escText(t));

  const out = [];
  const stack = [];
  let skip = 0;
  let rootDone = false;
  let elements = 0;
  let styleBuf = '';
  let vbW = DEFAULT_VB.w;
  let vbH = DEFAULT_VB.h;
  let pos = 0;
  let m;

  const flushText = (t) => {
    if (skip || !stack.length || !t) return;
    const top = stack[stack.length - 1];
    if (!TEXT_HOSTS.has(top.lname)) return;
    if (top.lname === 'style') { styleBuf += decodeEntities(t); return; }
    const clean = escText(decodeEntities(t));
    if (clean.trim() === '') { if (top.lname === 'text' || top.lname === 'tspan') out.push(' '); return; }
    out.push(clean);
  };
  const closeTop = () => {
    const t = stack.pop();
    if (t.lname === 'style') {
      if (safeStyleElement(styleBuf) && styleBuf.trim()) out.push('<style>' + escText(styleBuf) + '</style>');
      styleBuf = '';
    } else {
      out.push('</' + t.name + '>');
    }
  };

  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(s)) !== null) {
    if (rootDone) break;
    flushText(s.slice(pos, m.index));
    pos = TAG_RE.lastIndex;
    const closing = m[1] === '/';
    const lname = m[2].toLowerCase();
    const attrStr = m[3] || '';
    const selfClose = m[4] === '/';

    if (closing) {
      if (skip) { skip--; continue; }
      let idx = -1;
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].lname === lname) { idx = i; break; }
      if (idx < 0) continue;
      while (stack.length > idx + 1) closeTop();
      closeTop();
      if (!stack.length) rootDone = true;
      continue;
    }

    if (skip) { if (!selfClose) skip++; continue; }
    const canon = ALLOWED_TAGS[lname];
    const isRoot = stack.length === 0;
    if (isRoot && lname !== 'svg') return null;
    if (!canon || (!isRoot && lname === 'svg')) { if (!selfClose) skip = 1; continue; }
    if (++elements > 700) return null;

    const attrs = cleanAttrs(attrStr, isRoot);
    if (isRoot) {
      const vb = attrs.find((a) => a[0] === 'viewBox');
      const nums = vb ? vb[1].split(/[\s,]+/).map(Number) : [];
      if (nums.length === 4 && nums.every(Number.isFinite) && nums[2] > 50 && nums[3] > 50) {
        vbW = nums[2]; vbH = nums[3];
      } else {
        const i = attrs.findIndex((a) => a[0] === 'viewBox');
        if (i >= 0) attrs.splice(i, 1);
        attrs.push(['viewBox', `0 0 ${DEFAULT_VB.w} ${DEFAULT_VB.h}`]);
      }
      attrs.unshift(['xmlns', 'http://www.w3.org/2000/svg']);
    }

    if (lname === 'style') { stack.push({ lname, name: canon }); styleBuf = ''; continue; }
    out.push('<' + canon + attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('') + (selfClose ? '/>' : '>'));
    if (selfClose) { if (isRoot) rootDone = true; } else stack.push({ lname, name: canon });
  }
  if (!out.length) return null;
  while (stack.length) closeTop();

  const svg = out.join('');
  if (svg.length > 60000 || !/^<svg[\s>]/.test(svg) || !/<\/svg>$/.test(svg)) return null;
  return { svg, vbW, vbH, elements };
}

// ═══════════════════════════ Text-fit heuristic ═══════════════════════════
// Браузерсіз шамамен: символ саны × шрифт × 0.62 (DejaVu/Inter аралығы, консервативті).
// Мақсат — көрінеріктей кесілген мәтінді ұстау (модель тар қорапқа ұзын жол жазса).

function attrMap(attrStr) {
  const o = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(attrStr || '')) !== null) {
    const v = m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4]);
    if (v != null) o[m[1].toLowerCase()] = decodeEntities(v);
  }
  return o;
}
function firstNum(v, d) {
  const n = parseFloat(String(v == null ? '' : v).split(/[\s,]+/)[0]);
  return Number.isFinite(n) ? n : d;
}
function fontSizeOf(a) {
  if (a['font-size'] != null) { const n = parseFloat(a['font-size']); if (Number.isFinite(n)) return n; }
  const sm = a.style && a.style.match(/font-size\s*:\s*([\d.]+)/i);
  return sm ? parseFloat(sm[1]) : null;
}

function inspectSvg(svg, vbW = DEFAULT_VB.w, vbH = DEFAULT_VB.h) {
  const FACTOR = 0.62;
  const scale = Math.min(DEFAULT_VB.w / vbW, DEFAULT_VB.h / vbH);
  const ctx = [{ tx: 0, ty: 0, fs: 16, anchor: 'start' }];
  const res = { overflowPx: 0, texts: 0, minFontOnSlide: Infinity, warnings: [], severe: false };
  let cur = null;
  let pos = 0;
  let m;
  TAG_RE.lastIndex = 0;

  const feed = (t) => {
    if (!cur) return;
    const n = decodeEntities(t).replace(/\s+/g, ' ').trim().length;
    if (n) cur.lines[cur.lines.length - 1].chars += n;
  };
  const finish = (c) => {
    for (const ln of c.lines) {
      if (!ln.chars) continue;
      const w = ln.chars * c.fs * FACTOR;
      const x = ln.x + c.tx;
      const left = c.anchor === 'middle' ? x - w / 2 : (c.anchor === 'end' ? x - w : x);
      const right = left + w;
      res.overflowPx = Math.max(res.overflowPx, -left, right - vbW, 0);
      const y = c.y + c.ty;
      if (y > vbH + 10 || y < -10) res.overflowPx = Math.max(res.overflowPx, 120);
    }
    res.texts++;
    res.minFontOnSlide = Math.min(res.minFontOnSlide, c.fs * scale);
  };

  while ((m = TAG_RE.exec(svg)) !== null) {
    feed(svg.slice(pos, m.index));
    pos = TAG_RE.lastIndex;
    const closing = m[1] === '/';
    const lname = m[2].toLowerCase();
    if (closing) {
      if (lname === 'text' && cur) { finish(cur); cur = null; }
      if (ctx.length > 1) ctx.pop();
      continue;
    }
    const a = attrMap(m[3]);
    const selfClose = m[4] === '/';
    const parent = ctx[ctx.length - 1];
    const tr = (a.transform || '').match(/translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/);
    const next = {
      tx: parent.tx + (tr ? parseFloat(tr[1]) : 0),
      ty: parent.ty + (tr && tr[2] ? parseFloat(tr[2]) : 0),
      fs: fontSizeOf(a) || parent.fs,
      anchor: a['text-anchor'] || parent.anchor,
    };
    if (lname === 'text') {
      const x = firstNum(a.x, 0);
      cur = { ...next, x, y: firstNum(a.y, 0), lines: [{ x, chars: 0 }] };
    } else if (lname === 'tspan' && cur) {
      if (a.x != null) cur.lines.push({ x: firstNum(a.x, cur.x), chars: 0 });
      const tfs = fontSizeOf(a);
      if (tfs && tfs > cur.fs) cur.fs = tfs;
      if (a['text-anchor']) cur.anchor = a['text-anchor'];
    }
    if (!selfClose) ctx.push(next);
    else if (lname === 'text' && cur) { finish(cur); cur = null; }
  }

  const tolerance = vbW * 0.01;
  const severeLimit = vbW * 0.08;
  if (res.overflowPx > tolerance) res.warnings.push(`text may overflow by ~${Math.round(res.overflowPx)}px`);
  if (res.overflowPx > severeLimit) res.severe = true;
  if (res.texts && res.minFontOnSlide < 18) res.warnings.push(`small text (~${Math.round(res.minFontOnSlide)}px on slide)`);
  if (!res.texts) res.warnings.push('no text labels');
  if (!Number.isFinite(res.minFontOnSlide)) res.minFontOnSlide = 0;
  return res;
}

function toDataUri(svg) {
  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

// ═══════════════════════════════ Prompt ═══════════════════════════════

const SYSTEM_PROMPT = `You draw ONE self-contained SVG figure for a presentation slide. Reply with the <svg>…</svg> markup ONLY — no markdown fences, no comments, no explanation.

CANVAS
- Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1100 740"> — no width/height attributes.
- The slide already provides the panel background. Do NOT draw a full-canvas background rectangle.
- Keep 40px margins: everything inside x 40..1060 and y 40..700. The slide has its own title, so do not add a figure title.

TEXT (the most common failure — be strict)
- font-family="Inter, 'Segoe UI', 'Noto Sans', Arial, sans-serif".
- Font sizes: labels 24 or more, secondary 22 or more, key numbers 44-72. Never below 22.
- The text width in the viewer can be up to: characters × font-size × 0.65. Check EVERY label against its box or bar with 14px padding on each side. If it does not fit: shorten it or break it into several lines.
- Break lines with separate <text> elements or <tspan x="…" dy="…">. Max 3 lines per label, max about 14 characters per line at size 24 inside a 200px-wide box.
- Centered labels: text-anchor="middle" and x = the exact center of the box.
- Write text in the language of DATA exactly as given. Do not translate. Do not add words that are not in DATA.

CONTENT
- Semantic relationships must be obvious at a glance: clear arrow direction, hierarchy top→bottom or left→right, equal spacing, no overlapping nodes or labels.
- Complexity must match DATA size: 3 parts → simple 3 nodes; never add decorative boxes without labels from DATA.
- Use ONLY the facts, names and numbers in DATA. NEVER invent numbers, dates, percentages or names. If DATA has no numbers, draw a qualitative diagram without axis values.
- Charts: bar lengths/heights must be proportional to the given numbers; label every bar with its value.
- diagram: 3-6 boxes or nodes with clear arrows (use simple <path> arrows or <line> + small <polygon> heads), evenly spaced, no overlaps.
- infographic: one dominant element (a big number or a bar set) plus 2-4 supporting facts.
- map: a SIMPLIFIED SCHEMATIC only — rough region blobs, dots for places, labeled routes. Never try exact borders or coastlines. Add the given CAPTION as small text (size 22) at the bottom-left.

STYLE
- Flat, clean, high contrast. Use ONLY the PALETTE colors (opacity via fill-opacity / stroke-opacity is allowed). Use the accent color for the single most important element.
- Rounded rectangles (rx 16), stroke-width 2-3, consistent spacing, aligned edges, no overlapping shapes or labels.
- Forbidden: <script>, <style>, <foreignObject>, <image>, filters, masks, external links or fonts, animations.
- Keep the whole SVG under 9000 characters: simple shapes, no detailed paths. At most 3 tiny icons made of basic shapes.

EXAMPLE of a correct labeled box (200px wide, centered text, two lines):
<rect x="80" y="120" width="200" height="110" rx="16" fill="#131519" stroke="#3a3c40" stroke-width="2"/>
<text x="180" y="168" text-anchor="middle" font-size="24" font-weight="700" fill="#f5f7fb">Ерте жылдар</text>
<text x="180" y="200" text-anchor="middle" font-size="22" fill="#909296">356–336</text>`;

function captionFor(texts) {
  const t = texts.join(' ');
  if (/[әғқңөұүһі]/i.test(t)) return 'Сызба, масштабсыз';
  if (/[а-яё]/i.test(t)) return 'Схема, без масштаба';
  return 'Schematic, not to scale';
}

function buildPrompt(slide, palette) {
  const spec = slide.visual;
  const caption = spec.type === 'map' ? captionFor([slide.title || '', ...spec.data]) : null;
  const user = [
    `TYPE: ${spec.type}`,
    `PALETTE: ${JSON.stringify(palette)}`,
    `SLIDE TITLE (context only, do not draw it): ${String(slide.title || '').slice(0, 120)}`,
    `BRIEF: ${spec.brief || '(none — choose the clearest simple layout)'}`,
    'DATA (the only facts you may use):',
    ...spec.data.map((d, i) => `${i + 1}. ${d}`),
    caption ? `CAPTION: ${caption}` : '',
  ].filter(Boolean).join('\n');
  return { system: SYSTEM_PROMPT, user };
}

// ═══════════════════════════════ HTTP / providers ═══════════════════════════════

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(url, headers, body, cfg, fetchImpl) {
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
    try {
      const res = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
      if (res.ok) return await res.json();
      const text = String(await res.text().catch(() => '')).slice(0, 300);
      const err = new Error(`HTTP ${res.status}: ${text}`);
      err.status = res.status;
      if ([429, 500, 502, 503, 504, 529].includes(res.status) && attempt < 2) {
        lastErr = err;
        const ra = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
        await sleep(Math.min(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1500, 8000));
        continue;
      }
      throw err;
    } catch (e) {
      if (e.name === 'AbortError') {
        const t = new Error(`timeout after ${cfg.timeoutMs}ms`);
        t.status = 'timeout';                 // қайталамаймыз: сұраныс ақыланып қойған болуы мүмкін
        throw t;
      }
      if (e.status) throw e;
      if (attempt < 2) { lastErr = e; await sleep(1500); continue; }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function callProvider(p, system, user, cfg, fetchImpl) {
  if (p.name === 'deepseek') {
    // Формат — gemini.js-тегі жұмыс істеп тұрған шақырумен бірдей (thinking өшірулі)
    const data = await httpJson(
      'https://api.deepseek.com/v1/chat/completions',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      {
        model: p.model,
        ...(p.sendThinkingDisabled ? { thinking: { type: 'disabled' } } : {}),
        max_tokens: p.maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      },
      cfg, fetchImpl
    );
    const ch = data.choices && data.choices[0];
    recordApiUsage(data.usage || null, { label: 'visual:deepseek', model: p.model });
    return {
      text: (ch && ch.message && ch.message.content) || '',
      stop: ch && ch.finish_reason === 'length' ? 'length' : 'ok',
      inTok: (data.usage && data.usage.prompt_tokens) || 0,
      outTok: (data.usage && data.usage.completion_tokens) || 0,
    };
  }
  // anthropic — temperature/top_p жібермейміз (Sonnet 5-те әдепкіден өзге мән 400 қатесін береді)
  const data = await httpJson(
    'https://api.anthropic.com/v1/messages',
    { 'content-type': 'application/json', 'x-api-key': p.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    {
      model: p.model,
      max_tokens: p.maxTokens,
      ...(p.sendThinkingDisabled ? { thinking: { type: 'disabled' } } : {}),
      system,
      messages: [{ role: 'user', content: user }],
    },
    cfg, fetchImpl
  );
  recordApiUsage(data.usage || null, { label: 'visual:anthropic', model: p.model });
  return {
    text: (data.content || []).filter((b) => b && b.type === 'text').map((b) => b.text).join('\n'),
    stop: data.stop_reason === 'max_tokens' ? 'length' : (data.stop_reason === 'refusal' ? 'refusal' : 'ok'),
    inTok: (data.usage && data.usage.input_tokens) || 0,
    outTok: (data.usage && data.usage.output_tokens) || 0,
  };
}

// ═══════════════════════════════ Circuit breaker ═══════════════════════════════
// Кілт жарамсыз / баланс бітсе, әр дек бос қате шақырып отырмасын.
const breaker = { fails: 0, openUntil: 0 };
function _resetBreaker() { breaker.fails = 0; breaker.openUntil = 0; }
function noteFailure(err) {
  if (err && [400, 401, 403].includes(err.status)) {
    breaker.fails++;
    if (breaker.fails >= 3) {
      breaker.openUntil = Date.now() + 10 * 60 * 1000;
      breaker.fails = 0;
      console.warn('[Visual] 3 қатарынан auth/billing қатесі — 10 минутқа тоқтатылды');
    }
  }
}
function noteSuccess() { breaker.fails = 0; }

// ═══════════════════════════════ One visual ═══════════════════════════════

async function runProvider(p, slide, palette, cfg, fetchImpl) {
  const started = Date.now();
  const r = { provider: p.name, ok: false, reason: '', inTok: 0, outTok: 0, costTg: 0, ms: 0, warnings: [] };
  try {
    const { system, user } = buildPrompt(slide, palette);
    const resp = await callProvider(p, system, user, cfg, fetchImpl);
    r.inTok = resp.inTok;
    r.outTok = resp.outTok;
    r.costTg = costTg(p, resp.inTok, resp.outTok, cfg);
    noteSuccess();
    if (resp.stop === 'refusal') { r.reason = 'model refused'; return r; }
    if (resp.stop === 'length') { r.reason = `truncated at max_tokens (${p.maxTokens})`; return r; }
    const clean = sanitizeSvg(resp.text);
    if (!clean) { r.reason = 'no valid SVG in response'; return r; }
    const q = inspectSvg(clean.svg, clean.vbW, clean.vbH);
    r.warnings = q.warnings;
    if (q.severe) { r.reason = `text overflow ~${Math.round(q.overflowPx)}px`; return r; }
    r.ok = true;
    r.svg = clean.svg;
    r.dataUri = toDataUri(clean.svg);
    return r;
  } catch (e) {
    r.reason = e.message || String(e);
    noteFailure(e);
    return r;
  } finally {
    r.ms = Date.now() - started;
  }
}

// ═══════════════════════════════ Deck-level ═══════════════════════════════

/**
 * slides ішінде visual белгісі бар слайдтарға SVG сызады (ең көбі cfg.maxPerDeck, бюджет шегінде).
 * Мутация жасайды: сәтті → slide.visualSvg; сәтсіз/шектен тыс → slide.visual өшіріледі.
 * Ешқашан лақтырмайды. Есеп (stats) қайтарады.
 */
async function attachVisuals(slides, opts = {}) {
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const cfg = opts.config || getConfig(env);
  const stats = { requested: 0, attempted: 0, ok: 0, failed: 0, costTg: 0, provider: cfg.primaryName, results: [] };

  try {
    prepareVisuals(slides);
    const cand = slides.map((s, i) => ({ s, i })).filter((x) => x.s && x.s.visual);
    stats.requested = cand.length;
    if (!cand.length) return stats;

    const dropAll = (why) => {
      cand.forEach(({ s }) => { delete s.visual; });
      console.log(`[Visual] өткізілді: ${why}`);
      return stats;
    };
    if (!cfg.enabled) return dropAll('VISUAL_ENABLED=0');
    if (!cfg.primary) return dropAll(`белгісіз провайдер "${cfg.primaryName}"`);
    if (!cfg.primary.apiKey) return dropAll(`${cfg.primary.name} API кілті жоқ`);
    if (typeof fetchImpl !== 'function') return dropAll('fetch қолжетімсіз (Node 18+ керек)');
    if (Date.now() < breaker.openUntil) return dropAll('circuit breaker ашық');

    const slots = allowedSlots(cfg);
    const eligible = cand.filter(({ s }) => cfg.mapsEnabled || s.visual.type !== 'map');
    const chosen = eligible.slice(0, slots);
    cand.filter((c) => !chosen.includes(c)).forEach(({ s }) => { delete s.visual; });

    // Дек бюджеті: in-flight сұраныстардың ең жаман шығыны резервтеледі
    const budget = { spent: 0, reserved: 0 };
    const fbUsable = cfg.fallback && cfg.fallback.apiKey;

    await Promise.all(chosen.map(async ({ s, i }) => {
      const vtype = s.visual.type;
      const palette = slideSvgPaletteSafe(s);
      const worst = worstCaseTg(cfg.primary, cfg);
      budget.reserved += worst;
      let r = await runProvider(cfg.primary, s, palette, cfg, fetchImpl);
      budget.reserved -= worst;
      budget.spent += r.costTg;
      stats.attempted++;
      const attempts = [r];

      if (!r.ok && fbUsable) {
        const fw = worstCaseTg(cfg.fallback, cfg);
        if (budget.spent + budget.reserved + fw <= cfg.budgetTg) {
          budget.reserved += fw;
          const r2 = await runProvider(cfg.fallback, s, palette, cfg, fetchImpl);
          budget.reserved -= fw;
          budget.spent += r2.costTg;
          attempts.push(r2);
          r = r2;
        } else {
          console.log(`[Visual] слайд ${i + 1}: fallback өткізілді (бюджет ${cfg.budgetTg} тг)`);
        }
      }

      const cost = attempts.reduce((a, x) => a + x.costTg, 0);
      if (r.ok) {
        s.visualSvg = r.dataUri;
        stats.ok++;
      } else {
        delete s.visual;
        stats.failed++;
      }
      stats.results.push({
        slide: i + 1, ok: r.ok, provider: r.provider, reason: r.reason || undefined,
        inTok: attempts.reduce((a, x) => a + x.inTok, 0),
        outTok: attempts.reduce((a, x) => a + x.outTok, 0),
        costTg: Math.round(cost * 10) / 10, ms: attempts.reduce((a, x) => a + x.ms, 0),
        warnings: r.warnings && r.warnings.length ? r.warnings : undefined,
      });
      console.log(
        `[Visual] слайд ${i + 1} (${vtype}) ${r.ok ? '✅' : '❌ ' + r.reason} ` +
        `${r.provider}: ${attempts.reduce((a, x) => a + x.inTok, 0)}→${attempts.reduce((a, x) => a + x.outTok, 0)} tok, ` +
        `~${cost.toFixed(1)} тг, ${((attempts.reduce((a, x) => a + x.ms, 0)) / 1000).toFixed(1)}с` +
        (r.warnings && r.warnings.length ? ` ⚠ ${r.warnings.join('; ')}` : '')
      );
    }));

    stats.costTg = Math.round(budget.spent * 10) / 10;
    console.log(`[Visual] жиыны: ${stats.ok}/${stats.attempted} сәтті, ~${stats.costTg} тг`);
  } catch (err) {
    // Мұнда ешнәрсе лақтырылмауы керек, бірақ визуал ешқашан пайплайнды құлатпасын
    console.warn(`[Visual] күтпеген қате: ${err.message}`);
    (slides || []).forEach((s) => { if (s && !s.visualSvg) delete s.visual; });
  }
  return stats;
}

/** Бір слайдқа бір провайдермен сызып көру (салыстыру скрипті үшін). Ешқашан лақтырмайды. */
async function drawOnce(slide, providerName, opts = {}) {
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const cfg = opts.config || getConfig(env);
  const p = providerConfig(String(providerName).toLowerCase(), env);
  if (!p) return { ok: false, provider: providerName, reason: 'белгісіз провайдер', costTg: 0, inTok: 0, outTok: 0, ms: 0, warnings: [] };
  if (!p.apiKey) return { ok: false, provider: p.name, reason: `${p.name} API кілті жоқ`, costTg: 0, inTok: 0, outTok: 0, ms: 0, warnings: [] };
  const spec = normalizeVisualSpec(slide.visual);
  if (!spec) return { ok: false, provider: p.name, reason: 'жарамсыз visual spec', costTg: 0, inTok: 0, outTok: 0, ms: 0, warnings: [] };
  return runProvider(p, { ...slide, visual: spec }, slideSvgPaletteSafe(slide), cfg, fetchImpl);
}

function slideSvgPaletteSafe(slide) {
  try { return slideSvgPalette(slide); } catch { return slideSvgPalette({}); }
}

module.exports = {
  attachVisuals, drawOnce, prepareVisuals, normalizeVisualSpec, sanitizeSvg, inspectSvg, buildPrompt,
  getConfig, costTg, worstCaseTg, allowedSlots, _resetBreaker,
};
