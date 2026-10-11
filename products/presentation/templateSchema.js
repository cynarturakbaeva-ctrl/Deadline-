'use strict';
/**
 * Шаблон қораптарының РӨЛДІК схемасы (Template → Content, v2).
 *
 * Бұрын әр слайдтың мәтін қораптары бір жалпақ тізім ретінде («13 пункт: label ≤27, label ≤13 …»)
 * LLM-ге берілетін: мәзір, логотип жазуы, «FILM» батырмасы, «92%» саны, «PRESENTATION BY» — бәрі «пункт».
 * LLM оны орындай алмайды да, мәтін РЕТ бойынша шашылады (тақырыпша орнына ұзын сөйлем, бос батырмалар, …).
 *
 * Мұнда әр қорапқа мағыналық РӨЛ беріледі:
 *   chrome  — әр слайдта бір орында қайталанатын ұсақ мәтін (бренд, мәзір, «RECORD»): бүкіл слайдтарға БІР мән
 *   tag     — шағын «таблетка»/эллипс ішіндегі белгі сөз («FILM»): қайталанса — бүкіл слайдтарға бір мән
 *   title   — слайд тақырыбы (ең ірі, сәндік жазу ЕМЕС қаріп)
 *   accent  — тақырыптың үстіндегі/жанындағы сәндік жазу (script) сөзі («Manifesto»)
 *   subtitle— тақырыптың астындағы/жанындағы қысқа сөйлем
 *   card    — тақырыпша + мәтін жұбы («Kinetic Commercial» + абзац)
 *   stat    — сан + түсіндірме («92%» + «ABOUT»)
 *   credit  — титул/соңғы слайдта: «PRESENTATION BY» + «MATTHEW COLLINS» (орындаған/тексерген)
 *   body    — ұзын мәтін;  label — қысқа тіркес
 * Қораптың id-і = templateFill.classify(xml).content ішіндегі реті (толтырушымен бірдей).
 */
const T = require('./templateFill');
const QA = require('./templateCheck');
const L = require('./templateLayout');
const { orderedSlides } = require('../../design-dna/structure');
const { embeddedMetrics } = require('./embeddedMetrics');
const { templateFontStyles, styleOf } = require('./fontStyle');
const { materializePlaceholders } = require('./phGeometry');

const STAT_RE = /^[~≈<>+\-−]?\s*[$€£₸¥]?\s*\d[\d\s.,]*\s*(%|[kKmMbB]\b|млн|млрд|мың|x|×|\+)?(\s*\/\s*[^\d].{0,20})?$/u;
const CREDIT_RE = /(presented|presentation|prepared|written|created|designed|made|submitted|produced|directed)\s*by|^\s*by\b|author|student|teacher|lecturer|supervisor|professor|instructor|advis|орындаған|тексерген|дайындаған|қабылдаған|жетекші|выполнил|проверил|студент|преподаватель|руководитель/i;
const PERSON_RE = /^(?:[A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){1,2}|[A-Z]{2,}(?:\s+[A-Z]{2,}){1,2}|[А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі]+(?:\s+[А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі.]+){1,2})$/u;
const THANKS_RE = /thank|thanks|спасибо|рахмет|назарлар|questions?\b|q\s*&\s*a|the end|сұрақ/i;

const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
const szPt = (block) => { const m = block.match(/ sz="(\d+)"/); return m ? +m[1] / 100 : 18; };
const faceOf = (block) => (block.match(/<a:latin [^>]*typeface="([^"]+)"/) || [])[1] || '';
const isBold = (block) => / b="(1|true)"/.test(block);
const xOverlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
const contains = (o, i, tol) => o.x <= i.x + tol && o.y <= i.y + tol && o.x + o.w >= i.x + i.w - tol && o.y + o.h >= i.y + i.h - tol;
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** Бір слайдтың мәтін қораптарының белгілері. */
function featuresOf(xml, W, H, styles) {
  const cl = T.classify(xml, { W, H });
  const items = L.topItems(xml);
  const holders = items.filter((it) => it.box && it.tag !== 'p:pic' && !/<a:blip\b/.test(it.block)
    && !/<a:t>[^<]*\S[^<]*<\/a:t>/.test(it.block) && it.box.w * it.box.h < W * H * 0.08);
  const boxes = cl.content.map((s) => s.x).filter(Boolean);
  const feats = cl.content.map((s, id) => {
    if (!s.x) return null;                                                     // орны мүлде белгісіз (мұрасы да жоқ) — рөл берілмейді
    const text = decode(s.text).replace(/\s+/g, ' ').trim();
    const big = szPt(s.block) >= 30;
    const cap = Math.max(4, T.capacityChars(s.block, big ? 0.7 : 0.8, undefined, T.roomFor(xml, s.block, W, H)) || 0);
    const box = s.x;
    const face = faceOf(s.block);
    return {
      id, text, len: text.length, sz: szPt(s.block), face, style: styleOf(styles, face), bold: isBold(s.block),
      // «таблетка»: ІШІНДЕ тек осы мәтін тұрған шағын пішін (карточка жақтауында бірнеше мәтін болады)
      oneLine: (box.h / 12700) < szPt(s.block) * 2.1,                      // шаблонда бір жолға арналған қорап
      box, cap, holder: holders.some((h) => contains(h.box, box, 60000) && boxes.filter((b) => contains(h.box, b, 60000)).length === 1),
    };
  });
  return { cl, feats: feats.filter(Boolean) };
}

