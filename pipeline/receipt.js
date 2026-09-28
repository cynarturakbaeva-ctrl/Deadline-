'use strict';

/**
 * Kaspi чегін (PDF) автоматты оқу және тексеру.
 *
 * Екі бөлек қадам:
 *   1) extractPdfText(buffer)  — PDF-тен мәтін алу (pdf-parse)
 *   2) parseReceiptText(text)  — мәтіннен өрістерді бөлу (таза функция, тестке оңай)
 *   3) validateReceipt(parsed, opts) — сома / алушы / уақыт / күйін тексеру
 *
 * Егер PDF-те мәтін қабаты болмаса (сурет), extractPdfText бос жол қайтарады —
 * бот мұндайда админге қолмен растауға жібереді (fallback).
 */

// ─── PDF → мәтін ──────────────────────────────────────────────────────────
async function extractPdfText(buffer) {
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch (e) {
    console.error('[Receipt] pdf-parse орнатылмаған:', e.message);
    return '';
  }
  try {
    const data = await pdfParse(buffer);
    return (data && data.text) ? String(data.text) : '';
  } catch (e) {
    console.error('[Receipt] PDF оқу қатесі:', e.message);
    return '';
  }
}

// ─── Көмекші ──────────────────────────────────────────────────────────────
function norm(s) {
  return String(s || '')
    .replace(/\u00a0/g, ' ')          // non-breaking space
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Кирилл/латын "twin" әріптерін теңестіру (М, а, о, е, р, с, у, х)
const TWIN = {
  'a': 'а', 'c': 'с', 'e': 'е', 'o': 'о', 'p': 'р', 'x': 'х', 'y': 'у',
  'm': 'м', 'h': 'н', 'k': 'к', 't': 'т', 'b': 'в',
};
function normName(s) {
  return norm(s)
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[a-z]/g, (ch) => TWIN[ch] || ch)
    .replace(/\s+/g, ' ')
    .trim();
}

// Кирилл сөздің ішінде кездейсоқ латын әрпі (мыс. "Мурзабeк" — латын e)
// болса, кирилл regex-і сөзді таппай қалады. Кирилл әріпке жапсарлас тұрған
// латын twin-әріптерді кириллге ауыстырамыз.
const LAT2CYR = { a:'а', c:'с', e:'е', o:'о', p:'р', x:'х', y:'у', A:'А', B:'В', C:'С', E:'Е', H:'Н', K:'К', M:'М', O:'О', P:'Р', T:'Т', X:'Х' };
function fixMixedScript(s) {
  const CYR = '[А-Яа-яЁёӘәІіҢңҒғҮүҰұҚқӨөҺһ]';
  const re = new RegExp(`(${CYR})([A-Za-z])|([A-Za-z])(${CYR})`, 'g');
  let prev, cur = String(s);
  // бірнеше рет (тізбектелген латын әріптер үшін)
  do {
    prev = cur;
    cur = cur.replace(re, (m, c1, l1, l2, c2) => {
      if (c1 !== undefined) return c1 + (LAT2CYR[l1] || l1);
      return (LAT2CYR[l2] || l2) + c2;
    });
  } while (cur !== prev);
  return cur;
}

// "1 250 ₸", "250 ₸", "250,00 ₸", "250.00 T" → 250
function parseAmount(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/\u00a0/g, ' ');
  s = s.replace(/[₸Tт]/gi, '').replace(/\s+/g, '');
  s = s.replace(',', '.');
  const m = s.match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Math.round(parseFloat(m[0]));
  return Number.isFinite(n) ? n : null;
}

// "28.09.2026 02:50" → Date (Астана = UTC+5)
function parseAstanaDate(raw) {
  const m = String(raw || '').match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi] = m;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:00+05:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Мәтін → өрістер ──────────────────────────────────────────────────────
/**
 * Kaspi чегінің мәтіні жол-жол шығады, кейде "белгі" мен "мән" бөлек жолда
 * болады, кейде бір жолда. Екі жағдайды да қолдау үшін алдымен бірнеше
 * regex-ті бүкіл мәтінге қолданамыз.
 */
