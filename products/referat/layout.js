'use strict';
/**
 * Реферат беттерінің үлгісі (A4, Times New Roman 14, интервал 1.5, жиектері 30/10/20/20 мм).
 * Мақсат: мәтін бетте қанша орын алатынын алдын ала есептеп,
 *  1) мазмұндағы бет нөмірлерін дұрыс қою,
 *  2) соңғы бет бос қалмауы үшін (және артық бет шықпауы үшін) көлемді дәл келтіру.
 * Параметрлер LibreOffice (Liberation Serif = TNR метрикасы) арқылы калибрленген.
 */

const PAGE_LINES = 30.35;      // 728.5pt / 24pt (қатаң 24pt жол қадамы — Word/LibreOffice/Google Docs-та бірдей)
const CPL = Number(process.env.REFERAT_CPL) || 76; // бір жолдағы орташа таңба саны (170 мм, TNR 14)
const INDENT_CHARS = 8;        // 1.25 см қызыл жол ≈ 8 таңба

const H1_SPACE = 0.5;          // 12pt / 24pt
const H2_SPACE = 0.25;         // 6pt
const H1_BEFORE = 0.5;         // тақырып алдындағы бос орын (бет басында есептелмейді)
const H2_BEFORE = 0.25;

const { REG, BOLD } = require('./font');
const FONT_PT = 14;
const LINE_W_PT = 481.9 * (Number(process.env.REFERAT_WF) || 1.01); // 170 мм
const INDENT_PT = 35.43;       // 1.25 см

function textWidth(str, table) {
  let w = 0;
  for (const ch of str) w += (table[ch] != null ? table[ch] : 500);
  return w * FONT_PT / 1000;
}

/** Word сияқты жадный жол бөлу (бос орындарда), нақты әріп ендерімен. */
function wrapLines(text, _cpl, firstIndent = 0, bold = false) {
  const table = bold ? BOLD : REG;
  const space = (table[' '] != null ? table[' '] : 250) * FONT_PT / 1000;
  const words = String(text).split(/\s+/).filter(Boolean);
  let lines = 1;
  let cur = firstIndent ? INDENT_PT : 0;
  let empty = true;
  for (const w of words) {
    const ww = textWidth(w, table);
    const add = empty ? ww : space + ww;
    if (cur + add > LINE_W_PT && !empty) {
      lines++;
      cur = ww;
    } else {
      cur += add;
    }
    empty = false;
  }
  return lines;
}

function blockLines(b) {
  switch (b.type) {
    case 'h1': return { lines: wrapLines(String(b.text).toUpperCase(), 0, 0, true), after: H1_SPACE, before: H1_BEFORE };
    case 'h2': return { lines: wrapLines(b.text, 0, 1, true), after: H2_SPACE, before: H2_BEFORE };
    case 'ref':
    case 'p':
    default: return { lines: wrapLines(b.text, 0, 1, false), after: 0 };
  }
}

/**
 * blocks: [{type:'h1'|'h2'|'p'|'ref', text}] — бет №1 = мәтіннің бірінші беті.
 * Қайтарады: { pages, lastFill (0..1), used (жол), headingPages:[page per heading block index], total }
 */
function paginate(blocks) {
  let page = 1;
  let y = 0; // осы беттегі пайдаланылған жол
  const headingPages = new Map();
  const forced = new Set();
  let total = 0;

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const { lines, after, before = 0 } = blockLines(b);
    const isHead = b.type === 'h1' || b.type === 'h2';
    const bef = y > 0 ? before : 0;
    const need = lines + after + bef;
    total += need;

    if (isHead) {
      // keepNext: тақырып + келесі абзацтың кемінде 2 жолы бір бетке сыюы керек
      const next = blocks[i + 1];
      const nextMin = next ? Math.min(2, blockLines(next).lines) : 0;
      let used = need;
      // Шекарада тұрған тақырып (қалған орын < 1.2 жол) Word пен басқа редакторларда әртүрлі шешілуі мүмкін →
      // мазмұндағы бет нөмірі дәл болуы үшін оны нақты жаңа бетке көшіреміз (pageBreakBefore).
      if (y > 0 && PAGE_LINES - (y + need + nextMin) < 1.2) { page++; y = 0; used = lines + after; forced.add(i); }
      headingPages.set(i, page);
      y += used;
      if (y >= PAGE_LINES) { page++; y = y - PAGE_LINES; }
      continue;
    }

    // жай абзац: беттен асса бөлінеді (orphan/widow: кемінде 2 жол)
    let remaining = lines;
    while (remaining > 0) {
      const free = PAGE_LINES - y;
      let fit = Math.floor(free + 1e-6);
      if (fit >= remaining) { y += remaining; remaining = 0; break; }
      if (fit < 2 || remaining - fit < 2) {
        // widow/orphan: не 2-ден аз қалады, не 2-ден аз өтеді
        if (fit >= 2 && remaining - fit === 1) fit = fit - 1;
        else if (fit < 2) fit = 0;
      }
      if (fit <= 0) { page++; y = 0; continue; }
      remaining -= fit;
      page++;
      y = 0;
    }
  }
  return {
    pages: page,
    lastFill: Math.min(1, y / PAGE_LINES),
    usedLastPage: y,
    headingPages,
    forced,
    total,
  };
}

const SENT_SPLIT = /(?<=[.!?…»”"])\s+(?=[A-ZА-ЯЁӘІҢҒҮҰҚӨҺ«“"0-9\[])/u;

function splitSentences(text) {
  return String(text).split(SENT_SPLIT).map(s => s.trim()).filter(Boolean);
}

module.exports = { paginate, blockLines, wrapLines, splitSentences, PAGE_LINES, CPL, INDENT_CHARS };
