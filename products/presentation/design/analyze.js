'use strict';
/**
 * CONTENT ANALYSIS → SLIDE TYPE CLASSIFICATION → LAYOUT SELECTION → DECK RHYTHM.
 * Pure functions, no rendering. Works on the existing slide schema
 * (title/subtitle/body/bullets/stats/table/visualSvg/composition/webImageUrl).
 */

const words = (s) => String(s || '').trim().split(/\s+/).filter(Boolean);
const wc = (s) => words(s).length;

function isVisualSvg(u) {
  return typeof u === 'string' && u.length < 400000 && /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(u);
}

/** "Label: detail" → { label, detail }. Falls back to label only. */
function splitLabelDetail(text) {
  const s = String(text == null ? '' : text);
  const idx = s.indexOf(':');
  if (idx > 0 && idx < 42) return { label: s.slice(0, idx).trim(), detail: s.slice(idx + 1).trim() };
  return { label: s.trim(), detail: '' };
}
function toNode(raw) {
  if (raw && typeof raw === 'object') {
    return {
      label: String(raw.label || raw.date || raw.title || raw.year || ''),
      detail: String(raw.detail || raw.text || raw.description || ''),
    };
  }
  const sp = splitLabelDetail(raw);
  if (sp.detail) return sp;
  // "Label — detail" (no colon): split on the first spaced dash so steps get a short heading + a description
  const m = String(raw == null ? '' : raw).match(/^(.{4,48}?)\s+[—–-]\s+(.{6,})$/);
  return m ? { label: m[1].trim(), detail: m[2].trim() } : sp;
}
function truncate(text, maxLen) {
  const s = String(text || '');
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const sp = cut.lastIndexOf(' ');
  return (sp > maxLen * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:–—-]+$/, '') + '…';
}

/** Numeric value that is safe to count-up (dates, ranges, centuries are NOT). */
function parseStatNumber(v) {
  if (v == null) return null;
  const raw = String(v);
  const s = raw.replace(/\s/g, '');
  if (/до\s*н\.?\s*э|н\.?\s*э\.?|б\.?\s*з\.?\s*д|\bг\.?$|BC|AD|CE|century|век|ғасыр/i.test(raw)) return null;
  if (/^\D*\d{3,4}\s*(год|г\.?|жыл)\b/i.test(raw)) return null;
  if (/\d\s*[–—-]\s*\d/.test(raw)) return null;
  const m = s.match(/-?[\d]+([.,]\d+)?/);
  const n = m ? parseFloat(m[0].replace(',', '.')) : null;
  if (n != null && n >= 1000 && n <= 2100 && /^\D*\d{4}\D*$/.test(s)) return null;
  return n;
}

// ── Image metadata (aspect ratio without decoding the whole file) ──────────
function imageMeta(url) {
  const out = { has: !!url, w: 0, h: 0, aspect: 0, orientation: 'unknown' };
  if (!url || typeof url !== 'string') return out;
  const m = url.match(/^data:image\/(png|jpe?g|webp|gif);base64,([A-Za-z0-9+/=]+)/i);
  if (!m) return out;
  try {
    const buf = Buffer.from(m[2].slice(0, 200000), 'base64');
    const kind = m[1].toLowerCase();
    if (kind === 'png' && buf.length > 24) {
      out.w = buf.readUInt32BE(16); out.h = buf.readUInt32BE(20);
    } else if (kind === 'gif' && buf.length > 10) {
      out.w = buf.readUInt16LE(6); out.h = buf.readUInt16LE(8);
    } else if (kind.startsWith('jp')) {
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const mk = buf[i + 1];
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
          out.h = buf.readUInt16BE(i + 5); out.w = buf.readUInt16BE(i + 7); break;
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    } else if (kind === 'webp' && buf.length > 30) {
      const fmt = buf.toString('ascii', 12, 16);
      if (fmt === 'VP8X') { out.w = 1 + buf.readUIntLE(24, 3); out.h = 1 + buf.readUIntLE(27, 3); }
      else if (fmt === 'VP8 ') { out.w = buf.readUInt16LE(26) & 0x3fff; out.h = buf.readUInt16LE(28) & 0x3fff; }
      else if (fmt === 'VP8L') {
        const b = buf.readUInt32LE(21);
        out.w = (b & 0x3fff) + 1; out.h = ((b >> 14) & 0x3fff) + 1;
      }
    }
  } catch (e) { /* unknown stays unknown */ }
  if (out.w > 0 && out.h > 0) {
    out.aspect = out.w / out.h;
    out.orientation = out.aspect > 1.2 ? 'landscape' : out.aspect < 0.85 ? 'portrait' : 'square';
  }
  return out;
}

const RE = {
  conclusion: /қорытынды|conclusion|резюме|takeaway|итог|заключен|summary/i,
  references: /әдебиет|reference|пайдаланылған|библиограф|литератур|источник|sources/i,
  section: /^(бөлім|тарау|раздел|глава|part|section|chapter)\b/i,
};

/**
 * Analyse ONE slide → facts the layout engine reasons about.
 */
