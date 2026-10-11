'use strict';
/**
 * INFOGRAPHIC LIBRARY — professionally designed, data-driven components drawn by CODE.
 * The LLM only says WHICH component and WHAT data (slide.infographic); geometry, colour and typography are ours,
 * so every chart looks the same high quality on every topic and theme.
 *
 *   data      bar · column · line · donut · compare · pictogram
 *   structure cycle · funnel · pyramid · venn · matrix · prosCons · roadmap · iconGrid
 *
 * Rendering rules (data-viz discipline): one series = one colour with ONE highlighted mark (accent gradient),
 * the rest muted; thin marks with rounded data-ends; hairline, recessive axes; values labelled directly;
 * text always in text colours (never the series colour). Shapes are drawn without text (SVG/CSS); every
 * word is real HTML text, so the editable-PPTX text layer turns it into PowerPoint text boxes.
 */
const { truncate, parseStatNumber } = require('./analyze');
const { pickIcon, iconSvg } = require('./icons');
const T = require('./tokens');

const esc = (v) => (v == null ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── data normalisation ─────────────────────────────────────────────────────
function str(v, max) { return truncate(String(v == null ? '' : v).replace(/\s+/g, ' ').trim(), max || 120); }
/** "1 500 000", "87%", "$4.2 млрд", 3,5 → number; keeps the original text for display. */
function num(v) {
  if (typeof v === 'number' && isFinite(v)) return v;
  const s = String(v == null ? '' : v).replace(/\s| /g, '');
  const m = s.match(/-?\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(',', '.')) : null;
}
function item(raw, i) {
  if (raw == null) return null;
  if (typeof raw !== 'object') raw = { label: raw };
  const label = str(raw.label || raw.name || raw.title || raw.year || raw.date || '', 80);
  const valueText = typeof raw.value === 'number' && isFinite(raw.value) ? fmt(raw.value) : raw.value != null ? String(raw.value).trim() : '';
  return {
    i,
    label,
    detail: str(raw.detail || raw.text || raw.description || '', 160),
    value: valueText ? num(valueText) : null,
    display: valueText,
    icon: raw.icon,
    group: String(raw.group || raw.side || '').toLowerCase(),
  };
}
const unitOf = (d) => String(d.unit || '').trim().slice(0, 12);
const isPct = (it, d) => /%/.test(it.display) || /%|пайыз|процент|percent/i.test(unitOf(d));
function showValue(it, d) {
  const base = it.display || (it.value != null ? fmt(it.value) : '');
  const u = unitOf(d);
  if (!u || /[^\d\s.,+\-]/.test(base)) return base; // already carries its unit ("87%", "4 млн", "$3")
  return u === '%' ? base + '%' : base + ' ' + u;
}
function fmt(n) {
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ');
  return String(r1(n)).replace('.', ',');
}

const KINDS = {};
const def = (name, spec) => { KINDS[name] = spec; };

/** Validate + normalise raw slide.infographic. Returns null when it cannot be drawn honestly. */
function validateInfographic(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = String(raw.kind || raw.type || '').trim();
  const spec = KINDS[kind];
  if (!spec) return null;
  const items = (Array.isArray(raw.items) ? raw.items : Array.isArray(raw.data) ? raw.data : []).map(item).filter((x) => x && (x.label || x.display));
  const d = {
    kind, items, unit: unitOf(raw), source: str(raw.source, 120), center: str(raw.center, 40),
    headers: Array.isArray(raw.headers) ? raw.headers.map((h) => str(h, 40)) : [],
    highlight: Number.isInteger(raw.highlight) ? raw.highlight : null,
  };
  try { return spec.validate(d) ? d : null; } catch (e) { return null; }
}

// ── geometry helpers ───────────────────────────────────────────────────────
const box = (x, y, w, h, extra) => 'left:' + Math.round(x) + 'px;top:' + Math.round(y) + 'px;width:' + Math.round(w) + 'px' + (h != null ? ';height:' + Math.round(h) + 'px' : '') + (extra ? ';' + extra : '');
const txt = (cls, html, style, role) => '<div class="' + cls + '" data-role="' + (role || 'label') + '" style="' + style + '">' + html + '</div>';
function hiIndex(d, values) {
  if (d.highlight != null && d.highlight >= 0 && d.highlight < values.length) return d.highlight;
  let k = 0; values.forEach((v, i) => { if (v != null && v > (values[k] == null ? -Infinity : values[k])) k = i; });
  return k;
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
/** Colours for categorical parts (donut, venn, matrix): accent pair first, then calm steps of them. */
function partColors(p, n) {
  const base = [p.accent, p.accent2, T.mixHex(p.accent, p.bg, 0.45), T.mixHex(p.accent2, p.bg, 0.45), T.mixHex(p.text, p.bg, 0.55), T.mixHex(p.text, p.bg, 0.75)];
  return base.slice(0, n);
}
const ink = (fill, p) => (T.contrast(p.text, fill) >= T.contrast(p.bg, fill) ? p.text : p.bg);

// ── DATA COMPONENTS ────────────────────────────────────────────────────────
def('bar', {
  layout: 'side',
  validate: (d) => d.items.length >= 2 && d.items.length <= 8 && d.items.every((x) => x.value != null && x.value >= 0),
  render(d, W, H) {
    const n = d.items.length; const vals = d.items.map((x) => x.value);
    const hi = hiIndex(d, vals); const max = Math.max(...vals) || 1;
    const rowH = Math.min(118, H / n); const top = (H - rowH * n) / 2;
    const labelW = W * 0.36; const barX = labelW + 28; const valW = 150; const barW = W - barX - valW;
    const thick = clamp(rowH * 0.3, 16, 30);
    const fs = n <= 4 ? 30 : n <= 6 ? 26 : 23;
    return d.items.map((it, i) => {
      const y = top + i * rowH; const w = Math.max(8, barW * (it.value / max)); const on = i === hi;
      return '<div class="ig-track" style="' + box(barX, y + (rowH - thick) / 2, barW, thick) + '"></div>' +
        '<div class="ig-bar' + (on ? ' on' : '') + '" style="' + box(barX, y + (rowH - thick) / 2, w, thick) + '"></div>' +
        txt('ig-lab right' + (on ? ' strong' : ''), esc(it.label), box(0, y, labelW, rowH, 'font-size:' + fs + 'px;display:flex;align-items:center;justify-content:flex-end')) +
        txt('ig-val' + (on ? ' on' : ''), esc(showValue(it, d)), box(barX + w + 16, y, valW + barW - w - 16, rowH, 'font-size:' + (fs + 4) + 'px;display:flex;align-items:center'));
    }).join('');
  },
});

def('column', {
  layout: 'stack',
  validate: (d) => d.items.length >= 3 && d.items.length <= 10 && d.items.every((x) => x.value != null && x.value >= 0),
  render(d, W, H) {
    const n = d.items.length; const vals = d.items.map((x) => x.value);
    const hi = hiIndex(d, vals); const max = Math.max(...vals) * 1.06 || 1;
    const labH = 64; const valH = 52; const plotH = H - labH - valH; const base = valH + plotH;
    const slot = W / n; const cw = clamp(slot * 0.5, 28, 120);
    const fs = n <= 6 ? 26 : 22;
    let out = '<div class="ig-axis" style="' + box(0, base, W, 2) + '"></div>';
    d.items.forEach((it, i) => {
      const h = Math.max(6, plotH * (it.value / max)); const x = slot * i + (slot - cw) / 2; const on = i === hi;
      out += '<div class="ig-col' + (on ? ' on' : '') + '" style="' + box(x, base - h, cw, h) + '"></div>' +
        txt('ig-val center' + (on ? ' on' : ''), esc(showValue(it, d)), box(slot * i, base - h - valH, slot, valH, 'font-size:' + (fs + 2) + 'px;display:flex;align-items:flex-end;justify-content:center;padding-bottom:10px')) +
        txt('ig-lab center' + (on ? ' strong' : ''), esc(truncate(it.label, 28)), box(slot * i, base + 14, slot, labH - 14, 'font-size:' + fs + 'px'));
    });
    return out;
  },
});

def('line', {
  layout: 'stack',
  validate: (d) => d.items.length >= 3 && d.items.length <= 14 && d.items.every((x) => x.value != null),
  render(d, W, H, p) {
    const n = d.items.length; const vals = d.items.map((x) => x.value);
    const lo0 = Math.min(...vals); const hi0 = Math.max(...vals);
    const lo = lo0 >= 0 && (hi0 - lo0) / (hi0 || 1) > 0.45 ? 0 : lo0 - (hi0 - lo0) * 0.25;
    const top = niceMax(hi0) > hi0 * 1.6 ? hi0 * 1.15 : niceMax(hi0);
    const padL = 90; const padR = 150; const labH = 60; const padT = 64;
    const pw = W - padL - padR; const ph = H - labH - padT;
    const X = (i) => padL + (n === 1 ? pw / 2 : (pw * i) / (n - 1));
    const Y = (v) => padT + ph - ph * ((v - lo) / ((top - lo) || 1));
    const pts = vals.map((v, i) => [X(i), Y(v)]);
    const line = pts.map((q, i) => (i ? 'L' : 'M') + r1(q[0]) + ' ' + r1(q[1])).join(' ');
    const area = line + ' L' + r1(pts[n - 1][0]) + ' ' + (padT + ph) + ' L' + r1(pts[0][0]) + ' ' + (padT + ph) + ' Z';
    const gid = 'ig' + Math.random().toString(36).slice(2, 8);
    const hi = hiIndex(d, vals); const last = n - 1;
    const grid = [0.25, 0.5, 0.75, 1].map((f) => '<line x1="' + padL + '" x2="' + (W - padR + 40) + '" y1="' + r1(padT + ph * (1 - f)) + '" y2="' + r1(padT + ph * (1 - f)) + '" class="ig-grid"/>').join('');
    let svg = '<svg class="ig-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '"><defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + p.accent + '" stop-opacity=".32"/><stop offset="1" stop-color="' + p.accent + '" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="' + gid + 's" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="' + p.accent2 + '"/><stop offset="1" stop-color="' + p.accent + '"/></linearGradient></defs>' +
      grid + '<line x1="' + padL + '" x2="' + (W - padR + 40) + '" y1="' + (padT + ph) + '" y2="' + (padT + ph) + '" class="ig-base"/>' +
      '<path d="' + area + '" fill="url(#' + gid + ')"/><path d="' + line + '" fill="none" stroke="url(#' + gid + 's)" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>' +
      pts.map((q, i) => '<circle cx="' + r1(q[0]) + '" cy="' + r1(q[1]) + '" r="' + (i === hi || i === last ? 11 : 7) + '" fill="' + (i === hi || i === last ? p.accent : p.bg) + '" stroke="' + p.accent + '" stroke-width="4"/>').join('') + '</svg>';
    const every = n <= 8 ? 1 : Math.ceil(n / 7);
    d.items.forEach((it, i) => {
      if (i % every && i !== last) return;
      svg += txt('ig-lab center', esc(truncate(it.label, 16)), box(clamp(X(i) - 80, 0, W - 160), padT + ph + 14, 160, labH - 14, 'font-size:22px'));
    });
    const tag = (i, cls) => txt('ig-val center ' + cls, esc(showValue(d.items[i], d)), box(clamp(pts[i][0] - 110, 0, W - 220), pts[i][1] - 62, 220, 44, 'font-size:30px'));
    svg += tag(last, 'on'); if (hi !== last) svg += tag(hi, '');
    if (0 !== hi && 0 !== last) svg += tag(0, 'muted');
    return svg;
  },
});

def('donut', {
  layout: 'side',
  validate: (d) => d.items.length >= 2 && d.items.length <= 6 && d.items.every((x) => x.value != null && x.value > 0),
  render(d, W, H, p) {
    const vals = d.items.map((x) => x.value); const sum = vals.reduce((a, b) => a + b, 0);
    const hi = hiIndex(d, vals); const cols = partColors(p, vals.length);
    const D = Math.min(H - 40, W * 0.56); const R = D / 2; const sw = R * 0.3; const rr = R - sw / 2; const C = 2 * Math.PI * rr;
    const cx = R + 10; const cy = H / 2;
    let acc = 0;
    const segs = vals.map((v, i) => {
      const len = (C * v) / sum; const gap = vals.length > 1 ? 4 : 0;
      const s = '<circle cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="' + r1(rr) + '" fill="none" stroke="' + cols[i] + '" stroke-width="' + r1(i === hi ? sw + 10 : sw) + '" stroke-dasharray="' + r1(Math.max(1, len - gap)) + ' ' + r1(C) + '" stroke-dashoffset="' + r1(-acc) + '" transform="rotate(-90 ' + r1(cx) + ' ' + r1(cy) + ')"/>';
      acc += len; return s;
    }).join('');
    const pct = (v) => Math.round((v / sum) * 100) + '%';
    const hiTxt = d.items.every((x) => isPct(x, d)) ? showValue(d.items[hi], d) : pct(vals[hi]);
    let out = '<svg class="ig-svg" width="' + W + '" height="' + H + '"><circle cx="' + r1(cx) + '" cy="' + r1(cy) + '" r="' + r1(rr) + '" fill="none" class="ig-ring-track" stroke-width="' + r1(sw) + '"/>' + segs + '</svg>' +
      txt('ig-big center', esc(hiTxt), box(cx - R * 0.62, cy - 64, R * 1.24, 84, 'font-size:' + Math.round(clamp(R * 0.36, 48, 96)) + 'px'), 'numeral') +
      txt('ig-lab center', esc(truncate(d.center || d.items[hi].label, 30)), box(cx - R * 0.6, cy + 26, R * 1.2, 60, 'font-size:22px'));
    const lx = D + 70; const lw = W - lx; const rowH = Math.min(96, (H - 40) / vals.length); const ly = cy - (rowH * vals.length) / 2;
    d.items.forEach((it, i) => {
      const y = ly + i * rowH;
      out += '<div class="ig-sw" style="' + box(lx, y + 14, 18, 18, 'background:' + cols[i]) + '"></div>' +
        txt('ig-val' + (i === hi ? ' on' : ''), esc(d.items.every((x) => isPct(x, d)) ? showValue(it, d) : pct(it.value)), box(lx + 34, y, 140, 46, 'font-size:32px')) +
        txt('ig-lab' + (i === hi ? ' strong' : ''), esc(truncate(it.label, 44)), box(lx + 34, y + 44, lw - 34, rowH - 44, 'font-size:22px'));
    });
    return out;
  },
});

def('compare', {
  layout: 'side',
  validate: (d) => d.items.length === 2 && d.items.every((x) => x.value != null && x.value >= 0),
  render(d, W, H, p) {
    const [a, b] = d.items; const sum = (a.value + b.value) || 1;
    const half = (W - 120) / 2; const yNum = H * 0.22;
    const fa = a.value / sum;
    const bigFs = Math.round(clamp(half / Math.max(4, showValue(a, d).length, showValue(b, d).length) * 1.6, 64, 140));
    return txt('ig-big', esc(showValue(a, d)), box(0, yNum, half, bigFs * 1.15, 'font-size:' + bigFs + 'px;color:var(--accent)'), 'numeral') +
      txt('ig-big right', esc(showValue(b, d)), box(W - half, yNum, half, bigFs * 1.15, 'font-size:' + bigFs + 'px'), 'numeral') +
      txt('ig-lab strong', esc(a.label), box(0, yNum + bigFs * 1.2, half, 50, 'font-size:30px')) +
      txt('ig-lab strong right', esc(b.label), box(W - half, yNum + bigFs * 1.2, half, 50, 'font-size:30px')) +
      (a.detail ? txt('ig-det', esc(a.detail), box(0, yNum + bigFs * 1.2 + 52, half, 120, 'font-size:22px')) : '') +
      (b.detail ? txt('ig-det right', esc(b.detail), box(W - half, yNum + bigFs * 1.2 + 52, half, 120, 'font-size:22px')) : '') +
      '<div class="ig-vs" style="' + box(W / 2 - 44, yNum + bigFs * 0.1, 88, 88) + '"></div>' +
      txt('ig-vs-t center', 'vs', box(W / 2 - 44, yNum + bigFs * 0.1 + 22, 88, 44, 'font-size:26px')) +
      '<div class="ig-split" style="' + box(0, H * 0.78, W, 26) + '"><i class="a" style="width:' + r1(fa * 100) + '%"></i><i class="b" style="width:' + r1((1 - fa) * 100) + '%"></i></div>';
  },
});

def('pictogram', {
  layout: 'side',
  validate: (d) => d.items.length >= 1 && d.items[0].value != null && (isPct(d.items[0], d) ? d.items[0].value >= 0 && d.items[0].value <= 100 : false),
  render(d, W, H) {
    const it = d.items[0]; const total = 20; const on = Math.round((it.value / 100) * total);
    const icon = pickIcon(it.icon, it.label) === 'users' || !pickIcon(it.icon, it.label) ? 'person-standing' : pickIcon(it.icon, it.label);
    const cols = 10; const cell = Math.min((W - 20) / cols, 90); const gx = (W - cell * cols) / 2; const gy = H * 0.42;
    let out = txt('ig-big', esc(showValue(it, d)), box(0, 0, W, 150, 'font-size:132px;color:var(--accent)'), 'numeral') +
      txt('ig-lab strong', esc(it.label), box(0, 158, W, 90, 'font-size:30px'));
    for (let k = 0; k < total; k++) {
      const x = gx + (k % cols) * cell; const y = gy + Math.floor(k / cols) * (cell * 1.25);
      out += '<div class="ig-pic' + (k < on ? ' on' : '') + '" style="' + box(x, y, cell, cell * 1.15) + '">' + iconSvg(icon, Math.round(cell * 0.92), 2) + '</div>';
    }
    if (it.detail) out += txt('ig-det', esc(it.detail), box(0, gy + cell * 2.6 + 20, W, H - gy - cell * 2.6 - 20, 'font-size:22px'));
    return out;
  },
});

// ── STRUCTURE COMPONENTS ───────────────────────────────────────────────────
function iconOrNum(it, i, size) {
  const ic = pickIcon(it.icon, it.label + ' ' + it.detail);
  return ic ? iconSvg(ic, size, 1.8) : '<span class="ig-n" style="font-size:' + Math.round(size * 0.8) + 'px">' + String(i + 1).padStart(2, '0') + '</span>';
}

def('cycle', {
  layout: 'stack',
  validate: (d) => d.items.length >= 3 && d.items.length <= 6,
  render(d, W, H, p) {
    const n = d.items.length; const cx = W * 0.5; const cy = H / 2; const R = Math.min(H / 2 - 70, 230); const nd = 116;
    // even counts start rotated so no node sits exactly at the top/bottom (their labels would cross the arcs)
    const start = n % 2 === 0 ? -90 + 180 / n : -90;
    const ang = (i) => (start + (360 * i) / n) * Math.PI / 180;
    let arcs = '';
    for (let i = 0; i < n; i++) {
      const a0 = ang(i) + (nd / 2 + 14) / R; const a1 = ang(i + 1) - (nd / 2 + 22) / R;
      const P = (a) => r1(cx + R * Math.cos(a)) + ' ' + r1(cy + R * Math.sin(a));
      arcs += '<path d="M' + P(a0) + ' A' + R + ' ' + R + ' 0 0 1 ' + P(a1) + '" class="ig-arc" marker-end="url(#igArrow)"/>';
    }
    let out = '<svg class="ig-svg" width="' + W + '" height="' + H + '"><defs><marker id="igArrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="' + p.accent + '"/></marker></defs>' + arcs + '</svg>';
    if (d.center) out += txt('ig-center center', esc(d.center), box(cx - R + 70, cy - 40, 2 * R - 140, 80, 'font-size:34px;display:flex;align-items:center;justify-content:center'), 'title');
    d.items.forEach((it, i) => {
      const a = ang(i); const x = cx + R * Math.cos(a); const y = cy + R * Math.sin(a);
      out += '<div class="ig-node' + (i === 0 ? ' on' : '') + '" style="' + box(x - nd / 2, y - nd / 2, nd, nd) + '">' + iconOrNum(it, i, 48) + '</div>';
      const pole = Math.abs(Math.cos(a)) < 0.3;   // top/bottom node → label outside the whole ring, on the right
      const right = pole || Math.cos(a) >= 0;
      const lx0 = pole ? cx + R + nd / 2 + 30 : x + nd / 2 + 24;
      const lw = Math.min(440, right ? W - lx0 : x - nd / 2 - 24);
      const lx = right ? lx0 : x - nd / 2 - 24 - lw;
      if (pole) out += '<div class="ig-lead" style="' + box(x + nd / 2 + 8, y, lx0 - x - nd / 2 - 18, 2) + '"></div>';
      out += txt('ig-lab strong' + (right ? '' : ' right'), '<span class="ig-k">' + String(i + 1).padStart(2, '0') + '</span> ' + esc(it.label), box(lx, y - 46, lw, 44, 'font-size:28px')) +
        (it.detail ? txt('ig-det' + (right ? '' : ' right'), esc(truncate(it.detail, 90)), box(lx, y + 6, lw, 70, 'font-size:21px')) : '');
    });
    return out;
  },
});

def('funnel', {
  layout: 'side',
  validate: (d) => d.items.length >= 3 && d.items.length <= 6,
  render(d, W, H, p) {
    const n = d.items.length; const gap = 10; const bh = (H - gap * (n - 1)) / n; const fw = W * 0.62;
    let out = '';
    d.items.forEach((it, i) => {
      const w0 = fw * (1 - (0.55 * i) / n); const w1 = fw * (1 - (0.55 * (i + 1)) / n); const y = i * (bh + gap);
      const fill = i === 0 ? p.accent : T.mixHex(p.accent, p.bg, Math.min(0.62, 0.14 * i));
      const inset = ((w0 - w1) / 2 / w0) * 100;
      out += '<div class="ig-band" style="' + box((fw - w0) / 2, y, w0, bh, 'background:' + fill + ';clip-path:polygon(0 0,100% 0,' + r1(100 - inset) + '% 100%,' + r1(inset) + '% 100%)') + '"></div>' +
        (it.display ? txt('ig-val center', esc(showValue(it, d)), box((fw - w1) / 2, y, w1, bh, 'font-size:' + Math.round(clamp(bh * 0.36, 24, 40)) + 'px;display:flex;align-items:center;justify-content:center;color:' + ink(fill, p))) : '') +
        txt('ig-lab strong', esc(it.label), box(fw + 36, y, W - fw - 36, bh * 0.55, 'font-size:' + (n <= 4 ? 28 : 24) + 'px;display:flex;align-items:flex-end')) +
        (it.detail ? txt('ig-det', esc(truncate(it.detail, 80)), box(fw + 36, y + bh * 0.56, W - fw - 36, bh * 0.44, 'font-size:20px')) : '');
    });
    return out;
  },
});

def('pyramid', {
  layout: 'side',
  validate: (d) => d.items.length >= 3 && d.items.length <= 5,
  render(d, W, H, p) {
    const n = d.items.length; const pw = W * 0.5; const gap = 8; const lh = (H - gap * (n - 1)) / n;
    let out = '';
    d.items.forEach((it, i) => {
      const y = i * (lh + gap); const yT = y / H; const yB = (y + lh) / H;
      const fill = T.mixHex(p.accent, p.bg, Math.min(0.6, 0.15 * i));
      const lT = 50 - 50 * yT; const lB = 50 - 50 * yB;
      out += '<div class="ig-band" style="' + box(0, y, pw, lh, 'background:' + fill + ';clip-path:polygon(' + r1(lT) + '% 0,' + r1(100 - lT) + '% 0,' + r1(100 - lB) + '% 100%,' + r1(lB) + '% 100%)') + '"></div>' +
        '<div class="ig-lead" style="' + box(pw * (1 - lB / 100) - 8, y + lh / 2, pw * 0.08 + W * 0.04, 2) + '"></div>' +
        txt('ig-lab strong', esc(it.label), box(pw + W * 0.07, y + lh * 0.08, W - pw - W * 0.07, lh * 0.46, 'font-size:' + (n <= 4 ? 28 : 25) + 'px;display:flex;align-items:flex-end')) +
        (it.detail ? txt('ig-det', esc(truncate(it.detail, 90)), box(pw + W * 0.07, y + lh * 0.55, W - pw - W * 0.07, lh * 0.45, 'font-size:20px')) : '');
    });
    return out;
  },
});

def('venn', {
  layout: 'side',
  validate: (d) => d.items.length >= 2 && d.items.length <= 3,
  render(d, W, H, p) {
    const n = d.items.length; const cols = partColors(p, n);
    const R = n === 2 ? Math.min(H * 0.36, W * 0.3) : Math.min(H * 0.3, W * 0.25);
    const cx = W / 2; const cy = H / 2;
    const C = n === 2 ? [[cx - R * 0.62, cy], [cx + R * 0.62, cy]] : [[cx - R * 0.6, cy - R * 0.38], [cx + R * 0.6, cy - R * 0.38], [cx, cy + R * 0.66]];
    let out = '<svg class="ig-svg" width="' + W + '" height="' + H + '">' + C.map((c, i) => '<circle cx="' + r1(c[0]) + '" cy="' + r1(c[1]) + '" r="' + r1(R) + '" fill="' + cols[i] + '" fill-opacity=".22" stroke="' + cols[i] + '" stroke-width="3"/>').join('') + '</svg>';
    const away = (c) => { const dx = c[0] - cx; const dy = c[1] - cy; const L = Math.hypot(dx, dy) || 1; return [c[0] + (dx / L) * R * 0.42, c[1] + (dy / L) * R * 0.42]; };
    d.items.forEach((it, i) => {
      const q = away(C[i]); const lw = R * 1.05;
      out += txt('ig-lab strong center', esc(truncate(it.label, 30)), box(q[0] - lw / 2, q[1] - 40, lw, 44, 'font-size:28px')) +
        (it.detail ? txt('ig-det center', esc(truncate(it.detail, 60)), box(q[0] - lw / 2, q[1] + 6, lw, 60, 'font-size:20px')) : '');
    });
    if (d.center) out += '<div class="ig-dot" style="' + box(cx - 10, (n === 2 ? cy : cy - R * 0.03) - 10, 20, 20) + '"></div>' + txt('ig-center center', esc(d.center), box(cx - R * 0.5, (n === 2 ? cy : cy - R * 0.03) + 18, R, 50, 'font-size:24px'), 'title');
    return out;
  },
});

def('matrix', {
  layout: 'stack',
  validate: (d) => d.items.length === 4,
  render(d, W, H, p) {
    const g = 24; const cw = (W - g) / 2; const ch = (H - g) / 2; const cols = partColors(p, 4);
    return d.items.map((it, i) => {
      const x = (i % 2) * (cw + g); const y = Math.floor(i / 2) * (ch + g);
      const ic = pickIcon(it.icon, it.label);
      const letter = (it.label.match(/\p{L}/u) || [''])[0].toUpperCase();
      return '<div class="ig-card" style="' + box(x, y, cw, ch, '--c:' + cols[i]) + '"></div>' +
        '<div class="ig-badge" style="' + box(x + 32, y + 32, 72, 72, 'background:' + cols[i] + ';color:' + ink(cols[i], p)) + '">' + (ic ? iconSvg(ic, 38, 2) : '') + '</div>' +
        (!ic ? txt('ig-n center', esc(letter), box(x + 32, y + 46, 72, 44, 'font-size:34px;color:' + ink(cols[i], p))) : '') +
        txt('ig-lab strong', esc(it.label), box(x + 128, y + 34, cw - 160, 70, 'font-size:32px;display:flex;align-items:center')) +
        (it.detail ? txt('ig-det', esc(truncate(it.detail, 150)), box(x + 32, y + 124, cw - 64, ch - 150, 'font-size:24px')) : '');
    }).join('');
  },
});

def('prosCons', {
  layout: 'stack',
  validate: (d) => {
    const pros = d.items.filter((x) => /pro|plus|\+|артық|плюс|adv/.test(x.group));
    const cons = d.items.filter((x) => /con|minus|-|кем|минус|dis/.test(x.group));
    return pros.length >= 1 && cons.length >= 1 && pros.length <= 5 && cons.length <= 5;
  },
  render(d, W, H, p) {
    const pros = d.items.filter((x) => /pro|plus|\+|артық|плюс|adv/.test(x.group)).slice(0, 5);
    const cons = d.items.filter((x) => /con|minus|-|кем|минус|dis/.test(x.group)).slice(0, 5);
    const g = 40; const cw = (W - g) / 2; const hdr = 76;
    const col = (list, x, good, head) => {
      const rowH = Math.min(104, (H - hdr - 20) / Math.max(list.length, 1));
      let o = '<div class="ig-col-head ' + (good ? 'good' : 'bad') + '" style="' + box(x, 0, cw, 6) + '"></div>' +
        txt('ig-lab strong', esc(head), box(x, 18, cw, 50, 'font-size:32px'));
      list.forEach((it, i) => {
        const y = hdr + 12 + i * rowH;
        o += '<div class="ig-mark ' + (good ? 'good' : 'bad') + '" style="' + box(x, y + 4, 44, 44) + '">' + iconSvg(good ? 'check' : 'x', 26, 3) + '</div>' +
          txt('ig-lab', esc(it.label) + (it.detail ? '<span class="ig-det-in"> — ' + esc(truncate(it.detail, 90)) + '</span>' : ''), box(x + 64, y, cw - 64, rowH - 8, 'font-size:' + (it.detail ? 24 : 27) + 'px'));
      });
      return o;
    };
    const all = d.items.map((x) => x.label + ' ' + x.detail).join(' ');
    const lang = /[әғқңөұүһі]/i.test(all) ? 'kk' : /[а-яё]/i.test(all) ? 'ru' : 'en';
    const heads = d.headers.length >= 2 ? d.headers : { kk: ['Артықшылықтары', 'Кемшіліктері'], ru: ['Преимущества', 'Недостатки'], en: ['Advantages', 'Disadvantages'] }[lang];
    return col(pros, 0, true, heads[0]) + col(cons, cw + g, false, heads[1]);
  },
});

def('roadmap', {
  layout: 'stack',
  validate: (d) => d.items.length >= 3 && d.items.length <= 6,
  render(d, W, H, p) {
    const n = d.items.length; const ly = H / 2; const slot = W / n; const cardW = Math.min(slot * 1.8 - 24, 470);
    let out = '<div class="ig-road" style="' + box(0, ly - 3, W, 6) + '"></div>';
    d.items.forEach((it, i) => {
      const x = slot * i + slot / 2; const up = i % 2 === 0; const on = i === n - 1;
      const cx = clamp(x - cardW / 2, 0, W - cardW);
      out += '<div class="ig-stem" style="' + box(x - 1, up ? ly - 70 : ly + 18, 2, 52) + '"></div>' +
        '<div class="ig-mile' + (on ? ' on' : '') + '" style="' + box(x - 17, ly - 17, 34, 34) + '"></div>' +
        txt('ig-date' + (up ? '' : ''), esc(it.display || it.label), box(cx, up ? ly - 70 - 150 : ly + 78, cardW, 46, 'font-size:34px;text-align:' + (cx === x - cardW / 2 ? 'center' : cx === 0 ? 'left' : 'right')), 'numeral') +
        txt('ig-lab strong', esc(it.display ? it.label : ''), box(cx, up ? ly - 70 - 104 : ly + 124, cardW, 40, 'font-size:26px;text-align:' + (cx === x - cardW / 2 ? 'center' : cx === 0 ? 'left' : 'right'))) +
        (it.detail ? txt('ig-det', esc(truncate(it.detail, 80)), box(cx, up ? ly - 70 - 62 : ly + 166, cardW, 58, 'font-size:20px;text-align:' + (cx === x - cardW / 2 ? 'center' : cx === 0 ? 'left' : 'right'))) : '');
    });
    return out;
  },
});

def('iconGrid', {
  layout: 'stack',
  validate: (d) => d.items.length >= 3 && d.items.length <= 6,
  render(d, W, H, p) {
    const n = d.items.length; const perRow = n <= 4 ? n : 3; const rows = Math.ceil(n / perRow);
    const g = 28; const cw = (W - g * (perRow - 1)) / perRow;
    const ch = Math.min((H - g * (rows - 1)) / rows, rows === 1 ? 380 : 250);
    const oy = (H - (ch * rows + g * (rows - 1))) / 2;
    return d.items.map((it, i) => {
      const x = (i % perRow) * (cw + g); const y = oy + Math.floor(i / perRow) * (ch + g); const on = i === 0;
      const big = rows === 1;
      const icS = big ? 92 : 72;
      return '<div class="ig-card" style="' + box(x, y, cw, ch) + '"></div>' +
        '<div class="ig-badge' + (on ? ' on' : '') + '" style="' + box(x + 36, y + 36, icS, icS) + '">' + iconOrNum(it, i, Math.round(icS * 0.5)) + '</div>' +
        txt('ig-lab strong', esc(it.label), box(x + 36, y + 56 + icS, cw - 72, big ? 90 : 46, 'font-size:' + (big ? 30 : 27) + 'px')) +
        (it.detail ? txt('ig-det', esc(truncate(it.detail, big ? 150 : 100)), box(x + 36, y + (big ? 150 : 110) + icS, cw - 72, ch - (big ? 180 : 130) - icS, 'font-size:' + (big ? 23 : 21) + 'px')) : '');
    }).join('');
  },
});

/** Graphic area HTML for a validated infographic in a W×H box. */
function renderInfographic(d, W, H, palette) {
  const spec = KINDS[d.kind];
  return '<div class="ig ig-kind-' + d.kind + '" data-role="figure" style="position:relative;width:' + Math.round(W) + 'px;height:' + Math.round(H) + 'px">' + spec.render(d, W, H, palette) + '</div>';
}

// ── auto-detection: content that IS an infographic even if the LLM did not say so ──
const SWOT = /^(s\b|w\b|o\b|t\b|strength|weakness|opportunit|threat|күшті|әлсіз|мүмкіндік|қауіп|сильн|слаб|возможност|угроз)/i;
function autoInfographic(slide) {
  const s = slide || {};
  const stats = (Array.isArray(s.stats) ? s.stats : []).filter((x) => x && x.value != null && String(x.value).trim());
  const numeric = stats.filter((x) => parseStatNumber(x.value) != null);
  // 4–6 comparable numbers (all % or all plain) → ranked bar chart
  if (numeric.length >= 4 && numeric.length === stats.length) {
    const pct = numeric.filter((x) => /%/.test(String(x.value))).length;
    if (pct === 0 || pct === numeric.length) {
      return validateInfographic({ kind: 'bar', items: numeric.map((x) => ({ label: x.label, value: x.value })) });
    }
  }
  // SWOT-like 4 labelled bullets → 2×2 matrix
  const bullets = (Array.isArray(s.bullets) ? s.bullets : []).map(String);
  if (bullets.length === 4 && bullets.every((b) => SWOT.test(b.trim()))) {
    return validateInfographic({ kind: 'matrix', items: bullets.map((b) => { const k = b.indexOf(':'); return k > 0 ? { label: b.slice(0, k), detail: b.slice(k + 1) } : { label: b }; }) });
  }
  return null;
}

module.exports = { KINDS, validateInfographic, renderInfographic, autoInfographic, KIND_NAMES: Object.keys(KINDS) };