function parseReceiptText(rawText) {
  const text = norm(rawText).replace(/\r/g, '');
  const flat = fixMixedScript(text.replace(/\n+/g, ' '));
  const out = {
    ok: false,
    receiptNo: null,
    amount: null,
    date: null,
    dateRaw: null,
    recipient: null,
    sender: null,
    commission: null,
    successful: false,
    raw: text,
  };
  if (!text) return out;

  // Сәтті орындалды ма? ("Успешно совершен" / "Сәтті" / "Successful")
  out.successful = /успешно\s+совершен|сәтті|successful/i.test(flat);

  // № квитанции: 12–20 таңбалы сан
  let m = flat.match(/(?:№|N[°ºо]?|No\.?)\s*квитанц[а-я]*\s*:?\s*(\d{9,20})/i)
       || flat.match(/квитанц[а-я]*\s*:?\s*(\d{9,20})/i)
       || flat.match(/\b(\d{15,20})\b/);
  if (m) out.receiptNo = m[1];

  // Дата
  m = flat.match(/(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2})/);
  if (m) {
    out.dateRaw = m[1];
    out.date = parseAstanaDate(m[1]);
  }

  // Сома: "250 ₸" — ең үлкен "₸"-ті сома деп аламыз (комиссия әдетте 0 ₸)
  const amounts = [];
  const amtRe = /(\d[\d\s]*(?:[.,]\d{1,2})?)\s*[₸Т]/g;
  let am;
  while ((am = amtRe.exec(flat)) !== null) {
    const v = parseAmount(am[1]);
    if (v !== null) amounts.push({ v, idx: am.index });
  }
  if (amounts.length) {
    // Комиссияның мәнін бөлек алу
    const comm = flat.match(/комисси[а-я]*\s*:?\s*(\d[\d\s]*(?:[.,]\d{1,2})?)\s*[₸Т]/i);
    if (comm) out.commission = parseAmount(comm[1]);
    // Бірінші (әдетте жоғарғы жасыл блоктағы) сомасы
    out.amount = amounts[0].v;
  }

  // Алушы: чек жоғарында аты-жөні тұрады ("Мурзабек Н."). Сонымен қатар
  // "Получатель" белгісі болуы мүмкін.
  m = flat.match(/получател[ья]\s*:?\s*([А-ЯЁӘІҢҒҮҰҚӨҺA-Z][А-Яа-яЁёӘәІіҢңҒғҮүҰұҚқӨөҺһA-Za-z\-]+\s+[А-ЯЁӘІҢҒҮҰҚӨҺA-Z]\.?)/);
  if (m) out.recipient = m[1];

  if (!out.recipient) {
    // Сома блогынан кейінгі бірінші "Фамилия И." үлгісі
    const nameRe = /([А-ЯЁӘІҢҒҮҰҚӨҺ][а-яёәіңғүұқөһ\-]+)\s+([А-ЯЁӘІҢҒҮҰҚӨҺ])\.?(?=\s|$)/g;
    let nm;
    const cands = [];
    while ((nm = nameRe.exec(flat)) !== null) cands.push(nm[0]);
    // "Отправитель" жолындағы аты бөлек — оны алып тастаймыз
    const senderM = flat.match(/отправител[ья]\s*:?\s*([А-ЯЁӘІҢҒҮҰҚӨҺ][а-яёәіңғүұқөһ\-]+\s+[А-ЯЁӘІҢҒҮҰҚӨҺ]\.?)/i);
    if (senderM) out.sender = senderM[1];
    const filtered = cands.filter((c) => !senderM || normName(c) !== normName(senderM[1]));
    if (filtered.length) out.recipient = filtered[0];
  }

  if (!out.sender) {
    const s = flat.match(/отправител[ья]\s*:?\s*([А-ЯЁӘІҢҒҮҰҚӨҺ][а-яёәіңғүұқөһ\-]+\s+[А-ЯЁӘІҢҒҮҰҚӨҺ]\.?)/i);
    if (s) out.sender = s[1];
  }

  out.ok = !!(out.receiptNo && out.amount !== null && out.date);
  return out;
}

// ─── Тексеру ──────────────────────────────────────────────────────────────
/**
 * @param {object} parsed  parseReceiptText нәтижесі
 * @param {object} opts
 *   expectedName   — күтілетін алушы ("Мурзабек Н")
 *   allowedAmounts — рұқсат етілген соммалар (мыс. [100, 250, 500, ...])
 *   maxAgeMin      — чек қанша минуттан ескі болмауы керек (әдепкі 60)
 *   now            — тест үшін ағымдағы уақыт
 * @returns {{ ok: boolean, reason?: string, credits?: number }}
 */
function validateReceipt(parsed, opts = {}) {
  const {
    expectedName,
    allowedAmounts,
    maxAgeMin = 60,
    now = new Date(),
    pricePerCredit,
    firstPrice,
    isFirstPurchase = false,
    maxCredits = 50,
  } = opts;

  if (!parsed || !parsed.ok) return { ok: false, reason: 'unreadable' };
  if (!parsed.successful)    return { ok: false, reason: 'not_successful' };

  // Алушы
  if (expectedName) {
    if (!parsed.recipient) return { ok: false, reason: 'no_recipient' };
    if (normName(parsed.recipient) !== normName(expectedName)) {
      return { ok: false, reason: 'wrong_recipient' };
    }
  }

  // Уақыт: болашақта болмауы керек (1 мин допуск) және тым ескі емес
  const ageMin = (now.getTime() - parsed.date.getTime()) / 60000;
  if (ageMin < -2)         return { ok: false, reason: 'future_date' };
  if (ageMin > maxAgeMin)  return { ok: false, reason: 'too_old' };

  // Сома → кредит саны
  const amount = parsed.amount;
  if (Array.isArray(allowedAmounts) && allowedAmounts.length) {
    if (!allowedAmounts.includes(amount)) return { ok: false, reason: 'bad_amount' };
  }

  let credits = 0;
  if (pricePerCredit) {
    if (isFirstPurchase && firstPrice && amount === firstPrice) {
      credits = 1;
    } else if (amount % pricePerCredit === 0) {
      credits = amount / pricePerCredit;
    } else {
      return { ok: false, reason: 'bad_amount' };
    }
    if (credits < 1 || credits > maxCredits) return { ok: false, reason: 'bad_amount' };
  }

  return { ok: true, credits };
}

module.exports = {
  extractPdfText,
  parseReceiptText,
  validateReceipt,
  // тест үшін
  _internals: { normName, parseAmount, parseAstanaDate },
};
