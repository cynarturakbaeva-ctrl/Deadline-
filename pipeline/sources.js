'use strict';

/**
 * Provenance-aware sources / references helpers.
 * Never fabricates citations or URLs.
 * Only surfaces sources explicitly present in the client brief or slide text.
 */

const SOURCE_LINE_RE = /^\s*(?:\[\d+\]|\d+[.)]|[-•*])\s+.{8,}/;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const NAMED_SOURCE_RE = /(?:согласно|according to|дереккөз|источник|source)\s*[:：]?\s*([^\n]{8,120})/i;

/**
 * Extract candidate reference lines from raw client brief only.
 * Returns [] if nothing reliable is found — caller must NOT invent fillers.
 */
function extractSourcesFromBrief(brief) {
  const text = String(brief || '');
  if (text.length < 20) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const found = [];
  const seen = new Set();

  for (const line of lines) {
    const isRefSection = /әдебиет|литератур|references|bibliography|источники|дереккөз/i.test(line);
    if (isRefSection) continue;
    if (SOURCE_LINE_RE.test(line) || NAMED_SOURCE_RE.test(line)) {
      const clean = line.replace(/\s+/g, ' ').slice(0, 200);
      const key = clean.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        found.push(clean);
      }
    }
  }

  // URLs only when explicitly written by the user
  const urls = text.match(URL_RE) || [];
  for (const u of urls.slice(0, 8)) {
    const clean = u.replace(/[),.;]+$/, '').slice(0, 200);
    if (!seen.has(clean)) {
      seen.add(clean);
      found.push(clean);
    }
  }

  return found.slice(0, 12);
}

function deckAlreadyHasReferences(slides) {
  if (!Array.isArray(slides) || !slides.length) return false;
  const last = slides[slides.length - 1];
  const t = String(last && last.title || '');
  return /әдебиет|references|bibliography|источник|дереккөз/i.test(t);
}

/**
 * Optionally append a references slide when the brief contains real sources
 * and the deck does not already end with one.
 * Never creates fake entries.
 */
function maybeAttachReferencesSlide(slides, brief, opts = {}) {
  const sources = extractSourcesFromBrief(brief);
  if (sources.length < 2) {
    return { slides, attached: false, sources: [] };
  }
  if (deckAlreadyHasReferences(slides)) {
    return { slides, attached: false, sources };
  }
  // Only auto-attach for academic style or explicit request
  const style = (opts.style || '').toLowerCase();
  const briefLower = String(brief || '').toLowerCase();
  const wantsRefs = style === 'academic'
    || /әдебиет|references|источник|дереккөз/i.test(briefLower);
  if (!wantsRefs) {
    return { slides, attached: false, sources };
  }

  const next = (slides || []).map((s) => ({ ...s }));
  const index = next.length + 1;
  next.push({
    index,
    title: opts.language === 'Russian' ? 'Список литературы'
      : opts.language === 'English' ? 'References'
        : 'Әдебиеттер тізімі',
    subtitle: null,
    body: null,
    bullets: sources.slice(0, 8),
    stats: null,
    table: null,
    visual: null,
    imageQuery: 'library books shelves soft light atmospheric',
    composition: {
      image: 'full_background',
      overlay: 'dark_gradient_bottom',
      textPosition: 'center_left',
      layout: 'single_column',
      mood: 'dark',
      accentColor: '#6b8cae',
    },
  });
  return { slides: next, attached: true, sources };
}

module.exports = {
  extractSourcesFromBrief,
  maybeAttachReferencesSlide,
  deckAlreadyHasReferences,
};


const META_LEAK_RE = /opening\s*visual|executive\s*overview|line\s*chart|slide\s*structure|full.?bleed|hero\s*slide|design\s*instruction|тақырыпты бірден|күшті opening|уақыт шкаласы немесе|presentation outline/i;

/**
 * Fix slides that leaked outline/design instructions (especially fake "references").
 * If references slide is poisoned: replace with brief sources or drop the slide.
 */
function sanitizeMetaLeakSlides(slides, brief) {
  if (!Array.isArray(slides)) return { slides, fixed: 0 };
  const out = slides.map((sl) => ({ ...sl, bullets: Array.isArray(sl.bullets) ? [...sl.bullets] : sl.bullets }));
  let fixed = 0;
  const briefSources = extractSourcesFromBrief(brief);

  for (let i = 0; i < out.length; i++) {
    const sl = out[i];
    const title = String(sl.title || '');
    const isRefs = /әдебиет|references|bibliography|источник|дереккөз/i.test(title);
    const bullets = Array.isArray(sl.bullets) ? sl.bullets.map(String) : [];
    const blob = [title, sl.subtitle, sl.body, ...bullets].join(' ');
    const leaked = META_LEAK_RE.test(blob) || bullets.some((b) => META_LEAK_RE.test(b));
    if (!leaked) continue;

    fixed++;
    if (isRefs) {
      if (briefSources.length >= 2) {
        sl.bullets = briefSources.slice(0, 8);
        sl.subtitle = sl.subtitle && !META_LEAK_RE.test(String(sl.subtitle)) ? sl.subtitle : 'Негізгі дереккөздер';
        sl.body = null;
      } else {
        // No real sources — convert to a clean conclusion-style closer rather than fake refs
        sl.title = 'Қорытынды';
        sl.subtitle = 'Негізгі тұжырымдар';
        sl.bullets = out
          .slice(1, -1)
          .map((x) => x.title)
          .filter(Boolean)
          .slice(0, 3)
          .map((t) => String(t).slice(0, 80));
        sl.body = null;
      }
    } else {
      // Non-refs slide with meta leak: drop poisoned bullets
      sl.bullets = bullets.filter((b) => !META_LEAK_RE.test(b)).slice(0, 4);
      if (!sl.bullets.length) {
        sl.bullets = [String(sl.subtitle || sl.title || 'Негізгі ой').slice(0, 80)];
      }
    }
  }
  return { slides: out, fixed };
}

module.exports.sanitizeMetaLeakSlides = sanitizeMetaLeakSlides;
