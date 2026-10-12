'use strict';
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

process.env.PEXELS_API_KEY = 'test-pexels';
process.env.UNSPLASH_ACCESS_KEY = 'test-unsplash';
delete process.env.PIXABAY_API_KEY;
const I = require('../products/presentation/images');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const calls = [];
let pexels = { status: 200, remaining: 150 };
let unsplash = { status: 200, remaining: 40 };
axios.get = async (url, cfg) => {
  calls.push(url);
  if (/api\.pexels\.com/.test(url)) {
    const headers = { 'x-ratelimit-remaining': String(pexels.remaining), 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) };
    if (pexels.status !== 200) { const e = new Error('limit'); e.response = { status: pexels.status, headers }; throw e; }
    return { headers, data: { photos: [{ width: 2000, src: { large2x: 'https://img.test/p-' + cfg.params.query.replace(/\W/g, '') + '.jpg' }, photographer: 'P' }] } };
  }
  if (/api\.unsplash\.com/.test(url)) {
    const headers = { 'x-ratelimit-remaining': String(unsplash.remaining) };
    return { headers, data: { results: [{ width: 2000, urls: { regular: 'https://img.test/u-' + cfg.params.query.replace(/\W/g, '') + '.jpg' }, user: { name: 'U' } }] } };
  }
  if (/commons\.wikimedia/.test(url)) return { headers: {}, data: { query: { pages: {} } } };
  if (/img\.test/.test(url)) return { headers: { 'content-type': 'image/jpeg' }, data: JPEG };
  throw new Error('unexpected ' + url);
};
const apiCalls = (re) => calls.filter((u) => re.test(u)).length;

test('the provider with more quota left goes first; free decks keep the paid reserve', async () => {
  assert.deepStrictEqual(I.providerOrder().slice(0, 2), ['pexels', 'unsplash']);
  pexels.remaining = 10; // below the reserve (20)
  await I.findImage('students in classroom', { used: new Set() });
  assert.deepStrictEqual(I.providerOrder().slice(0, 2), ['unsplash', 'pexels'], 'unsplash now has more left');
  assert.ok(!I.providerOrder({ free: true }).includes('pexels'), 'free decks do not spend the Pexels reserve');
});

test('a "limit reached" answer pauses the provider and the search moves on', async () => {
  unsplash.remaining = 2;                                   // unsplash nearly empty → pexels (10 left) goes first
  await I.findImage('forest river aerial', { used: new Set() });
  assert.strictEqual(I.providerOrder()[0], 'pexels');
  pexels = { status: 429, remaining: 0 };
  unsplash.remaining = 45;
  const before = apiCalls(/api\.unsplash/);
  const hit = await I.findImage('mountain lake landscape', { used: new Set(), budget: { left: 4 } });
  assert.ok(hit && hit.source === 'unsplash');
  assert.ok(apiCalls(/api\.unsplash/) > before);
  assert.ok(!I.providerOrder().includes('pexels'), 'pexels paused after 429');
  assert.ok(I.imageStats().providers.pexels.paused);
});

test('repeated topics are served from the cache, and the per-photo budget caps API calls', async () => {
  const n0 = apiCalls(/api\./);
  const a = await I.findImage('city skyline night', { used: new Set() });
  const n1 = apiCalls(/api\./);
  const b = await I.findImage('city skyline night', { used: new Set() });
  assert.ok(a && b && a.dataUri === b.dataUri);
  assert.strictEqual(apiCalls(/api\./), n1, 'second identical search hits the cache');
  assert.ok(n1 > n0);
  const budget = { left: 0 };
  const none = await I.findImage('desert camel caravan', { used: new Set(), budget });
  assert.strictEqual(none, null, 'no budget → no API call');
  assert.strictEqual(apiCalls(/api\./), n1);
  assert.ok(I.imageStats().cacheHits >= 1);
});

