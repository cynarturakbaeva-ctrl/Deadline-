'use strict';
/**
 * TEXT LAYER — turns the rendered HTML slide into "background picture + native text boxes".
 *
 * The HTML deck is our internal drawing engine (never sent to the client). For the editable PPTX we:
 *   1. extractTextLayer(i)  — read every visible text block of slide i: box, alignment, line height and the
 *                             exact lines the browser broke the text into (runs keep size/weight/colour per word);
 *   2. hideText(true)       — make glyphs transparent (borders, cards, photos, decoration stay) and screenshot
 *                             the slide as its background;
 *   3. pptxExporter places that background and writes every block as a real, editable PowerPoint text box.
 *
 * Both browser functions are self-contained: they are passed to page.evaluate() as is.
 */

/* eslint-disable no-var */
function extractTextLayer(idx) {
  var stage = document.getElementById('stage');
  var k = parseFloat(getComputedStyle(stage).getPropertyValue('--fit')) || 1;
  var sr = stage.getBoundingClientRect();
  var slide = document.querySelectorAll('.slide')[idx];
  if (!slide) return [];
  var root = slide.querySelector('.layer-mid') || slide;

  function parseColor(c) {
    var m = String(c || '').match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var p = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function hex(c) {
    return [c.r, c.g, c.b].map(function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join('').toUpperCase();
  }
  function opacityOf(el) {
    var o = 1;
    for (var e = el; e && e !== slide; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity);
    return o;
  }
  /** Glyph colour; gradient-clipped text (key-words, hero numbers) takes the gradient's first colour stop. */
  function colorOf(el) {
    var cs = getComputedStyle(el);
    var c = parseColor(cs.webkitTextFillColor);
    if (!c || c.a === 0) c = parseColor(cs.color);
    if (!c || c.a === 0) {
      for (var e = el; e && e !== root.parentElement; e = e.parentElement) {
        var s = getComputedStyle(e);
        if (s.webkitBackgroundClip === 'text' || s.backgroundClip === 'text') {
          var stop = parseColor((s.backgroundImage.match(/rgba?\([^)]+\)/) || [])[0]);
          if (stop) { c = stop; break; }
        }
      }
    }
    return c || { r: 0, g: 0, b: 0, a: 1 };
  }
  function blockOf(el) {
    while (el && el !== root && getComputedStyle(el).display === 'inline') el = el.parentElement;
    return el;
  }
  function visible(el) {
    if (!el || !el.getClientRects().length) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[data-dropped]');
  }

  var blocks = []; var byEl = new Map();
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  var node;
  while ((node = walker.nextNode())) {
    var parent = node.parentElement;
    if (!parent || !visible(parent)) continue;
    var blockEl = blockOf(parent);
    if (!blockEl || blockEl === root) continue;
    var b = byEl.get(blockEl);
    if (!b) { b = { el: blockEl, words: [], pendingSpace: false }; byEl.set(blockEl, b); blocks.push(b); }
    var text = node.nodeValue;
    if (!text.trim()) { if (b.words.length) b.pendingSpace = true; continue; }
    var cs = getComputedStyle(parent);
    var col = colorOf(parent);
    var alpha = col.a * opacityOf(parent);
    if (alpha < 0.05) continue;
    var style = {
      font: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      size: parseFloat(cs.fontSize),
      bold: parseInt(cs.fontWeight, 10) >= 600,
      italic: cs.fontStyle === 'italic',
      color: hex(col),
      alpha: Math.round(alpha * 100) / 100,
      spacing: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0,
      upper: cs.textTransform === 'uppercase',
    };
    var re = /(\s+)|(\S+)/g; var m;
    while ((m = re.exec(text))) {
      if (m[1]) { if (b.words.length) b.pendingSpace = true; continue; }
      var range = document.createRange();
      range.setStart(node, m.index); range.setEnd(node, m.index + m[2].length);
      var rects = range.getClientRects();
      if (!rects.length) continue;
      var r = rects[0];
      b.words.push({ text: m[2], style: style, space: b.pendingSpace, top: r.top, bottom: r.bottom, left: r.left, right: rects[rects.length - 1].right });
      b.pendingSpace = false;
    }
  }

  var out = [];
  blocks.forEach(function (b) {
    if (!b.words.length) return;
    var el = b.el; var cs = getComputedStyle(el);
    var br = el.getBoundingClientRect();
    var pl = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
    var pr = parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth);
    var pt = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
    var pb = parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth);
    // lines exactly as the browser broke them (balanced titles, columns, cards)
    var lines = []; var cur = null; var prev = null;
    b.words.forEach(function (w) {
      var h = Math.max(1, w.bottom - w.top);
      if (!prev || w.top >= prev.bottom - h * 0.4) { cur = []; lines.push(cur); w.space = false; }
      cur.push(w); prev = w;
    });
    var left = Infinity; var right = -Infinity; var top = Infinity; var bottom = -Infinity;
    b.words.forEach(function (w) { left = Math.min(left, w.left); right = Math.max(right, w.right); top = Math.min(top, w.top); bottom = Math.max(bottom, w.bottom); });
    var fontSize = parseFloat(cs.fontSize);
    var lh = cs.lineHeight === 'normal' ? fontSize * 1.2 : parseFloat(cs.lineHeight);
    var align = cs.textAlign === 'center' ? 'center' : (cs.textAlign === 'right' || cs.textAlign === 'end') ? 'right' : cs.textAlign === 'justify' ? 'justify' : 'left';
    // Box = where the text really is. Flex-centred labels (infographics) sit anywhere inside their box, so the box
    // is taken from the ink; in normal flow this equals the content box. Top = top of the first LINE box.
    var flex = /flex|grid/.test(cs.display);
    var firstH = Math.max(1, b.words[0].bottom - b.words[0].top);
    var lineTop = top - (lh - firstH) / 2;
    var bx = flex ? left : br.left + pl;
    var bw = flex ? right - left : br.width - pl - pr;
    if (flex) {
      var jc = cs.justifyContent;
      if (/center/.test(jc)) align = 'center'; else if (/end|right/.test(jc)) align = 'right';
    }
    out.push({
      x: (bx - sr.left) / k, y: (lineTop - sr.top) / k,
      w: bw / k, h: Math.max(lines.length * lh, bottom - lineTop) / k,
      ink: { x: (left - sr.left) / k, y: (top - sr.top) / k, w: (right - left) / k, h: (bottom - top) / k },
      align: align, lineHeight: lh / k, nowrap: /nowrap|pre/.test(cs.whiteSpace),
      lines: lines.map(function (ln) {
        return ln.map(function (w) { return { text: w.text, space: w.space, s: w.style }; });
      }),
    });
  });
  return out;
}