function nearBy(a, b) { // вертикаль ара (EMU): b a-ның астында болса оң
  return b.box.y - (a.box.y + a.box.h);
}

/**
 * @param {Buffer|Map} template — .pptx буфері немесе readZipAll нәтижесі
 * @returns {{ W, H, slides: Array, deck: { chrome: Array, tags: Array } }}
 */
function analyzeTemplate(template) {
  const files = Buffer.isBuffer(template) ? T.readZipAll(template) : template;
  const m = (files.get('ppt/presentation.xml') || '').match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  const W = m ? +m[1] : 12192000; const H = m ? +m[2] : 6858000;
  const metrics = embeddedMetrics(files);
  const styles = templateFontStyles(files, metrics);
  const alpha = new Map();
  const paths = orderedSlides(files);
  const per = paths.map((sp) => featuresOf(QA.hideDeco(materializePlaceholders(files, sp, files.get(sp) || ''), QA.seeThroughIds(files, sp, alpha)).xml, W, H, styles));
  const n = per.length;

  // ── 1) chrome: бір орында ≥40% слайдта (≥3) қайталанатын ұсақ мәтін ─────────────
  const need = Math.max(3, Math.ceil(n * 0.4));
  const same = (f, g) => Math.abs(f.box.x - g.box.x) < W * 0.015 && Math.abs(f.box.y - g.box.y) < H * 0.015 && Math.abs(f.box.w - g.box.w) < W * 0.03 && f.face === g.face;
  const chromeKeys = [];               // [{ key, rep: feat, members: [{slide,id}] }]
  if (n >= 3) {
    per.forEach((p, si) => {
      const maxSz = Math.max(...p.feats.map((f) => f.sz), 1);
      for (const f of p.feats) {
        if (f.chrome) continue;
        const small = f.sz <= Math.max(maxSz * 0.35, 1) && f.len <= 40;
        const edge = f.box.y < H * 0.16 || f.box.y + f.box.h > H * 0.84;
        const members = [];
        per.forEach((q, sj) => {
          const g = q.feats.find((x) => !x.chrome && same(f, x) && (x.text === f.text || (small && edge && x.len <= 40)));
          if (g) members.push({ slide: sj, id: g.id, f: g });
        });
        if (members.length >= need && (members.every((x) => x.f.text === f.text) || (small && edge))) {
          const key = `ch${chromeKeys.length + 1}`;
          for (const x of members) { x.f.chrome = key; }
          chromeKeys.push({ key, rep: f, members });
        }
        void si;
      }
    });
  }

  // ── 2) әр слайдтың рөлдері ───────────────────────────────────────────
  const tagTexts = new Map();
  const slides = per.map((p, si) => {
    const { cl, feats } = p;
    const kind = si === 0 ? 'cover' : (si === n - 1 && feats.some((f) => THANKS_RE.test(f.text)) ? 'end' : si === n - 1 && n > 2 && !feats.some((f) => f.len > 60) && cl.pairs ? 'end' : 'content');
    const free = feats.filter((f) => !f.chrome);
    const role = new Map();                 // id → { role, key, extra }
    const set = (f, r, key, extra) => { role.set(f.id, { role: r, key, ...(extra || {}) }); };
    // tag: шағын пішін ішіндегі қысқа сөз
    for (const f of free) if (f.holder && f.len <= 40 && f.sz <= 40) set(f, 'tag');
    // stat мәні
    for (const f of free) if (!role.has(f.id) && STAT_RE.test(f.text) && f.len <= 24) set(f, 'statv');
    // title / accent
    const rest = () => free.filter((f) => !role.has(f.id));
    const nonScript = rest().filter((f) => f.style.cls !== 'script');
    const scripts = rest().filter((f) => f.style.cls === 'script' && f.sz >= 28);
    let title = null;
    if (!cl.pairs) {
      const cands = nonScript.slice().sort((a, b) => b.sz - a.sz);
      const bodySz = median(rest().map((f) => f.sz));
      if (cands[0] && (cands[0].sz >= 24 || cands[0].sz >= bodySz * 1.3 || rest().length === 1)) title = cands[0];
      if (!title && scripts[0]) title = scripts.slice().sort((a, b) => b.sz - a.sz)[0];
      if (!title) { const st = free.filter((f) => role.get(f.id) && role.get(f.id).role === 'statv').sort((a, b) => b.sz - a.sz)[0]; if (st && rest().length === 0) { role.delete(st.id); title = st; } }
      if (title) set(title, 'title', 't');
    }
    let ak = 0;
    for (const f of scripts) if (!role.has(f.id)) set(f, 'accent', `a${++ak}`);
    // card: мәтін блогы + оның ЕҢ ЖАҚЫН үстіндегі тақырыпшасы (арасында басқа мәтін жоқ)
    const rowKey = (f) => Math.round(f.box.y / (H * 0.05)) * 1000 + f.box.x / W;
    const pairs = [];
    const usedH = new Set();
    for (const b of (kind === 'content' ? rest() : []).sort((a, c) => rowKey(a) - rowKey(c))) {
      const between = (h) => rest().some((o) => o !== h && o !== b && o.box.y > h.box.y && o.box.y + o.box.h <= b.box.y + b.box.h * 0.2 && xOverlap(o.box, b.box) > 0.3 * Math.min(o.box.w, b.box.w));
      const h = rest().filter((x) => x !== b && !usedH.has(x.id) && x.len <= 60 && x.box.y + x.box.h * 0.6 <= b.box.y
          && xOverlap(x.box, b.box) >= 0.4 * Math.min(x.box.w, b.box.w)
          && ((x.bold && !b.bold) || x.sz >= b.sz * 1.12 || (x.len * 2 < b.len && x.sz >= b.sz)))
        .map((x) => ({ x, d: nearBy(x, b) })).filter((o) => o.d <= Math.max(2.2 * o.x.box.h, H * 0.1) && !between(o.x))
        .sort((a, c) => a.d - c.d)[0];
      if (!h) continue;
      usedH.add(h.x.id);
      pairs.push([h.x, b]);
    }
    pairs.sort((a, c) => rowKey(a[0]) - rowKey(c[0]));
    pairs.forEach(([h, b], k) => { set(h, 'card', `c${k + 1}h`, { part: 'heading' }); set(b, 'card', `c${k + 1}b`, { part: 'body' }); });
    // stat: мән + оның жанындағы түсіндірме
    let nk = 0;
    for (const v of free.filter((f) => role.get(f.id) && role.get(f.id).role === 'statv').sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y)) {
      const k = `n${++nk}`;
      role.set(v.id, { role: 'stat', key: `${k}v`, part: 'value' });
      const lab = rest().filter((f) => f.len <= 130 && (xOverlap(v.box, f.box) >= 0.3 * Math.min(v.box.w, f.box.w) || Math.abs((f.box.x + f.box.w / 2) - (v.box.x + v.box.w / 2)) < v.box.w))
        .map((f) => ({ f, d: Math.min(Math.abs(nearBy(v, f)), Math.abs(nearBy(f, v))) }))
        .filter((x) => x.d < H * 0.12).sort((a, b) => a.d - b.d)[0];
      if (lab) set(lab.f, 'stat', `${k}l`, { part: 'label' });
    }
    // credit (титул/соңғы слайд): «PRESENTATION BY» + «MATTHEW COLLINS»
    let ck = 0;
    if (kind !== 'content') {
      const labels = rest().filter((f) => CREDIT_RE.test(f.text) && f.len <= 40);
      for (const lab of labels.sort((a, b) => a.box.x - b.box.x || a.box.y - b.box.y)) {
        const val = rest().filter((f) => f !== lab && f.len <= 40 && xOverlap(lab.box, f.box) > 0.3 * Math.min(lab.box.w, f.box.w))
          .map((f) => ({ f, d: Math.abs(nearBy(lab, f)) })).filter((x) => x.d < H * 0.1).sort((a, b) => a.d - b.d)[0];
        ck++;
        set(lab, 'credit', `cr${ck}l`, { part: 'label' });
        if (val) set(val.f, 'credit', `cr${ck}v`, { part: 'value' });
      }
      // белгісіз титул жолдары (компания, сала, т.б.) — титул ақпараты орны (орындаған/тексерген/топ…)
      void PERSON_RE;
    }
    // subtitle: тақырыпқа ең жақын орташа қаріпті қысқа тіркес (немесе логотиптің астындағы жол)
    const anchor = title || (cl.pairs && cl.pairs[0] ? { box: cl.pairs[cl.pairs.length - 1].dsp.x, sz: szPt(cl.pairs[0].dsp.block) } : null);
    if (anchor) {
      const bodySz = Math.min(...rest().map((f) => f.sz), 99);
      const cand = rest().filter((f) => f.len <= 90 && f.sz < anchor.sz && (f.sz > bodySz * 1.05 || rest().length <= 2) && !CREDIT_RE.test(f.text) && !(kind !== 'content' && PERSON_RE.test(f.text)))
        .map((f) => ({ f, d: Math.abs(nearBy(anchor, f)) + (xOverlap(anchor.box, f.box) > 0 ? 0 : H * 0.2) }))
        .filter((x) => x.d < H * 0.25)
        .sort((a, b) => a.d - b.d)[0];
      if (cand) set(cand.f, 'subtitle', 's');
    }
    // қалғаны: body (ұзын) / label (қысқа)
    let bk = 0; let lk = 0;
    for (const f of rest().sort((a, b) => rowKey(a) - rowKey(b))) {
      if (kind !== 'content' && f.len <= 60) set(f, 'info', `i${++lk}`);
      else if (f.len > 60 || f.cap >= 90) set(f, 'body', `b${++bk}`);
      else set(f, 'label', `l${++lk}`);
    }
    // tag кілттері: бірдей мәтінді белгілер бүкіл слайдтарда бір мән алады
    for (const f of feats) {
      const r = role.get(f.id);
      if (!r || r.role !== 'tag') continue;
      const tkey = f.text.toLowerCase();
      if (!tagTexts.has(tkey)) tagTexts.set(tkey, { key: `tg${tagTexts.size + 1}`, orig: f.text, max: f.cap, count: 0 });
      const t = tagTexts.get(tkey); t.count++; t.max = Math.min(t.max, f.cap);
      r.key = t.key; r.deck = true;
    }

    const slots = [];
    for (const f of feats) {
      if (f.chrome) { slots.push({ key: f.chrome, id: f.id, role: 'chrome', deck: true, max: f.cap, min: 0, orig: f.text, oneLine: f.oneLine, xRel: f.box.x / W, yRel: f.box.y / H }); continue; }
      const r = role.get(f.id);
      if (!r) continue;
      const big = f.sz >= 30;
      // бір жолға арналған тақырып/сәндік сөз: LLM-ге БІР жолдың сыйымдылығы (кегль ~80%-ға дейін кішірейе алады)
      const oneLineChars = Math.max(4, Math.floor((f.box.w / 12700 - 14) / (f.sz * 0.8 * (f.style.cls === 'serif' || f.style.cls === 'script' ? 0.5 : 0.56) * 1.04)));
      if ((r.role === 'title' || r.role === 'accent') && f.oneLine) f.cap = Math.min(f.cap, oneLineChars);
      const min = (r.role === 'body' || (r.role === 'card' && r.part === 'body')) && f.cap >= 90 ? Math.round(Math.min(f.cap, 320) * 0.45) : 0;
      const max = r.role === 'title' && big ? f.cap : f.cap;
      slots.push({ key: r.key, id: f.id, role: r.role, part: r.part || null, deck: !!r.deck, max: Math.min(max, 320), min, orig: f.text, sz: f.sz, script: f.style.cls === 'script', oneLine: f.oneLine });
    }
    // логотип (бас әріп + сөз)
    let logo = null;
    if (cl.pairs) {
      const plan = T.planTemplateSlots ? null : null; void plan;
      const wordMax = cl.pairs.map((pp) => {
        const sz = szPt(pp.dsp.block);
        const availPt = (pp.end - (pp.ini.x.x + (pp.dsp.x.x - pp.ini.x.x) * 0.4)) / 12700;
        return Math.max(3, Math.min(14, Math.floor(availPt / (sz * 0.4 * 0.704 * 1.04 * 1.12))));
      });
      logo = { words: cl.pairs.length, wordMax: Math.min(...wordMax) };
    }
    return { index: si + 1, kind, logo, slots, profile: profileOf(logo, slots) };
  });

  const chrome = chromeKeys.map((c) => ({
    key: c.key, orig: c.rep.text, slides: c.members.map((x) => x.slide + 1),
    max: Math.min(...c.members.map((x) => x.f.cap)), x: c.rep.box.x / W, y: c.rep.box.y / H, bold: c.rep.bold,
  }));
  const tags = [...tagTexts.values()].map((t) => ({ key: t.key, orig: t.orig, max: t.max, count: t.count }));
  // бір рет қана кездесетін белгі — слайдтың өз слоты (бүкіл презентацияға ортақ емес)
  const multi = new Set(tags.filter((t) => t.count > 1).map((t) => t.key));
  for (const sl of slides) for (const x of sl.slots) if (x.role === 'tag') x.deck = multi.has(x.key);
  return { W, H, slides, deck: { chrome, tags } };
}

