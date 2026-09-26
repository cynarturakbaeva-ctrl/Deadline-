'use strict';

const { recordApiUsage } = require('./cost');

// ─── DeepSeek клиенті (fetch арқылы, SDK орнатпай) ───────────────────────
// Groq-тан DeepSeek V4-Pro-ға көшірілді — Groq-тың тегін деңгейінің 6000
// TPM шегі рейт-лимит қателерін тудырып тұрғандықтан, ал Developer (ақылы)
// деңгей "high demand" себебінен уақытша жабық болды. DeepSeek V4-Pro:
// ~$0.435/млн input, ~$0.87/млн output — 1 презентация шамамен $0.008-ге
// (≈4₸) түседі, өзіндік rate limit те әлдеқайда жоғары (RPM/TPM шегі
// ресми жарияланбаған, бірақ Groq-тың тегін 6000 TPM-нен әлдеқайда кең).
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_MODEL   = 'deepseek-v4-flash';

// Ескерту: batch-архитектура (SLIDES_PER_BATCH, MAX_TOKENS_PER_CALL) Groq-тың
// тар 6000 TPM лимитін айналып өту үшін жасалған еді. DeepSeek-те бұл шектеу
// жоқ дерлік, бірақ архитектураны сол қалпында қалдырамыз — себебі ол JSON
// сапасын да жақсартады (әр батч азырақ слайдты толық, кесілместен сипаттайды)
// және retry/error-recovery логикасы үшін де пайдалы гранулярлық береді.
//
// МАҢЫЗДЫ ТҮЗЕТУ (2-ретті): 9000 да жеткіліксіз болды — логта generateBatch
// output-ы тұрақты түрде дәл 9000-де тоқтап, finish_reason=length шығып,
// JSON ортасынан кесіліп жатты (retry-мен де қайталанып қойды — демек бұл
// кездейсоқтық емес, JSON-ның нақты өзі 9000 токеннен асып түседі).
// DeepSeek V4 Flash-тың ресми максимум output шегі 393216 токен (документте
// расталған), ал API ақылы болғандықтан, шығынды үнемдеу мақсатымен жасанды
// төмен санды ұстау қажеті жоқ — JSON қаншалықты керек болса, сонша жазып,
// табиғи түрде (finish_reason="stop") тоқтауы үшін лимитті моделдің нақты
// максимумына қойдық. Бұл "шексіздікке" тең — API-нің өзінде max_tokens
// параметрі міндетті болғандықтан толық алып тастау мүмкін емес, бірақ
// осы мән тәжірибеде шектеу жоқтай әсер етеді.
const MAX_TOKENS_PER_CALL = 393216;
const SLIDES_PER_BATCH    = 3;

const REQUEST_TIMEOUT_MS = 90_000; // 90 sek — kalypty generaciya ~10-30 sek alady

async function groqChat(systemPrompt, userPrompt, label) {
  // МАҢЫЗДЫ ТҮЗЕТУ: нақты байқалған жағдайда DeepSeek API 12 МИНУТ бойы
  // ешбір жауап бермей "ілініп" қалды (network hang немесе серверлік
  // баяулау), содан кейін бос/жарамсыз content қайтарды. fetch-тің
  // ӨЗІНДЕ timeout болмағандықтан, ол шексіз күтіп тұрды — пайдаланушы
  // 12 минут "Презентация жасалуда..." деп күтіп, содан кейін ғана қате
  // алды. AbortController арқылы 90 секундтық қатаң timeout қоямыз —
  // осы уақыттан асса, withRetry-дегі "isTruncated емес" қатесіз, дереу
  // қайта әрекет ету немесе нақты "timeout" қатесімен тоқтау үшін.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        // DeepSeek V4 сериясында thinking (reasoning) режимі ӘДЕПКІ БОЙЫНША
        // ҚОСУЛЫ тұрады — reasoning_content те max_tokens шегінің ішінде
        // есептеліп, output token ретінде ақыланады. Бізге тек тікелей JSON
        // керек (реасонинг презентация JSON-ы үшін пайдасыз), сондықтан
        // өшіріп қоямыз — max_tokens толығымен нақты JSON-ға жұмсалады.
        thinking: { type: 'disabled' },
        // DeepSeek өз құжатында temperature/top_p үшін 1.0 ұсынады (GPT/Claude
        // әдепкісінен өзгеше) — creative/generation тапсырмаларында дәйектірек
        // нәтиже береді. 0.7 Groq/OpenAI дәстүрінен қалған мән еді.
        temperature: 1.0,
        top_p: 1.0,
        max_tokens: MAX_TOKENS_PER_CALL,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`[timeout] ${label} — DeepSeek ${REQUEST_TIMEOUT_MS / 1000}с ішінде жауап бермеді`);
      timeoutErr.isTimeout = true;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[${res.status}] ${err}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || '';
  const finishReason = data.choices?.[0]?.finish_reason;

  if (data.usage) {
    console.log(`[Tokens] ${label} — input: ${data.usage.prompt_tokens}, output: ${data.usage.completion_tokens}, total: ${data.usage.total_tokens}`);
    recordApiUsage(data.usage, { label, model: DEEPSEEK_MODEL });
  } else {
    recordApiUsage(null, { label, model: DEEPSEEK_MODEL });
  }

  if (finishReason === 'length') {
    // JSON max_tokens шегінде ортасынан кесілген — parseJSON-ға дейін жетсе,
    // регекспен "жөндеп" көреді, бірақ құрылымы бұзылған JSON болғандықтан
    // бәрібір парсинг қатесі шығады. withRetry мұны 429/503 сияқты
    // retry-ланатын қате деп танымайтын, сондықтан осында арнайы белгі
    // қойып лақтырамыз — withRetry соны ұстап, қайта сұрайды (temperature=1.0
    // болғандықтан келесі әрекетте қысқарақ шығуы мүмкін).
    const err = new Error(`[length] ${label} — output max_tokens (${MAX_TOKENS_PER_CALL}) шегінде кесілді (finish_reason=length)`);
    err.isTruncated = true;
    throw err;
  }

  if (!text) {
    // МАҢЫЗДЫ ТҮЗЕТУ: нақты байқалған жағдайда DeepSeek API res.ok=true
    // қайтарды (қате статус жоқ), бірақ content бос болды — бұрын бұл
    // тікелей parseJSON-ға жетіп, retry-сыз дереу сәтсіздікпен аяқталатын
    // (пайдаланушы 12+ минут күтіп, содан кейін ғана қате көретін). Бос
    // жауап та көбіне серверлік уақытша ақаудың белгісі болғандықтан,
    // мұны да retry-ланатын қате етіп белгілейміз.
    const err = new Error(`[empty] ${label} — DeepSeek бос жауап қайтарды (finish_reason: ${finishReason || 'жоқ'})`);
    err.isTimeout = true; // isTimeout белгісін пайдаланамыз — withRetry-де birdei retry logikasy
    throw err;
  }

  return text;
}