/**
 * Hide glyphs only (text-fill), so borders/cards/meters drawn with `color` stay in the background picture.
 * Inline !important styles: a design system's own `#stage.ds-x .title .hl{-webkit-text-fill-color:…!important}`
 * outranks any stylesheet rule we could add, and the keyword stayed in the background → doubled in PPTX.
 */
function hideText(on) {
  var HIDE = [['-webkit-text-fill-color', 'transparent'], ['text-shadow', 'none'], ['-webkit-text-stroke-width', '0px']];
  var stage = document.getElementById('stage');
  var els = [];
  [].forEach.call(document.querySelectorAll('.layer-mid'), function (root) {
    els.push(root);
    [].push.apply(els, root.querySelectorAll('*'));
  });
  els.forEach(function (el) {
    if (on) {
      if (el.hasAttribute('data-pptx-hidden')) return;
      var s = getComputedStyle(el);
      var clip = s.webkitBackgroundClip === 'text' || s.backgroundClip === 'text';
      var keep = HIDE.concat(clip ? [['background-image', 'none']] : []).map(function (p) {
        return [p[0], el.style.getPropertyValue(p[0]), el.style.getPropertyPriority(p[0])];
      });
      el.setAttribute('data-pptx-hidden', JSON.stringify(keep));
      HIDE.forEach(function (p) { el.style.setProperty(p[0], p[1], 'important'); });
      if (clip) el.style.setProperty('background-image', 'none', 'important');
    } else {
      var saved = el.getAttribute('data-pptx-hidden');
      if (saved == null) return;
      el.removeAttribute('data-pptx-hidden');
      JSON.parse(saved).forEach(function (p) {
        if (p[1]) el.style.setProperty(p[0], p[1], p[2]); else el.style.removeProperty(p[0]);
      });
    }
  });
  if (stage) stage.classList.toggle('pptx-hide-text', !!on);
  return true;
}

/** After hideText(true): elements of slide idx whose own text would still be painted into the background picture. */
function textLeaks(idx) {
  var slide = document.querySelectorAll('.slide')[idx];
  if (!slide) return [];
  var out = [];
  [].forEach.call(slide.querySelectorAll('.layer-mid *'), function (el) {
    var own = [].some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
    if (!own) return;
    var r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) === 0) return;
    var fill = s.webkitTextFillColor;
    var clip = (s.webkitBackgroundClip === 'text' || s.backgroundClip === 'text') && s.backgroundImage !== 'none';
    var transparent = /rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)|transparent/.test(fill);
    if (!transparent || clip || (s.textShadow && s.textShadow !== 'none')) {
      out.push((el.className && el.className.baseVal == null ? '.' + String(el.className).split(/\s+/).join('.') : el.tagName) + ': ' + el.textContent.trim().slice(0, 30));
    }
  });
  return out;
}
/* eslint-enable no-var */

module.exports = { extractTextLayer, hideText, textLeaks };