/** Слайдтың қысқаша формасы (әңгіме желісін жоспарлау үшін). */
function profileOf(logo, slots) {
  const c = (r, p) => slots.filter((s) => s.role === r && (!p || s.part === p)).length;
  const parts = [];
  if (logo) parts.push(`giant lettering title of ${logo.words} short word(s)`);
  if (c('title')) parts.push('title');
  if (c('accent')) parts.push(`${c('accent')} decorative calligraphic word(s) next to the title`);
  if (c('subtitle')) parts.push('subtitle');
  if (c('card', 'heading')) parts.push(`${c('card', 'heading')} card(s): heading + text`);
  if (c('stat', 'value')) parts.push(`${c('stat', 'value')} key figure(s) with a caption`);
  if (c('body')) parts.push(`${c('body')} text block(s)`);
  if (c('label')) parts.push(`${c('label')} short label(s)`);
  if (c('credit', 'value') || c('info')) parts.push('author credits');
  return parts.join('; ') || 'visual slide with little text';
}

/**
 * Жалпы мазмұн генераторына (gemini) арналған ЖҰМСАҚ нұсқау: слайдқа қандай ФАКТІЛЕР керек
 * (карточка саны, сандар, абзацтар). Нақты қорапқа сыйғызуды кейін templateWriter жасайды.
 */