function analyzeSlide(slide, index, total) {
  const s = slide || {};
  const c = s.composition || {};
  const bullets = (Array.isArray(s.bullets) ? s.bullets : []).filter((b) => b && String(b).trim());
  const stats = (Array.isArray(s.stats) ? s.stats : []).filter((x) => x && x.value != null && String(x.value).trim());
  const table = s.table && (Array.isArray(s.table.headers) || Array.isArray(s.table.rows)) ? s.table : null;
  const hasTable = !!(table && ((table.headers || []).length || (table.rows || []).length));
  const body = String(s.body || '').trim();
  const title = String(s.title || '').trim();
  const subtitle = String(s.subtitle || '').trim();
  const photoUrl = s.webImageUrl || s.imageUrl || s.image || '';
  const img = imageMeta(photoUrl);
  const purpose = String(c.visualPurpose || '').toLowerCase();

  const timelineNodes = (Array.isArray(s.timeline) ? s.timeline : null);
  const stepNodes = (Array.isArray(s.steps) ? s.steps : null);
  const hierNodes = (Array.isArray(s.hierarchy) ? s.hierarchy : null);
  const nodeSrc = (arr) => (arr && arr.length ? arr : bullets);
  const labeled = bullets.filter((b) => splitLabelDetail(b).detail).length;
  const dated = bullets.filter((b) => /^\s*(\d{3,4}|[IVX]+\s*(ғ|в)|\d{1,2}[.\/]\d{1,2}|(q[1-4]|қаңтар|ақпан|наурыз|сәуір|мамыр|маусым|шілде|тамыз|қыркүйек|қазан|қараша|желтоқсан))/i.test(splitLabelDetail(b).label)).length;

  const bulletWords = bullets.reduce((n, b) => n + wc(b), 0);
  const bodyWords = wc(body);
  const textWords = wc(title) + wc(subtitle) + bodyWords + bulletWords;
  const isFirst = index === 0;
  const isLast = index === total - 1 && total > 2;

  return {
    index, total, isFirst, isLast,
    title, subtitle, body, bullets, stats, table: hasTable ? table : null, hasTable,
    bulletWords, bodyWords, textWords, labeled, dated,
    longestBullet: bullets.reduce((m, b) => Math.max(m, String(b).length), 0),
    hasVisual: isVisualSvg(s.visualSvg),
    photo: photoUrl, img, hasPhoto: !!photoUrl,
    purpose,
    nodes: { timeline: nodeSrc(timelineNodes), steps: nodeSrc(stepNodes), hierarchy: nodeSrc(hierNodes) },
    explicit: {
      timeline: !!(timelineNodes && timelineNodes.length), steps: !!(stepNodes && stepNodes.length),
      hierarchy: !!(hierNodes && hierNodes.length),
    },
    isConclusion: purpose === 'conclusion' || RE.conclusion.test(title),
    isReferences: RE.references.test(title),
    isQuoteSlide: c.layout === 'quote_hero' || purpose === 'quote',
    isSectionLike: purpose === 'section' || RE.section.test(title),
    wantsBigStat: c.layout === 'big_stat_hero',
    mood: c.mood, accent: c.accentColor, overlayHint: c.overlay || '',
    imageHint: c.image || '', positionHint: c.textPosition || '',
    focus: typeof s.imageFocus === 'string' ? s.imageFocus : (typeof c.imageFocus === 'string' ? c.imageFocus : ''),
  };
}

/**
 * Slide type classification. Order = priority. Returns a semantic type; the
 * layout name is derived from it (a type can have several layout variants).
 */
function classify(a) {
  const nodeCount = (k) => a.nodes[k].length;
  if (a.isFirst) return 'cover';
  if (a.isReferences) return 'references';
  if (a.isQuoteSlide && !a.bullets.length && !a.stats.length) return 'quote';
  if (a.hasVisual) return 'diagram';
  if (a.hasTable) return 'comparison';
  if (a.stats.length === 1 && !a.bullets.length && !a.body && !a.hasTable) return 'number';
  if (a.stats.length >= 2) return 'stats';
  if (a.isConclusion || (a.isLast && a.bullets.length >= 2 && /conclusion|synthesis/.test(a.purpose))) return 'conclusion';
  if (a.isSectionLike && !a.bullets.length && !a.stats.length && a.bodyWords < 12) return 'section';

  const ok = (k) => nodeCount(k) >= 2 && nodeCount(k) <= 6;
  const tl = a.purpose === 'timeline' || a.explicit.timeline || (a.dated >= 3 && a.dated >= a.bullets.length - 1);
  if (tl && ok('timeline')) return 'timeline';
  const pr = a.purpose === 'process' || a.explicit.steps;
  if (pr && ok('steps') && a.bodyWords < 40) return 'process';
  const hi = a.purpose === 'hierarchy' || a.explicit.hierarchy;
  if (hi && ok('hierarchy')) return 'hierarchy';

  // Only a title (and maybe one line) → divider / statement
  if (!a.bullets.length && !a.body && !a.stats.length) {
    if (a.hasPhoto) return 'image_focus';
    return a.purpose === 'section' ? 'section' : 'statement';
  }
  // Photo carries the slide, text is minimal
  if (a.hasPhoto && a.textWords <= 26 && a.bullets.length <= 1) return 'image_focus';
  // Heavy prose → editorial reading layout
  if (a.bodyWords >= 28 && a.bullets.length <= 2) return 'editorial';
  // Short definition-like slide without bullets
  if (!a.bullets.length && a.bodyWords > 0 && a.bodyWords < 28) return a.hasPhoto ? 'split' : 'statement';
  // Photo + text
  if (a.hasPhoto && a.bulletWords + a.bodyWords <= 60) return 'split';
  // Bullets (with or without body)
  if (a.bullets.length >= 2 || a.bullets.length === 1) return 'points';
  return a.hasPhoto ? 'split' : 'statement';
}

