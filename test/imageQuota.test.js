'use strict';
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

process.env.PEXELS_API_KEY = 'k';
process.env.UNSPLASH_ACCESS_KEY = 'u';
const I = require('../products/presentation/images');

test('Pexels reports its MONTHLY quota: an hourly 429 pauses it ~1 hour (not to month end) and Unsplash takes over', async () => {
  axios.get = async (url) => {
    if (/api\.pexels/.test(url)) {
      const e = new Error('limit');
      e.response = { status: 429, headers: { 'x-ratelimit-remaining': '23000', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 25 * 86400) } };
      throw e;
    }
    if (/api\.unsplash/.test(url)) return { headers: { 'x-ratelimit-remaining': '49' }, data: { results: [{ width: 2000, urls: { regular: 'https://img.t/a.jpg' }, user: { name: 'U' } }] } };
    if (/img\.t/.test(url)) return { headers: { 'content-type': 'image/jpeg' }, data: Buffer.from([0xff, 0xd8, 0xff]) };
    return { headers: {}, data: {} };
  };
  const hit = await I.findImage('mountain view', { used: new Set() });
  assert.strictEqual(hit && hit.source, 'unsplash');
  const p = I.imageStats().providers.pexels;
  const hours = (new Date(p.paused) - Date.now()) / 3600e3;
  assert.ok(hours > 0.1 && hours < 1.1, 'paused ~1h, got ' + hours.toFixed(2));
  assert.strictEqual(p.monthLeft, 23000);
  assert.ok(I.imageStats().providers.unsplash.hourLeft <= 49);
});
