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
    out.push({
      x: (br.left + pl - sr.left) / k, y: (br.top + pt - sr.top) / k,
      w: (br.width - pl - pr) / k, h: (br.height - pt - pb) / k,
      ink: { x: (left - sr.left) / k, y: (top - sr.top) / k, w: (right - left) / k, h: (bottom - top) / k },
      align: align, lineHeight: lh / k, nowrap: /nowrap|pre/.test(cs.whiteSpace),
      lines: lines.map(function (ln) {
        return ln.map(function (w) { return { text: w.text, space: w.space, s: w.style }; });
      }),
    });
  });
  return out;
}

/** Hide glyphs only (text-fill), so borders/cards/meters drawn with `color` stay in the background picture. */
function hideText(on) {
  var id = '__pptx_hide_text';
  var st = document.getElementById(id);
  if (!st) {
    st = document.createElement('style'); st.id = id;
    st.textContent = '.pptx-hide-text .layer-mid,.pptx-hide-text .layer-mid *{-webkit-text-fill-color:transparent!important;text-shadow:none!important;-webkit-text-stroke:0!important}' +
      '.pptx-hide-text .layer-mid [data-clip-text]{background-image:none!important}';
    document.head.appendChild(st);
  }
  var stage = document.getElementById('stage');
  if (on) {
    [].forEach.call(document.querySelectorAll('.layer-mid *'), function (el) {
      var s = getComputedStyle(el);
      if (s.webkitBackgroundClip === 'text' || s.backgroundClip === 'text') el.setAttribute('data-clip-text', '1');
    });
  }
  stage.classList.toggle('pptx-hide-text', !!on);
  return true;
}
/* eslint-enable no-var */

module.exports = { extractTextLayer, hideText };
