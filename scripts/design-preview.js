'use strict';
/**
 * Design preview / QA harness.
 *   node scripts/design-preview.js [outDir] [deck.json]
 * Builds a sample deck (or your JSON), renders every slide to PNG with headless Chrome and prints
 * the in-page design report (overflow / overlap / tiny text). Uses puppeteer if installed, else playwright.
 */
const fs = require('fs'); const path = require('path');
const { build3DPresentationHTML } = require('../products/presentation/html3DBuilder');

function photo(w, h, c1, c2, label) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="' + w * 0.62 + '" cy="' + h * 0.38 + '" r="' + h * 0.18 + '" fill="rgba(255,255,255,.18)"/><path d="M0 ' + h * 0.8 + ' L' + w * 0.3 + ' ' + h * 0.55 + ' L' + w * 0.55 + ' ' + h * 0.75 + ' L' + w * 0.8 + ' ' + h * 0.5 + ' L' + w + ' ' + h * 0.78 + ' L' + w + ' ' + h + ' L0 ' + h + 'Z" fill="rgba(0,0,0,.35)"/></svg>';
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
const PNGish = (w, h, a, b) => photo(w, h, a, b); // svg stands in for photos (real decks use jpeg/png data URIs)

const sample = [
  { title: 'Қазақ хандығының құрылуы және дамуы', subtitle: 'XV–XVII ғасырлардағы саяси тарих', bullets: ['Орындаған: Айгерім Сейтқалиқызы', 'Тексерген: Т. Әбдіқадыров', 'Топ: ТК-21'], webImageUrl: PNGish(1920, 1080, '#6b4a2b', '#1c120a'), composition: { mood: 'archive', accentColor: '#c9a15a', visualPurpose: 'cover' } },
  { title: 'Кіріспе: неге бұл тақырып маңызды', body: 'Қазақ хандығы — Орталық Азия даласындағы ең ықпалды мемлекеттік бірлестіктердің бірі. Оның құрылуы халықтың этникалық бірлігін, шаруашылық жүйесін және әскери ұйымдастырылуын айқындады. Бұл кезең бүгінгі қазақ мемлекеттілігінің тарихи негізін қалады, сондықтан оны терең зерттеу қажет.', webImageUrl: PNGish(1200, 1500, '#3d5a52', '#0f1c19'), composition: { mood: 'archive' } },
  { title: 'Бірінші бөлім', subtitle: 'Саяси құрылым', composition: { visualPurpose: 'section' } },
  { title: 'Хандықтың негізгі ерекшеліктері', bullets: ['Жүздер жүйесі: аумақтық және рулық бөліну тұрақты басқаруды қамтамасыз етті', 'Билер кеңесі: дау-жанжалды шешетін жоғары сот органы болды', 'Көшпелі шаруашылық: мал өсіру экономиканың негізін құрады', 'Сауда жолдары: Жібек жолы бойындағы қалалар байланыс орталығы болды'], composition: { mood: 'archive' } },
  { title: 'Негізгі оқиғалар хронологиясы', bullets: ['1456: Керей мен Жәнібек Моғолстан шекарасына көшті', '1465: Қазақ хандығының іргесі қаланды', '1511: Қасым хан билік құрды', '1538: Хақназар хан тұсында нығаю', '1598: Тәуекел хан дәуірінің аяқталуы'], composition: { visualPurpose: 'timeline' } },
  { title: 'Хандық халқының көрсеткіштері', subtitle: 'Тарихи деректер бойынша бағалау', stats: [{ value: '1 500 000', label: 'шамамен халық саны XVI ғасырда' }, { value: '87%', label: 'көшпелі шаруашылықпен айналысқан' }, { value: '3', label: 'жүзге бөлінген аумақтық бірлік' }] },
  { title: 'Қасым ханның билік дәуірі', subtitle: 'Қазақ хандығының ең күшті кезеңі', webImageUrl: PNGish(1800, 1000, '#7a5a3a', '#1a120c'), composition: { mood: 'archive' } },
  { title: 'Мемлекеттік басқару кезеңдері', bullets: ['Жинақтау: руларды бір ханның төңірегіне біріктіру', 'Нығаю: заң жинағын қабылдау және шекараны бекіту', 'Кеңею: жаңа жерлерді қосып алу', 'Тұрақтандыру: ішкі тәртіпті орнату'], composition: { visualPurpose: 'process' } },
  { title: 'Басқару иерархиясы', bullets: ['Хан: жоғарғы билеуші және әскербасы', 'Сұлтандар: аймақтарды басқарушы төрелер', 'Билер: заң және әдет-ғұрып сарапшылары', 'Батырлар: әскери басшылар'], composition: { visualPurpose: 'hierarchy' } },
  { title: 'Үш жүздің салыстырмалы сипаттамасы', table: { headers: ['Жүз', 'Аумақ', 'Негізгі шаруашылық'], rows: [['Ұлы жүз', 'Жетісу', 'Егіншілік және мал'], ['Орта жүз', 'Орталық дала', 'Көшпелі мал шаруашылығы'], ['Кіші жүз', 'Батыс өңір', 'Мал және сауда']] } },
  { title: 'Бір ұлы идея', subtitle: 'Бірлік — ел тірегі', body: 'Мемлекет күші халықтың ынтымағында.', composition: { mood: 'archive' } },
  { title: 'Әз Тәуке', subtitle: 'Жеті жарғы — дала заңының рухы, ол халықты бірлікке шақырды.', composition: { layout: 'quote_hero', visualPurpose: 'quote' } },
  { title: 'Қорытынды', bullets: ['Хандық — қазақ мемлекеттілігінің негізі', 'Жүздер жүйесі басқаруды тұрақтандырды', 'Сауда мен мал шаруашылығы экономиканы қамтамасыз етті'], webImageUrl: PNGish(1800, 1000, '#5a4630', '#120d08'), composition: { visualPurpose: 'conclusion' } },
  { title: 'Пайдаланылған әдебиеттер', bullets: ['Әбусейітова М. Қазақстан тарихы. Алматы, 2010', 'Бартольд В. Түркістан тарихы. Мәскеу, 1963', 'Қозыбаев М. Қазақстан тарихы очерктері. 1998'] },
];

