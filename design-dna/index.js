'use strict';
/**
 * Референс PPTX толық талдауы: Design DNA (түс/шрифт/тығыздық) + құрылым (рөлдер, макеттер, тор, қайталанатын элементтер).
 * Қайтарады: { dna, theme, outline, archetypes, recurring, grid, warnings, summaryLines, brief }.
 */
const { extractDna, dnaToTheme, readZip, parseTheme, parseClrMap } = require('./pptxDna');
const { buildSkin } = require('./skin');
const { analyzeStructure, MAX_REFERENCE_SLIDES } = require('./structure');
const { extractDecor } = require('./decor');

const ROLE_KK = {
  title: 'титул', agenda: 'мазмұны', intro: 'кіріспе', relevance: 'өзектілік', goal: 'мақсат', tasks: 'міндеттер',
  section: 'бөлім айырғыш', content: 'негізгі мазмұн', conclusion: 'қорытынды', references: 'әдебиеттер', thanks: 'рахмет',
};
const ARCH_KK = {
  title: 'титул', 'text-image-left': 'мәтін + сурет (сол жақта)', 'text-image-right': 'мәтін + сурет (оң жақта)', 'full-image': 'толық экран сурет',
  'image-strip-top': 'жоғарғы сурет жолағы', 'image-strip-bottom': 'төменгі сурет жолағы', 'two-column': 'екі баған', 'statement': 'қысқа тезис',
  text: 'мәтін/тізім', table: 'кесте', chart: 'диаграмма', 'big-number': 'үлкен сан',
};
const archName = (id) => /^cards-(\d)/.test(id) ? `карточкалар (${id.split('-')[1]})` : (ARCH_KK[id] || id);

function analyzeReference(buf) {
  const files = readZip(buf);
  const pres = files.get('ppt/presentation.xml') || '';
  const sz = pres.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  const W = sz ? +sz[1] : 12192000; const H = sz ? +sz[2] : 6858000;
  const st = analyzeStructure(files, W, H);
  let dna = null;
  try { dna = extractDna(buf); } catch { /* құрылым жеткілікті */ }
  const theme = dna ? dnaToTheme(dna) : null;
  const themeName = [...files.keys()].find((k) => /^ppt\/theme\/theme\d+\.xml$/.test(k));
  const masterName = [...files.keys()].find((k) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(k));
  const pt = themeName ? parseTheme(files.get(themeName)) : {};
  const cm = masterName ? parseClrMap(files.get(masterName)) : {};
  let decor = null;
  try { decor = extractDecor(files, W, H, { theme: pt, clrMap: cm }); } catch (e) { console.warn('[Reference] decor skipped: ' + e.message); }
  const skin = buildSkin({ ...st, dna }, pt, cm, decor);
  const decorLine = skin && skin.decor ? 'Безендіру: ' + [skin.decor.hasBgImage ? 'фон суреті' : null, skin.decor.items ? skin.decor.items + ' декор элементі' : null, skin.photoShape === 'circle' ? 'дөңгелек фото' : null].filter(Boolean).join(', ') : null;
  return { dna, theme, ...st, skin, summaryLines: summaryLines(dna, { ...st, skin_decor: decorLine }), brief: skeletonBrief(st.outline) };
}