/** Layout names keyed by type; variants picked by planDeck() for rhythm. */
const LAYOUT_FOR = {
  cover: 'cover', references: 'references', quote: 'quote', diagram: 'diagram', comparison: 'table',
  number: 'number', stats: 'stats', conclusion: 'closing', section: 'section', timeline: 'timeline',
  process: 'process', hierarchy: 'hierarchy', image_focus: 'imageFocus', editorial: 'editorial',
  statement: 'statement', split: 'split', points: 'points',
};

/**
 * Plan a whole deck: classify, choose layouts, then apply RHYTHM rules so the
 * deck never repeats the same composition twice in a row and alternates sides.
 */
/** Референс макетінің біздің макетке сәйкестігі. null → мазмұн бойынша әдеттегі таңдау. */
const REF_FREE = new Set(['points', 'split', 'image_focus', 'editorial', 'statement', 'stats']);
function refLayout(a, type, arche) {
  if (!arche || !REF_FREE.has(type)) return null;
  const cards = /^cards-(\d)/.exec(arche);
  if (cards) return a.bullets.length >= 2 ? { layout: 'cards' } : null;
  switch (arche) {
    case 'text-image-left': case 'image-strip-top': case 'image-strip-bottom': return a.hasPhoto ? { layout: 'split', flip: false } : null;
    case 'text-image-right': return a.hasPhoto ? { layout: 'split', flip: true } : null;
    case 'full-image': return a.hasPhoto ? { layout: 'fullImage' } : null;
    case 'big-number': return a.stats.length === 1 && !a.bullets.length ? { layout: 'number' } : null;
    case 'statement': return a.bullets.length <= 1 && a.bodyWords < 40 ? { layout: 'statement' } : null;
    case 'two-column': return a.bullets.length >= 3 ? { layout: 'points' } : null;
    default: return null;
  }
}

function planDeck(slides) {
  const list = Array.isArray(slides) ? slides : [];
  const total = list.length;
  const plan = list.map((slide, i) => {
    const a = analyzeSlide(slide, i, total);
    const type = classify(a);
    const ref = refLayout(a, type, slide && slide.composition && slide.composition.refArchetype);
    const base = { a, type, layout: LAYOUT_FOR[type] || 'statement', flip: false, section: 0, notes: [] };
    if (ref) { base.layout = ref.layout; base.locked = true; if (ref.flip != null) { base.flip = ref.flip; base.flipLocked = true; } base.notes.push('ref:' + slide.composition.refArchetype); }
    return base;
  });

  // Alternatives that keep meaning but change the composition.
  const ALT = {
    points: ['editorial', 'split'],
    editorial: ['points'],
    split: ['imageFocus', 'points'],
    imageFocus: ['split'],
    statement: ['imageFocus'],
  };
  for (let i = 1; i < plan.length; i++) {
    const p = plan[i]; const prev = plan[i - 1];
    if (p.locked || p.layout !== prev.layout) continue;
    const alts = ALT[p.layout] || [];
    for (const alt of alts) {
      if (!isValidAlt(p.a, alt)) continue;
      if (i + 1 < plan.length && plan[i + 1].layout === alt) continue;
      p.notes.push('rhythm:' + p.layout + '→' + alt);
      p.layout = alt;
      break;
    }
  }

  // Alternate image side for image-bearing layouts; number sections.
  let flip = false; let sec = 0;
  plan.forEach((p) => {
    if (p.layout === 'section') { sec += 1; p.section = sec; }
    if (p.flipLocked) { flip = !p.flip; return; }
    if (['split', 'imageFocus', 'editorial', 'points'].includes(p.layout)) { p.flip = flip; flip = !flip; }
  });
  return plan;
}

function isValidAlt(a, layout) {
  if (layout === 'split' || layout === 'imageFocus') return a.hasPhoto;
  if (layout === 'points') return a.bullets.length >= 1 || a.bodyWords > 0;
  if (layout === 'editorial') return a.bodyWords >= 12 || a.bullets.length >= 1;
  return true;
}

module.exports = {
  words, wc, isVisualSvg, splitLabelDetail, toNode, truncate, parseStatNumber, imageMeta,
  analyzeSlide, classify, planDeck, LAYOUT_FOR, refLayout,
};
