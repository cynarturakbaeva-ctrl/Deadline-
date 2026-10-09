'use strict';
// Желісіз тест: axios жалған (stub) — npm install қажет емес.
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const calls = [];
let script = {};
const fakeAxios = {
  get: async (url, cfg = {}) => {
    calls.push(url);
    const handler = script[Object.keys(script).find((k) => url.startsWith(k))];
    if (!handler) { const e = new Error('no stub for ' + url); e.response = { status: 404 }; throw e; }
    return handler(url, cfg);
  },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'axios' ? fakeAxios : origLoad.call(this, req, ...rest); };

process.env.PEXELS_API_KEY = 'x';
delete process.env.UNSPLASH_ACCESS_KEY;
delete process.env.PIXABAY_API_KEY;
delete process.env.IMAGE_PROVIDER_ORDER;
const { findImage } = require('../products/presentation/images');

const jpeg = (url) => ({ status: 200, headers: { 'content-type': 'image/jpeg' }, data: Buffer.from('fake-' + url) });
const fail = (status) => () => { const e = new Error('http ' + status); e.response = { status }; throw e; };
const pexels = (...urls) => () => ({ data: { photos: urls.map((u) => ({ src: { large2x: u }, width: 4000, photographer: 'p' })) } });

test('жүктеу сәтсіз болса келесі кандидатқа өтеді', async () => {
  calls.length = 0;
  script = {
    'https://api.pexels.com': pexels('https://img/a.jpg', 'https://img/b.jpg'),
    'https://img/a.jpg': fail(403),
    'https://img/b.jpg': (u) => jpeg(u),
  };
  const hit = await findImage('mountain lake', { used: new Set() });
  assert.ok(hit && hit.dataUri.startsWith('data:image/jpeg;base64,'));
  assert.strictEqual(hit.url, 'https://img/b.jpg');
});

test('Pexels бос болса Wikimedia-ға түседі (соңғы резерв)', async () => {
  calls.length = 0;
  script = {
    'https://api.pexels.com': () => ({ data: { photos: [] } }),
    'https://commons.wikimedia.org': () => ({ data: { query: { pages: {
      '2': { title: 'File:Second.jpg', index: 2, imageinfo: [{ mime: 'image/jpeg', width: 3000, thumburl: 'https://wm/second.jpg' }] },
      '1': { title: 'File:First.jpg', index: 1, imageinfo: [{ mime: 'image/jpeg', width: 3000, thumburl: 'https://wm/first.jpg' }] },
      '3': { title: 'File:Tiny.jpg', index: 0, imageinfo: [{ mime: 'image/jpeg', width: 200, thumburl: 'https://wm/tiny.jpg' }] },
    } } } }),
    'https://wm/': (u) => jpeg(u),
  };
  const hit = await findImage('old fortress', { used: new Set() });
  assert.strictEqual(hit.url, 'https://wm/first.jpg'); // релевантылық ретімен, кішкентайы өткізілді
  assert.strictEqual(hit.source, 'wikimedia');
});

test('бір URL екі рет берілмейді (used Set)', async () => {
  script = {
    'https://api.pexels.com': pexels('https://img/a.jpg', 'https://img/b.jpg'),
    'https://img/': (u) => jpeg(u),
  };
  const used = new Set();
  const one = await findImage('city street', { used });
  const two = await findImage('city street', { used });
  assert.notStrictEqual(one.url, two.url);
});

test('429 болса бір рет қайталайды', async () => {
  let n = 0;
  script = {
    'https://api.pexels.com': pexels('https://img/r.jpg'),
    'https://img/r.jpg': (u) => { n += 1; if (n === 1) fail(429)(); return jpeg(u); },
  };
  const hit = await findImage('retry case', { used: new Set() });
  assert.ok(hit);
  assert.strictEqual(n, 2);
});

test('ештеңе табылмаса null (лақтырмайды)', async () => {
  script = { 'https://api.pexels.com': fail(500), 'https://commons.wikimedia.org': fail(500) };
  assert.strictEqual(await findImage('nothing', { used: new Set() }), null);
});

test('fallbackQueries: қазақша тақырып Pexels-ке жіберілмейді, басқа слайд сұранысы алынады', () => {
  const { fallbackQueries } = require('../products/presentation/images');
  const r = fallbackQueries('', 'Мемлекеттің экономикадағы рөлі. 8 слайд. қазақша. аудитория: Студенттер', ['city skyline dusk', 'government building']);
  assert.deepStrictEqual(r, ['city skyline dusk', 'government building']);
  const en = fallbackQueries('', 'Renewable energy. 10 slides', []);
  assert.ok(en[0].startsWith('Renewable energy'));
});