function summaryLines(dna, st) {
  const L = [];
  const o = st.outline;
  L.push(`${o.slideCount} слайд: ` + o.slides.map((s) => ROLE_KK[s.role] || s.role).join(' → '));
  if (st.archetypes.length) L.push('Макеттер: ' + st.archetypes.slice(0, 5).map((a) => `${archName(a.id)} ${Math.round(a.share * 100)}%`).join(', '));
  if (dna) {
    L.push(`Түс: ${dna.palette.dark ? 'қараңғы' : 'ашық'} фон ${dna.palette.bg}, акцент ${dna.palette.accent}`);
    if (dna.fonts.heading) L.push(`Шрифт: ${dna.fonts.heading}${dna.fonts.body && dna.fonts.body !== dna.fonts.heading ? ' / ' + dna.fonts.body : ''}`);
    L.push(`Тығыздық: ~${dna.density.avgWords} сөз/слайд`);
  }
  if (st.skin_decor) L.push(st.skin_decor);
  if (st.recurring.length) L.push('Қайталанатын: ' + st.recurring.map((r) => ({ logo: 'логотип', bar: 'жолақ', 'side-bar': 'бүйір жолағы', 'slide-number': 'слайд нөмірі', 'footer-text': 'төменгі мәтін', 'image-band': 'сурет жолағы', 'accent-shape': 'акцент пішіні' }[r.type] || r.type)).filter((v, i, a) => a.indexOf(v) === i).join(', '));
  if (st.warnings.includes('image_only')) L.push('⚠️ Слайдтардың көбі сурет түрінде, мәтіні жоқ: құрылым сенімсіз');
  if (st.warnings.includes('few_titles')) L.push('⚠️ Көп слайдтың тақырыбы табылмады: рөлдер жуық болуы мүмкін');
  return L;
}

const ARCH_HINT = (a) => {
  if (/^cards-(\d)/.test(a)) return `exactly ${a.split('-')[1]} bullets, each "Label: one short sentence" (they become ${a.split('-')[1]} cards)`;
  return ({
    'text-image-left': '2-3 short bullets + an English imageQuery (photo goes on the left)',
    'text-image-right': '2-3 short bullets + an English imageQuery (photo goes on the right)',
    'full-image': 'title only (max 8 words), no bullets, plus an English imageQuery for a full-screen photo',
    'big-number': 'exactly one stat (value + label) and a short title, no bullets',
    table: 'a comparison table (2-4 columns, 3-5 rows), no bullets',
    chart: 'a visual diagram/infographic spec (the "visual" field) plus a short title',
    statement: 'one short statement as the title, at most one supporting sentence, no bullets',
    'two-column': '4-6 short bullets (two balanced groups)',
    text: '3-5 short bullets',
    'image-strip-top': '2-3 short bullets + an English imageQuery', 'image-strip-bottom': '2-3 short bullets + an English imageQuery',
  })[a] || '';
};

/** LLM-ге берілетін қаңқа (мазмұнды көшірмейді, тек құрылым және әр слайдтың пішіні) */
function skeletonBrief(outline) {
  const lines = outline.slides.map((s) => {
    const shape = ARCH_HINT(s.archetype);
    // Шаблонның өз бөлім атауын (мыс. "Introduction", "Project Objectives") құрылымдық
    // нұсқау ретінде береміз — жаңа тақырыпқа бейімдеп жазу үшін, көшіру үшін емес.
    const cleanTitle = String(s.title || '').replace(/\s+/g, ' ').trim();
    const sectionHint = cleanTitle && cleanTitle.length > 1 && cleanTitle.length <= 40
      ? ` (template section: "${cleanTitle}" — write this section for the NEW topic, do not copy the wording)`
      : '';
    const head = s.role === 'content' || s.role === 'section'
      ? `${s.n}. ${s.role === 'section' ? 'section divider (very short)' : 'content slide'}${sectionHint}`
      : `${s.n}. ${s.role}`;
    return head + (shape && s.role !== 'title' ? ` — ${shape}` : '');
  });
  return `\n\nSlide skeleton from the client's reference deck (an approved example). Follow the slide count, the order and the per-slide form exactly; do NOT copy the reference's topic or wording:\n${lines.join('\n')}`;
}

/** Референстен шығатын міндетті талаптар (Requirement QA есебіне кіреді) */
function referenceItems(outline) {
  const items = [{ kind: 'hard', check: 'slide_count', op: '==', value: outline.slideCount, quote: `Референс PPTX: ${outline.slideCount} слайд`, source: 'reference' }];
  const want = ['agenda', 'intro', 'relevance', 'goal', 'tasks', 'conclusion', 'references', 'thanks'];
  for (const role of want) if (outline.roles.includes(role)) items.push({ kind: 'hard', check: 'has_slide', value: role, quote: `Референс PPTX: «${ROLE_KK[role]}» слайды`, source: 'reference' });
  return items;
}

module.exports = { analyzeReference, referenceItems, skeletonBrief, MAX_REFERENCE_SLIDES };