// ─── Retry helper ─────────────────────────────────────────────────────────
async function withRetry(fn, label) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      const msg = err.message || '';
      const is503 = msg.includes('503') || msg.includes('fetch failed');
      const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('rate_limit') || msg.includes('Rate limit');
      const isTruncated = err.isTruncated === true;
      const isTimeout = err.isTimeout === true;

      if (!is503 && !is429 && !isTruncated && !isTimeout) throw err;

      // 3 реттен көп кесілсе/timeout болса, циклді тоқтатып, жоғарыға нақты
      // қате беру — шексіз retry-мен пайдаланушыны күттірмеу үшін (нақты
      // байқалған жағдайда timeout 12 минутқа созылды — қайталап 3 рет
      // осылай тоқтап қалса, жиыны 36+ минут болар еді, бұл орынсыз).
      if ((isTruncated || isTimeout) && attempt >= 3) {
        throw new Error(`${msg} — ${attempt} әрекеттен кейін де сәтсіз`);
      }

      let delay = Math.min(5000 * attempt, 30000);
      if (is429) {
        const match = msg.match(/try again in (\d+\.?\d*)s/i) || msg.match(/retry[^0-9]*(\d+)[^0-9]*s/i);
        delay = match ? (parseFloat(match[1]) + 2) * 1000 : 30000;
      } else if (isTruncated || isTimeout) {
        delay = 2000; // rate-limit емес, tez qaita surau jetkilikti
      }

      const reason = is429 ? '429 Rate limit' : isTruncated ? 'length (кесілді)' : isTimeout ? 'timeout' : '503';
      console.warn(`[DeepSeek] ${label} — attempt ${attempt} failed (${reason}). Retry in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// ─── JSON parser ──────────────────────────────────────────────────────────
function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      const preview = text.slice(-200);
      throw new Error(`Invalid JSON from DeepSeek — жауап толық емес немесе бос (соңы: "...${preview}")`);
    }
    try {
      return JSON.parse(match[0]);
    } catch (e) {
      const preview = text.slice(-200);
      throw new Error(`Invalid JSON from DeepSeek — JSON құрылымы бұзылған, ықтимал max_tokens шегінде кесілген (соңы: "...${preview}")`);
    }
  }
}

// ─── Параметрлерді парсинг ────────────────────────────────────────────────
// МАҢЫЗДЫ ТҮЗЕТУ: бұрын `input.split(',')[0]` арқылы бірінші үтірге дейінгі
// бөлікті ғана `topic` деп алатын. Бұл қысқа команда үшін дұрыс еді
// ("тақырып, 10 слайд, қазақша"), бірақ пайдаланушы силлабус/дәріс мәтінін
// толығымен жіберсе (мұнда үтір өте көп кездеседі — тізімдер, сөйлемдер),
// нәтижесінде мәтіннің 90%+ бөлігі "topic"-тен мүлдем тыс қалып, тек
// бірінші сөйлемнің бір бөлігі ғана DeepSeek-ке жететін ("жалпылама тақырып"
// бага дәл осыдан еді).
//
// Жаңа тәсіл: параметрлерді ЕҢ СОҢЫНАН бастап іздейміз — тек соңғы
// бөліктер нақты параметр үлгісіне (сан+"слайд", тіл атауы, стиль атауы)
// сай келсе ғана оларды бөліп аламыз. Сай келмеген сәтте бірден тоқтаймыз
// (одан арғы, алдыңғы бөліктер силлабустың табиғи мәтіні болуы мүмкін,
// оларды параметр деп қате тани алмаймыз). Қалған барлық мәтін (соңынан
// алынған параметрлерсіз) толығымен topic болып сақталады — үтір саны
// қанша болса да.
function parseUserInput(input) {
  const raw = String(input || '');
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);

  let slideCount = null;
  let language   = null;
  let style      = null;

  // Full-text scan first (handles "12 слайдтан тұратын" inside a paragraph)
  const countInText = raw.match(/(\d+)\s*-?\s*(слайд|slide|бет|страниц)/i);
  if (countInText) {
    slideCount = Math.min(Math.max(parseInt(countInText[1], 10), 5), 15);
  }
  if (/минимал|minimal/i.test(raw)) style = style || 'minimal';
  if (/бизнес|корпор|business/i.test(raw)) style = style || 'business';
  if (/креатив|creative/i.test(raw)) style = style || 'creative';
  if (/академ|ғылым|научн|academic/i.test(raw)) style = style || 'academic';
  if (/питч|pitch/i.test(raw)) style = style || 'pitch';
  if (/қазақ|каз|kazakh/i.test(raw)) language = language || 'Kazakh';
  else if (/орыс|рус|russian/i.test(raw)) language = language || 'Russian';
  else if (/ағыл|англ|english/i.test(raw)) language = language || 'English';

  let cut = parts.length; // topic-qa kiretin bolikterdin sany (sonynan kesiledi)

  for (let i = parts.length - 1; i >= 1; i--) { // parts[0]-di hesh kashan parametr etip almaimyz
    const lower = parts[i].toLowerCase();
    let matched = false;

    if (!slideCount) {
      const numMatch = lower.match(/^(\d+)\s*(слайд|slide|бет|страниц)/);
      if (numMatch) { slideCount = Math.min(Math.max(parseInt(numMatch[1]), 5), 15); matched = true; }
    }
    if (!matched && !language) {
      if (/^(қаз|каз|kazakh)/.test(lower)) { language = 'Kazakh'; matched = true; }
      else if (/^(орыс|рус|russian)/.test(lower)) { language = 'Russian'; matched = true; }
      else if (/^(ағыл|англ|english)/.test(lower)) { language = 'English'; matched = true; }
    }
    if (!matched && !style) {
      if (/^(бизнес|корпор|business)/.test(lower)) { style = 'business'; matched = true; }
      else if (/^(минимал|minimal)/.test(lower)) { style = 'minimal'; matched = true; }
      else if (/^(креатив|creative)/.test(lower)) { style = 'creative'; matched = true; }
      else if (/^(академ|ғылым|научн)/.test(lower)) { style = 'academic'; matched = true; }
      else if (/^(питч|pitch)/.test(lower)) { style = 'pitch'; matched = true; }
    }

    if (!matched) break; // sonyndagy bolik parametr emes — odan ari izdemeimiz
    cut = i;
  }

  const topic = parts.slice(0, cut).join(', ');

  return { topic, slideCount, language, style, coverMeta: parseCoverMeta(input) };
}

/** Extract title-page credits from client brief (KK/RU patterns). */
function parseCoverMeta(input) {
  const text = String(input || '');
  const meta = { checkedBy: null, performedBy: null, group: null, faculty: null, department: null };

  // A field value stops at the next known label (on the same or a later
  // line), a comma, or end of line — whichever comes first. This lets
  // single-line, comma-separated briefs ("Факультет: X, Кафедра: Y, ...")
  // parse each field correctly instead of one field swallowing the rest.
  const STOP = '(?:Тексерген|Проверил[аи]?|Checked\\s*by|Орындаған|Выполнил[аи]?|Prepared\\s*by|Автор|Топ|Группа|Group|Факультет|Faculty|Кафедра|Department)\\s*[:：]';
  const VAL = `([^\\n\\r,]+?)(?=\\s*,\\s*${STOP}|[\\n\\r]|$)`;

  const checked = text.match(new RegExp(`Тексерген\\s*[:：]\\s*${VAL}`, 'i'))
    || text.match(new RegExp(`Проверил[аи]?\\s*[:：]\\s*${VAL}`, 'i'))
    || text.match(new RegExp(`Checked\\s*by\\s*[:：]\\s*${VAL}`, 'i'));
  const performed = text.match(new RegExp(`Орындаған\\s*[:：]\\s*${VAL}`, 'i'))
    || text.match(new RegExp(`Выполнил[аи]?\\s*[:：]\\s*${VAL}`, 'i'))
    || text.match(new RegExp(`Prepared\\s*by\\s*[:：]\\s*${VAL}`, 'i'))
    || text.match(new RegExp(`Автор\\s*[:：]\\s*${VAL}`, 'i'));
  const group = text.match(new RegExp(`Топ\\s*[:：]\\s*${VAL}`, 'i'))
    || text.match(new RegExp(`Группа\\s*[:：]\\s*${VAL}`, 'i'))
    || text.match(new RegExp(`Group\\s*[:：]\\s*${VAL}`, 'i'));
  // Yessenov University title-slide convention: faculty + department (kafedra)
  // alongside author/supervisor/group — see presentation-requirements brief.
  const faculty = text.match(new RegExp(`Факультет\\s*[:：]\\s*${VAL}`, 'i'))
    || text.match(new RegExp(`Faculty\\s*[:：]\\s*${VAL}`, 'i'));
  const department = text.match(new RegExp(`Кафедра\\s*[:：]\\s*${VAL}`, 'i'))
    || text.match(new RegExp(`Department\\s*[:：]\\s*${VAL}`, 'i'));

  function cleanMeta(v, max) {
    if (!v) return null;
    let s = String(v).trim();
    // Strip placeholder brackets users often type: [Name], 【Name】
    s = s.replace(/^[\[\(【「]+/, '').replace(/[\]\)】」]+$/, '').trim();
    s = s.replace(/^["']+|["']+$/g, '').trim();
    if (!s || /^[\[\]_\-—–.]+$/.test(s)) return null;
    return s.slice(0, max);
  }
  if (checked) meta.checkedBy = cleanMeta(checked[1], 80);
  if (performed) meta.performedBy = cleanMeta(performed[1], 80);
  if (group) meta.group = cleanMeta(group[1], 40);
  if (faculty) meta.faculty = cleanMeta(faculty[1], 80);
  if (department) meta.department = cleanMeta(department[1], 80);
  return meta;
}

// ─── Стиль нұсқаулары ────────────────────────────────────────────────────
function styleGuide(style) {
  switch (style) {
    case 'business':  return `STYLE: Corporate business. Dark/cold mood. Deep blue, charcoal, white. Clean typography. Data-driven slides.`;
    case 'minimal':   return `STYLE: Minimalist. Light mood. Max whitespace. 2-3 elements per slide. No clutter.`;
    case 'creative':  return `STYLE: Creative/bold. Vivid colors. Bold accents. Variety in layout.`;
    case 'academic':  return `STYLE: Academic/scientific. Blue/teal tones. Data-heavy. Precise language.`;
    case 'pitch':     return `STYLE: Startup pitch. Dark vivid. Bold accent. Short punchy text. Problem→Solution→Market→Ask.`;
    default:          return `STYLE: Professional mixed. Balance visual variety and content clarity.`;
  }
}

const COMPOSITION_RULES = `ART-DIRECTOR COMPOSITION (every slide needs a clear visual purpose):
- composition.image: "full_background" "right_half" "left_half" "top_strip" "bottom_strip" "corner_accent" "none"
- composition.overlay: "none" "dark_gradient_left" "dark_gradient_right" "dark_gradient_bottom" "dark_full" "light_full" "color_wash"
- composition.textPosition: "center" "center_left" "center_right" "top_left" "top_center" "bottom_left" "bottom_center" "left_column" "right_column"
- composition.layout: "single_column" "two_column_bullets" "stat_cards_row" "stat_cards_grid" "big_stat_hero" "quote_hero" "comparison_table"
- composition.visualPurpose (REQUIRED short tag): one of "cover" "section" "definition" "process" "comparison" "timeline" "stats" "hierarchy" "evidence" "example" "synthesis" "conclusion" "quote" "table"
- SEMANTIC MATCH (layout follows meaning, not a template habit):
  • comparison / before-after → table or two clear columns; image "none" or subtle full_background
  • process / steps / pipeline → prefer visual diagram; keep 3-5 short step bullets as fallback
  • hierarchy / system / architecture → diagram visual when possible
  • statistics with REAL numbers only → stats cards or big_stat_hero (one number); never invent figures
  • definition / concept → simple center or left column, generous whitespace, NO card clutter
  • timeline → ordered bullets or diagram; avoid random card grids
  • conclusion → clean takeaways, full_background + strong overlay, no decorative noise
- SPECIAL LAYOUTS (at most 1-2 per deck, only when content truly fits):
  - big_stat_hero: EXACTLY 1 stat, no bullets, no body
  - quote_hero: no bullets/stats; quote in subtitle; attribution in title
  - comparison_table: table filled; bullets/stats null; image "none"
- VARIETY WITH RHYTHM: do NOT repeat the same image type for 3+ consecutive slides. Alternate full_background, split (left/right_half), strip, and none. Cover and closing may use full_background.
- Avoid: identical card grids every slide, pointless corner decorations, random gradients, walls of text, tiny text, generic stock clichés ("handshake business").
- Simple content → simple powerful composition (center, large title, one idea). Dense content → full width, stronger overlay, fewer competing elements.
- imageQuery: English, photographic, topic-true, no baked-in text/charts/screens. Prefer specific scene+mood+lighting over generic "abstract background".
- composition.mood: keep coherent across the deck (max 2 moods). accentColor: one accent family for the whole presentation.
- decorative: use SPARINGLY — at most one of accent_line_left|bottom_rule when it aids hierarchy; otherwise [].`;

const CONTENT_RULES = `CONTENT & LANGUAGE (teach, do not encyclopedia-dump):
- title: 4-8 words, concrete, no vague "Introduction/Overview/Basics" alone
- subtitle: always present, 1 sentence (10-22 words) that advances the idea
- body: optional; 1-2 short sentences max when bullets cannot carry the point
- bullets: 2-4 items, each 5-12 words, one idea each — thesis not filler
- stats: ONLY real numbers from the client brief or universally known facts; labels 2-5 words. If unsure, set stats null
- table: for true comparisons only; 2-4 columns, 2-4 rows, short cells
- NO generic AI openers ("In today's world", "It is important to note", "В современном мире", "Қазіргі заманда")
- NO repeated explanations across adjacent slides
- Prefer bullets over paragraphs; prefer a diagram (visual field) over a long list when the idea is a process/hierarchy/comparison
- Educational flow: explain prerequisites before advanced terms; examples after definitions; conclusion derived from prior slides
- Keep terminology consistent; natural language for the target audience; preserve technical precision
- Set unused fields to null`;

const VISUAL_RULES = `SEMANTIC VISUAL FIELD (diagram only when it teaches faster than text):
- visual is null on MOST slides. Set it when meaning is relational:
  • diagram — process, flow, cycle, hierarchy, architecture, cause→effect (3-6 named parts, clear direction)
  • infographic — 3-6 REAL numbers/facts from THIS slide only
  • map — places/routes as SCHEMATIC only (never fake borders)
- At most ONE visual per batch; never on cover. If in doubt, null.
- Shape: {"type":"diagram|infographic|map","brief":"English: what to draw and the relationship","data":["3-8 short items in presentation language from THIS slide only"]}
- NEVER invent statistics. Prefer qualitative structure over fake numbers.
- Brief must state the relationship (e.g. "left-to-right pipeline: data → model → deploy"), not "nice infographic".
- Slide with visual still needs title, subtitle, 2-4 short bullets as text fallback.`;

const CLIENT_FIRST_RULES = `CLIENT INTENT IS LAW (highest priority — overrides defaults when they conflict):
- The client's message is a BRIEF you must obey: topic, structure, slide count, language, tone, what to include/exclude, syllabus points, names, numbers, dates.
- If the client lists sections/chapters/points — use THEM as the outline. Do not invent a different structure.
- If the client gives facts, quotes, numbers — use those exact facts. Do not replace with generic filler.
- If the client asks for a style (business, minimal, academic, pitch, creative) or mood — follow it.
- If the client asks for short/simple/few bullets — stay even shorter than the limits above.
- If the client asks for detailed/deep content — still keep cinematic brevity, but prioritize their points over decoration.
- Never ignore the client's topic to make a "prettier" generic presentation.
- When unsure, prefer the client's words over your own invention.`;

const SLIDE_JSON_SHAPE = `{
  "index": 1,
  "title": "...",
  "subtitle": "...",
  "body": "...",
  "bullets": ["...", "..."],
  "stats": [{ "value": "...", "label": "..." }],
  "table": { "headers": ["...", "..."], "rows": [["...", "..."], ["...", "..."]] },
  "visual": null,
  "imageQuery": "English photographic query with scene, mood, lighting",
  "visualIntent": "semantic visual concept for the optional 3D web scene",
  "composition": {
    "image": "full_background",
    "overlay": "dark_gradient_left",
    "textPosition": "center_left",
    "layout": "single_column",
    "mood": "dark",
    "accentColor": "#d4a843",
    "elements": ["eyebrow", "title", "divider", "subtitle"],
    "decorative": ["accent_line_left", "corner_circle"]
  }
}`;

// ─── 0. Outline — жеңіл шақыру, тек жоспар (title + әр слайдтың тақырыбы) ──
// Бұл шақыру кішкентай (~300-500 токен шығыс), сондықтан TPM лимитіне
// қатысты тәуекел жоқ. Мақсаты — толық слайдтарды генерациялайтын
// batch-тарға дәйекті, бір-бірімен байланысты жоспар беру, әйтпесе әр
// батч тақырыпты басынан бастап "ойлап табады" да, слайдтар арасында
// логикалық сабақтастық болмайды.
async function generateOutline(topic, slideCount, language, style) {
  const languageRule = language
    ? `Write in ${language}.`
    : `Write in the same language as the topic/material.`;

  const system = `You are a presentation structure planner. You ALWAYS respond with valid JSON only. No markdown, no explanation.`;

  // Academic-style presentations (student coursework/thesis defense, e.g.
  // Yessenov University convention) follow a fixed scholarly section order.
  // Only applied for style === 'academic' — a pitch/business deck should not
  // be forced into "Methodology"/"Literature review" sections.
  const academicStructureRule = style === 'academic'
    ? `
ACADEMIC STRUCTURE (mandatory section order for this style, adapt slide count to fit within ${slideCount} slides — merge adjacent sections if too few slides are available, never drop Methodology, Results, or Conclusion):
1. Cover (title, author/supervisor/faculty — handled separately, do not duplicate credits here)
2. Goal & objectives ("Мақсат және міндеттер")
3. Literature review, if the material has cited sources ("Әдебиеттер шолуы") — optional, include only if source material supports it
4. Methodology ("Әдіснама") — methods, materials, data sources used
5. Results ("Нәтижелер") — one or more slides with findings, data, charts
6. Conclusion ("Қорытынды") — key takeaways and practical recommendations
7. References ("Әдебиеттер тізімі") — final slide, numbered source list
Keep the client's own facts/structure from STEP 1 layered onto this scaffold — do not discard their content, just map it onto these sections.`
    : '';

  // МАҢЫЗДЫ: пайдаланушы кейде тек қысқа тақырып емес, толық материал
  // (силлабус, курс жоспары, дәріс мәтіні) жібереді. Бұрын промпт мұны
  // әрдайым "қысқа тақырып" деп қарастырып, тек соның негізінде жалпы
  // slideTopics ойдан құратын (силлабустың нақты апта/тарау бөлінісі,
  // тапсырмалар мен детальдер жоғалып, орнына жалпылама атаулар келетін —
  // нақты байқалған баг). Енді материалдың КӨЛЕМІНЕ қарай екі режимді
  // нақты ажыратамыз: егер ол құрылымды болса (нөмірленген апта/тарау/
  // бөлім тізімі бар), сол құрылымды дәлме-дәл сақтап, slideTopics-ті
  // содан алу керек — жаңа тақырып ойлап табу емес.
  const user = `CLIENT BRIEF (obey this — it is the customer's request, not a suggestion):
"""
${topic}
"""

PRIORITY: follow the client's structure, facts, language, and intent exactly. Do not replace their plan with a generic template.

STEP 1 — Determine the material type:
- SHORT TOPIC (a few words/sentences, no internal structure) → you must invent a logical structure for it.
- STRUCTURED MATERIAL (syllabus, course outline, lecture notes, numbered weeks/chapters/sections, or any text with its own internal breakdown) → you must PRESERVE that existing structure. Do NOT collapse it into a generic summary. Do NOT invent your own structure when the material already has one.

STEP 2 — Generate exactly ${slideCount} slides. ${languageRule}
Slide 1 must be a cover/intro slide. The last slide must be a closing/summary slide${style === 'academic' ? ' (or references list — see STEP 3)' : ''}.
- If STRUCTURED MATERIAL: map the existing weeks/chapters/sections onto the middle slides in their original order. If there are more sections than available slides, group adjacent sections together rather than dropping content. Keep original section names/numbers (e.g. "Апта 3: ...", "Тарау 2: ...") where present.
- If SHORT TOPIC: design a sensible flow (intro → concepts → details → applications → conclusion, or similar).
${academicStructureRule ? `
STEP 3 — Academic structure applies (style=academic):${academicStructureRule}` : ''}

Return ONLY this JSON:
{
  "title": "Overall presentation title",
  "slideTopics": ["Slide 1 short topic", "Slide 2 short topic", ...]
}

Each slideTopics entry must be specific enough to guide detailed content generation later:
- For STRUCTURED MATERIAL, include the actual section identity AND its key points, e.g. "Апта 3: Нейрондық желілер — перцептрон, активация функциялары, backpropagation" (not just "Нейрондық желілер").
- For SHORT TOPIC, a short 3-6 word description is enough.`;

  const text = await withRetry(() => groqChat(system, user, 'generateOutline'), 'generateOutline');
  const parsed = parseJSON(text);

  if (!parsed?.slideTopics || !Array.isArray(parsed.slideTopics)) {
    throw new Error('Outline missing slideTopics array');
  }

  return parsed;
}

// ─── 1. Generate one batch of fully-detailed slides ────────────────────────
// batchTopics: [{ index, topic }] — осы батчта генерацияланатын слайдтар.
// allTopics: толық тізім — модельге жалпы контекст беру үшін (тек атаулар,
// толық мазмұн емес, сондықтан токен шығыны аз).
// usedImageTypes: алдыңғы батчтарда қолданылған composition.image мәндерінің
// тізімі. МАҢЫЗДЫ: batch-архитектурада әр батч бір-бірінен ЖЕКЕ, контекстсіз
// шақырылады — сол себепті модель әр батчта "қауіпсіз" full_background-ты
// қайта-қайта таңдап, бүкіл презентация бірыңғай болып шығатын (нақты
// байқалған "бәрі фон+мәтін болып қалған" регресс). Бұл параметр әр
// келесі батчқа "мыналар қолданылып қойды, басқасын қолдан" деп айтады.
async function generateSlideBatch(presentationTitle, allTopics, batchTopics, style, language, usedImageTypes) {
  const languageRule = language
    ? `Write ALL text in ${language}. Title, subtitle, body, bullets — everything in ${language}.`
    : `Write content in the same language as the topic.`;

  const system = `You are a professional presentation designer. You ALWAYS respond with valid JSON only. No markdown, no explanation, no code blocks. Just raw JSON.`;

  const contextList = allTopics.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const batchList = batchTopics.map(b => `Slide ${b.index}: ${b.topic}`).join('\n');
  const isFirstBatch = batchTopics[0].index === 1;
  const isLastBatch = batchTopics[batchTopics.length - 1].index === allTopics.length;

  const coverRule = isFirstBatch
    ? `Slide 1 is the COVER slide: full_background, strong overlay, large title + short subtitle (one sentence).`
    : '';

  const lastTopic = allTopics[allTopics.length - 1] || '';
  const isReferencesSlide = isLastBatch && /әдебиеттер тізімі|список литератур|references|bibliography/i.test(lastTopic);
  const closingRule = isLastBatch
    ? (isReferencesSlide
        ? `The LAST slide in this batch (slide ${allTopics.length}) is the REFERENCES / Әдебиеттер slide ONLY.
STRICT RULES for this slide:
- bullets = real bibliographic entries only: Author. Title. — City: Publisher, Year. (or URL from the client brief)
- FORBIDDEN on this slide: presentation outline, slide plan, "Title — opening visual", "Executive overview", "line chart", "timeline", design instructions, structure of the deck, English meta prompts
- If the client brief does NOT list real sources, put 2–4 well-known public sources relevant to the TOPIC (e.g. official reports, classic works) OR leave bullets as short topic-relevant source titles without fake years — NEVER dump the outline
- title must be "Әдебиеттер тізімі" / "References" — not a conclusion
- No body essay; no stats; no table`
        : `The LAST slide in this batch (slide ${allTopics.length}) is the CLOSING slide: 2-4 conclusion bullets.`)
    : '';

  // Алдыңғы батчтарда full_background тым жиі қолданылса — келесі батчқа
  // нақты, міндетті түрде split-layout қолдануды тапсырамыз.
  const ALL_IMAGE_TYPES = ['full_background', 'right_half', 'left_half', 'top_strip', 'bottom_strip', 'corner_accent'];
  let varietyRule = '';
  if (usedImageTypes && usedImageTypes.length > 0) {
    const fullBgRatio = usedImageTypes.filter(t => t === 'full_background').length / usedImageTypes.length;
    const unusedTypes = ALL_IMAGE_TYPES.filter(t => !usedImageTypes.includes(t) && t !== 'full_background');
    if (fullBgRatio >= 0.5) {
      varietyRule = `IMPORTANT: previous slides used image types: [${usedImageTypes.join(', ')}] — too many were "full_background". For this batch, you MUST use one of these instead where it fits the content: ${unusedTypes.length > 0 ? unusedTypes.join(', ') : 'right_half, left_half, top_strip'}.`;
    }
  }

  const user = `You are writing slides for the presentation "${presentationTitle}".

CLIENT BRIEF (follow their intent): respect language, tone, and any constraints they stated. Outline topics below already come from their brief — do not reinvent the structure.

Full presentation outline (for context only — you are generating just the slides listed below):
${contextList}

Generate DETAILED, FULLY-FORMED content for ONLY these slides:
${batchList}

IMPORTANT — CLIENT FIRST: if a slide's topic above already contains specific details (section names, numbers, key terms, sub-points from the client's brief/syllabus), you MUST use those exact details. Do NOT replace with a generic summary. Prefer the client's wording. Keep text short (see content rules), but never drop their key facts.

${coverRule}
${closingRule}
${varietyRule}
${styleGuide(style)}
${languageRule}

Return this JSON structure:
{
  "slides": [
    ${SLIDE_JSON_SHAPE}
  ]
}

The "slides" array must contain EXACTLY ${batchTopics.length} entries, with "index" matching: ${batchTopics.map(b => b.index).join(', ')}.

${CLIENT_FIRST_RULES}

${COMPOSITION_RULES}
- Each slide must have different composition from the others in this batch.

${CONTENT_RULES}

${VISUAL_RULES}`;

  const text = await withRetry(() => groqChat(system, user, `generateBatch[${batchTopics.map(b=>b.index).join(',')}]`), 'generateBatch');
  const parsed = parseJSON(text);

  if (!parsed?.slides || !Array.isArray(parsed.slides)) {
    throw new Error('Batch response missing slides array');
  }

  return parsed.slides;
}

// ─── Generate full presentation — outline, then batches, stitched together ─
async function generateSlides(topic, options = {}) {
  // Default 8 slides in general; academic style defaults to 10 (Kawasaki's
  // "10/20/30" rule — ~10 slides, 20 min, 30pt+ font — cited in the Yessenov
  // University presentation-requirements brief as the common convention).
  const slideCount = options.slideCount || (options.style === 'academic' ? 10 : 8);
  const language   = options.language   || null;
  const style      = options.style      || null;
  // Full raw client message (may include structure notes beyond parsed topic)
  const clientBrief = options.clientBrief || topic;

  console.log(`[Pipeline] Generating outline for ${slideCount} slides...`);
  const outline = await generateOutline(clientBrief, slideCount, language, style);
  const presentationTitle = outline.title;
  const slideTopics = outline.slideTopics;

  // Батчтарға бөлу: [1,2,3], [4,5,6], [7,8]
  const batches = [];
  for (let i = 0; i < slideTopics.length; i += SLIDES_PER_BATCH) {
    const batchTopics = slideTopics
      .slice(i, i + SLIDES_PER_BATCH)
      .map((topic, j) => ({ index: i + j + 1, topic }));
    batches.push(batchTopics);
  }

  console.log(`[Pipeline] Generating ${slideTopics.length} slides in ${batches.length} batches of ~${SLIDES_PER_BATCH}...`);

  const allSlides = [];
  const usedImageTypes = []; // барлық алдыңғы батчтарда қолданылған composition.image мәндері
  for (const batchTopics of batches) {
    const slides = await generateSlideBatch(presentationTitle, slideTopics, batchTopics, style, language, usedImageTypes);
    allSlides.push(...slides);
    slides.forEach(s => { if (s.composition?.image) usedImageTypes.push(s.composition.image); });
    console.log(`[Pipeline] Batch done: slides ${batchTopics.map(b => b.index).join(',')} — image types so far: [${usedImageTypes.join(', ')}]`);
  }

  // index бойынша сұрыптау (модель ретсіз қайтарса да дұрыс ретте болу үшін)
  allSlides.sort((a, b) => (a.index || 0) - (b.index || 0));

  // Force cover credits from client brief (never rely on model memory alone)
  if (options.coverMeta && allSlides.length) {
    const m = options.coverMeta;
    const cover = allSlides[0];
    const lines = [];
    if (m.faculty) lines.push('Факультет: ' + m.faculty);
    if (m.department) lines.push('Кафедра: ' + m.department);
    if (m.checkedBy) lines.push('Тексерген: ' + m.checkedBy);
    if (m.performedBy) lines.push('Орындаған: ' + m.performedBy);
    if (m.group) lines.push('Топ: ' + m.group);
    if (lines.length) {
      cover.bullets = lines;
      cover.body = null;
      if (!cover.subtitle || cover.subtitle.length > 80) {
        cover.subtitle = lines.join(' · ');
      }
      // Keep academic minimal look on cover
      cover.composition = Object.assign({}, cover.composition || {}, {
        image: (cover.composition && cover.composition.image) || 'full_background',
        overlay: (cover.composition && cover.composition.overlay) || 'dark_gradient_bottom',
        layout: 'single_column',
        elements: ['title', 'subtitle', 'bullets'],
      });
    }
  }

  return { title: presentationTitle, slides: allSlides };

}

// ─── 2. Review & Improve — де батчпен, бір слайдтар тобын бір-бірден ──────
// Толық презентацияны бір review шақыруға жіберу де сол 6000 TPM шегінен
// асады (8 слайд × толық JSON = үлкен promt). Сондықтан review де сол
// SLIDES_PER_BATCH өлшемімен бөлінеді.
async function reviewSlideBatch(slidesBatch) {
  const batchJSON = JSON.stringify({ slides: slidesBatch }, null, 2);

  const system = `You are a senior art director doing visual QC. You ALWAYS respond with valid JSON only. No markdown, no explanation. Just raw JSON.`;

  const user = `Review these presentation slides and fix visual problems only. Do NOT redesign. Keep the same number of slides and same "index" values.

${batchJSON}

Fix only:
- Text readability over images (fix overlay or textPosition)
- Title too long (>10 words) → shorten
- Subtitle longer than 25 words → cut to one sentence
- Body longer than 40 words → trim
- full_background + dark_gradient_left → textPosition must be center_left
- full_background + dark_gradient_right → textPosition must be center_right
- Too many bullets (>5) → keep the strongest 3-4
- Each bullet >14 words → shorten slightly
- full_background + overlay=none → add dark_gradient_bottom
- Vague imageQuery → rewrite in English with scene+mood+lighting
- If a slide has a clear physical/scientific/historical subject, add or improve visualIntent so the 3D renderer can select a semantic model; never use generic words like "object" or "shape"
- If 2+ stats with right_half/left_half image → change image to full_background
- Do NOT touch the "visual" field (leave it exactly as given)

Return the full corrected JSON with the same shape: { "slides": [...] }`;

  const text = await withRetry(() => groqChat(system, user, `reviewBatch[${slidesBatch.map(s=>s.index).join(',')}]`), 'reviewBatch');

  let reviewed;
  try {
    reviewed = parseJSON(text);
  } catch {
    console.warn('[Review] Invalid JSON for batch — using original.');
    return slidesBatch;
  }

  if (!reviewed?.slides || reviewed.slides.length !== slidesBatch.length) {
    console.warn('[Review] Slide count mismatch in batch — using original.');
    return slidesBatch;
  }

  // "visual" өрісін модельге сенбей, кодпен қайтарамыз (review оны түсіріп кетуі мүмкін)
  return reviewed.slides.map((s, i) => {
    const orig = slidesBatch.find((o) => o && o.index === s.index) || slidesBatch[i];
    if (orig && orig.visual !== undefined) s.visual = orig.visual;
    return s;
  });
}

async function reviewAndImproveSlides(presentation) {
  const slides = presentation.slides;
  const batches = [];
  for (let i = 0; i < slides.length; i += SLIDES_PER_BATCH) {
    batches.push(slides.slice(i, i + SLIDES_PER_BATCH));
  }

  console.log(`[Pipeline] Reviewing ${slides.length} slides in ${batches.length} batches...`);

  const allReviewed = [];
  for (const batch of batches) {
    const reviewed = await reviewSlideBatch(batch);
    allReviewed.push(...reviewed);
  }

  allReviewed.sort((a, b) => (a.index || 0) - (b.index || 0));

  return { ...presentation, slides: allReviewed };
}

module.exports = { generateSlides, reviewAndImproveSlides, parseUserInput, parseCoverMeta};
                                                                                                                                       