function schemaRuleLine(sch) {
  const c = (r, p) => sch.slots.filter((s) => s.role === r && (!p || s.part === p));
  const lim = (x) => (x ? (x.min ? `${x.min}–${x.max}` : `≤ ${x.max}`) : 'short');
  const head = [];
  const t = c('title')[0];
  if (sch.logo) head.push(`title of ${sch.logo.words} short word(s), each ≤ ${sch.logo.wordMax} letters`);
  else if (t) head.push(`title ≤ ${t.max} chars${c('accent').length ? ' + one decorative word completing it' : ''}`);
  const items = [];
  if (c('subtitle').length) items.push(`subtitle ${lim(c('subtitle')[0])} chars`);
  for (const h of c('card', 'heading')) {
    const b = sch.slots.find((x) => x.key === h.key.replace(/h$/, 'b'));
    items.push(`"Heading: text" (heading ≤ ${h.max}, text ${lim(b)} chars)`);
  }
  for (const v of c('stat', 'value')) items.push(`a REAL figure ≤ ${v.max} chars (year, date, %, count) with what it measures`);
  for (const b of c('body')) items.push(`paragraph ${lim(b)} chars`);
  for (const l of c('label')) items.push(`short phrase ≤ ${l.max} chars`);
  const kind = sch.kind === 'cover' ? 'cover' : sch.kind === 'end' ? 'closing slide' : 'content';
  return `Slide ${sch.index} (${kind}): ${head.join('; ') || 'no title box'}${items.length ? `; bullets in this order: ${items.join(' | ')}` : '; no body text'}.`;
}

module.exports = { analyzeTemplate, featuresOf, profileOf, schemaRuleLine, STAT_RE, CREDIT_RE, PERSON_RE };
