'use strict';
// Ашық сурет базалары + vision жолы: маршрут, URL өлшемдері, лицензия сүзгісі, қайталанбау, орынға сай болу (желісіз).
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const calls = [];
let script = {};
const fakeAxios = {
  get: async (url, cfg = {}) => {
    calls.push({ url, params: cfg.params || {} });
    const key = Object.keys(script).find((k) => url.startsWith(k));
    if (!key) { const e = new Error('no stub for ' + url); e.response = { status: 404, headers: {} }; throw e; }
    return script[key](url, cfg);
  },
  post: async () => { throw new Error('no post'); },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'axios' ? fakeAxios : origLoad.call(this, req, ...rest); };

delete process.env.PEXELS_API_KEY; delete process.env.UNSPLASH_ACCESS_KEY; delete process.env.PIXABAY_API_KEY;
delete process.env.EUROPEANA_API_KEY; delete process.env.OPENVERSE_CLIENT_ID;
const O = require('../products/presentation/openImages');
const I = require('../products/presentation/images');

// нақты өлшемді PNG (imageMeta оқиды)
function png(w, h) {
  const b = Buffer.alloc(33); b.write('\x89PNG\r\n\x1a\n', 0, 'latin1'); b.writeUInt32BE(13, 8); b.write('IHDR', 12);
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
const img = (w, h) => () => ({ status: 200, headers: { 'content-type': 'image/png' }, data: png(w, h) });

test('routing: organisms → iNaturalist (only by the organism name), space → NASA, history → LoC, art → Cleveland', () => {
  assert.ok(O.routeOpen('saiga antelope herd in the steppe').includes('inaturalist'));
  assert.deepStrictEqual(O.routeOpen('Mars rover on red planet surface'), ['openverse', 'nasa']);
  assert.deepStrictEqual(O.routeOpen('Kazakh yurt interior traditional'), ['openverse', 'loc']);
  assert.ok(O.routeOpen('Crimean War battle painting').includes('cleveland'));
  assert.deepStrictEqual(O.routeOpen('teacher in classroom with students'), ['openverse'], 'жалпы сахна — тек Openverse');
  assert.ok(!O.routeOpen('Kazakh yurt').includes('inaturalist'), '«Kazakh yurt» латын атауы емес');
  assert.ok(O.routeOpen('Saiga tatarica in steppe').includes('inaturalist'));
});

test('Wikimedia: new thumb host + ?query understood, only standard widths (330/500/960/1280/1920)', () => {
  assert.strictEqual(O.wmSized('https://thumb.wikimedia.org/wikipedia/commons/thumb/0/03/A_b.jpg/1920px-A_b.jpg?utm_source=x', 480),
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/03/A_b.jpg/500px-A_b.jpg');
  assert.strictEqual(O.wmSized('https://upload.wikimedia.org/wikipedia/commons/e/ed/Big.jpg', 1920),
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ed/Big.jpg/1920px-Big.jpg');
  assert.strictEqual(I.wikiThumb('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/F.jpg/1920px-F.jpg', 500),
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/F.jpg/500px-F.jpg');
  assert.strictEqual(I.canonKey('https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/F.jpg/500px-F.jpg?x=1'),
    I.canonKey('https://upload.wikimedia.org/wikipedia/commons/a/ab/F.jpg'), 'бір файл — бір кілт');
  assert.strictEqual(I.canonKey('https://images.unsplash.com/photo-123-abc?ixid=1&w=1920'), 'us:photo-123-abc');
});

test('providers: Openverse rewrites Wikimedia originals and Flickr thumbs; iNaturalist drops NC photos; NASA uses ~large', async () => {
  script = {
    'https://api.openverse.org/v1/images/': () => ({ data: { results: [
      { source: 'wikimedia', url: 'https://upload.wikimedia.org/wikipedia/commons/e/ed/Yurt.jpg', width: 5000, height: 3000, title: 'Yurt', license: 'by', license_version: '2.0', attribution: '"Yurt" by X is licensed under CC BY 2.0' },
      { source: 'flickr', url: 'https://live.staticflickr.com/1/222_abc_b.jpg', width: 1024, height: 683, title: 'Steppe', license: 'cc0', tags: [{ name: 'kazakhstan' }] },
    ] } }),
    'https://api.inaturalist.org/v1/taxa/42': () => ({ data: { results: [{ name: 'Saiga tatarica', preferred_common_name: 'Saiga', taxon_photos: [
      { photo: { url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/1/square.jpg', license_code: 'cc-by-nc', original_dimensions: { width: 2048, height: 1365 } } },
      { photo: { url: 'https://inaturalist-open-data.s3.amazonaws.com/photos/2/square.jpeg', license_code: 'cc0', original_dimensions: { width: 2048, height: 1366 }, attribution: 'no rights reserved' } },
    ] }] } }),
    'https://api.inaturalist.org/v1/taxa': () => ({ data: { results: [{ id: 42 }] } }),
    'https://images-api.nasa.gov/search': () => ({ data: { collection: { items: [
      { data: [{ nasa_id: 'iss1', title: 'ISS over Kazakhstan', photographer: 'NASA' }], links: [{ href: 'https://images-assets.nasa.gov/image/iss1/iss1~medium.jpg', width: 1280, height: 853 }] },
    ] } } }),
  };
  const ov = await O.OPEN_PROVIDERS.openverse('Kazakh yurt');
  assert.deepStrictEqual(calls.find((c) => /openverse/.test(c.url)).params.license, 'cc0,pdm,by,by-sa', 'NC/ND лицензия сұралмайды');
  assert.strictEqual(ov[0].url, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ed/Yurt.jpg/1920px-Yurt.jpg');
  assert.strictEqual(ov[0].thumb, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/ed/Yurt.jpg/500px-Yurt.jpg');
  assert.deepStrictEqual([ov[0].w, ov[0].h], [1920, 1152]);
  assert.strictEqual(ov[1].thumb, 'https://live.staticflickr.com/1/222_abc_n.jpg');
  const ina = await O.OPEN_PROVIDERS.inaturalist('saiga antelope herd in the steppe');
  assert.strictEqual(calls.find((c) => /inaturalist\.org\/v1\/taxa$/.test(c.url)).params.q, 'saiga', 'тек ағза атауы ізделеді');
  assert.deepStrictEqual(ina.map((c) => c.url), ['https://inaturalist-open-data.s3.amazonaws.com/photos/2/original.jpeg'], 'CC BY-NC алынбайды');
  const na = await O.OPEN_PROVIDERS.nasa('ISS orbit');
  assert.strictEqual(na[0].url, 'https://images-assets.nasa.gov/image/iss1/iss1~large.jpg');
  assert.strictEqual(na[0].thumb, 'https://images-assets.nasa.gov/image/iss1/iss1~small.jpg');
});

test('vision path: background slot drops small/portrait candidates before vision and after download; avoids the student\'s old photos', async () => {
  calls.length = 0;
  const big = (id) => ({ source: 'flickr', url: `https://live.staticflickr.com/1/${id}_s_b.jpg`, width: 1024, height: 683, title: 'x', license: 'cc0' });
  script = {
    'https://api.openverse.org/v1/images/': () => ({ data: { results: [
      { source: 'wikimedia', url: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Wide.jpg', width: 4000, height: 2400, title: 'Wide steppe', license: 'cc0' },
      { source: 'wikimedia', url: 'https://upload.wikimedia.org/wikipedia/commons/b/bb/Tall.jpg', width: 2000, height: 3000, title: 'Tall', license: 'cc0' },
      big(1),
    ] } }),
    'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/aa/Wide.jpg/1920px': img(1920, 1152),
    'https://thumb.wikimedia.org/': img(500, 300),
  };
  let shown = [];
  const vision = async (batch) => { shown = batch.map((c) => c.url); return batch.map((c, i) => ({ i, fit: 9, appeal: 8, focus: '40% 40%' })); };
  const hit = await I.findImageVision('Kazakh steppe landscape', { vision, place: 'bg', used: new Set() });
  assert.deepStrictEqual(shown, ['https://thumb.wikimedia.org/wikipedia/commons/thumb/a/aa/Wide.jpg/1920px-Wide.jpg'], 'тік және 1024px фонға көрсетілмейді');
  assert.strictEqual(hit.focus, '40% 40%');
  assert.strictEqual(hit.key, 'wm:wide.jpg');

  // студенттің бұрынғы суреті: басқа таңдау ≥4 болса шығарылады
  script['https://api.openverse.org/v1/images/'] = () => ({ data: { results: [1, 2, 3, 4, 5].map(big) } });
  script['https://live.staticflickr.com/'] = img(1024, 683);
  const avoid = new Set([I.canonKey('https://live.staticflickr.com/1/1_s_b.jpg')]);
  const hit2 = await I.findImageVision('Kazakh steppe horses grazing', { vision, place: 'frame', used: new Set(), avoid });
  assert.ok(!shown.some((u) => /\/1_s_b/.test(u)), 'бұрынғы сурет көрсетілмеді');
  assert.ok(hit2 && /\/2_s_b/.test(hit2.url));

  // vision API құлады → {failed:true} (мәтіндік резерв), ал «сай сурет жоқ» → null
  assert.deepStrictEqual(await I.findImageVision('Kazakh steppe eagle hunter', { vision: async () => null, place: 'frame', used: new Set() }), { failed: true });
  assert.strictEqual(await I.findImageVision('Kazakh steppe camel caravan', { vision: async () => [], place: 'frame', used: new Set(), maxVariants: 1 }), null);
});

test('AI may draw places and peoples, never real persons / events / dated history', () => {
  assert.strictEqual(I.isRealSubject('Kazakh steppe at sunset with horses'), false);
  assert.strictEqual(I.isRealSubject('teacher in Kazakh classroom'), false);
  assert.strictEqual(I.isRealSubject('students in Almaty university library'), false);
  assert.strictEqual(I.isRealSubject('statue of Abai in Almaty'), true);
  assert.strictEqual(I.isRealSubject('Kazakh Khanate founding'), true);
  assert.strictEqual(I.isRealSubject('Soviet factory 1960s'), true);
});

test('editorial slide without a body shows ALL bullets (rhythm swap used to drop bullets 3-4)', () => {
  const { build3DPresentationHTML } = require('../products/presentation/html3DBuilder');
  const A = require('../products/presentation/design/analyze');
  const bullets = ['Бірінші пункт толық сөйлеммен жазылған.', 'Екінші пункт толық сөйлеммен жазылған.', 'Үшінші пункт жоғалмауы керек еді.', 'Төртінші пункт те көрінуі керек.'];
  const slides = [
    { title: 'Тақырып', subtitle: 'Кіріспе сөз', composition: { visualPurpose: 'cover' } },
    { title: 'А', subtitle: 'Түсіндірме сөйлем', bullets },
    { title: 'Ә', subtitle: 'Түсіндірме сөйлем', bullets },
    { title: 'Б', subtitle: 'Түсіндірме сөйлем', bullets },
    { title: 'Қорытынды', bullets: ['Соңы'], composition: { visualPurpose: 'conclusion' } },
  ];
  const plan = A.planDeck(slides);
  const edIdx = plan.findIndex((p) => p.layout === 'editorial');
  assert.ok(edIdx > 0, 'ырғақ points → editorial ауыстырды');
  const html = build3DPresentationHTML(slides, 'Тақырып', { style: 'academic' });
  const art = html.split('<article').find((a) => a.includes(`data-index="${edIdx}"`));
  for (const b of bullets) assert.ok(art.includes(b), 'жоқ: ' + b);
});