async function main() {
  const outDir = process.argv[2] || path.join(__dirname, '..', '..', 'out');
  fs.mkdirSync(outDir, { recursive: true });
  const deck = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : sample;
  process.env.DESIGN_DEBUG = '1';
  const html = build3DPresentationHTML(deck, 'Қазақ хандығы', { style: 'academic' });
  const htmlPath = path.join(outDir, 'deck.html'); fs.writeFileSync(htmlPath, html);
  let browserLib; let launch;
  try { browserLib = require('puppeteer'); launch = () => browserLib.launch({ headless: 'new', args: ['--no-sandbox'] }); }
  catch (e) {
    browserLib = require(process.env.PLAYWRIGHT_PATH || 'playwright');
    const exe = process.env.PUPPETEER_EXECUTABLE_PATH;
    launch = () => browserLib.chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  }
  const browser = await launch();
  const page = await browser.newPage();
  await page.setViewportSize ? await page.setViewportSize({ width: 1920, height: 1080 }) : await page.setViewport({ width: 1920, height: 1080 });
  await page.goto('file://' + htmlPath);
  await page.evaluate(() => window.__qaDone);
  await page.addStyleTag({ content: '#controls,#dots,#hint,#progress,#topbar{display:none!important}#stage{box-shadow:none!important}.layer{transform:none!important}' });
  const n = await page.evaluate(() => document.querySelectorAll('.slide').length);
  for (let i = 0; i < n; i++) {
    if (i > 0) await page.keyboard.press('ArrowRight');
    await new Promise((r) => setTimeout(r, 1700));
    await page.evaluate((idx) => document.querySelectorAll('.slide').forEach((el, j) => { if (j !== idx) el.style.setProperty('display', 'none', 'important'); else { el.style.removeProperty('display'); el.style.setProperty('opacity', '1', 'important'); el.style.setProperty('transform', 'none', 'important'); el.style.setProperty('filter', 'none', 'important'); } }), i);
    await (await page.$('#stage')).screenshot({ path: path.join(outDir, 'slide-' + String(i + 1).padStart(2, '0') + '.png') });
  }
  const report = await page.evaluate(() => window.__designReport);
  report.forEach((r) => console.log(String(r.index).padStart(2), (r.layout || '').padEnd(11), 'fs=' + r.fs, 'drop=' + r.dropped, 'dens=' + r.density, 'minF=' + r.minFont, r.issues.map((i) => (i.hard ? '!' : '') + i.type + '(' + i.detail + ')').join(' ')));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
