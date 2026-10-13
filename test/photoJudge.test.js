'use strict';
// Тақырыпқа қатысы жоқ сурет қойылмайды: кандидаттар сипаттамасы бойынша тексеріледі (желісіз, axios/fetch жалған).
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const calls = [];
let script = {};
const fakeAxios = {
  get: async (url, cfg = {}) => {
    calls.push({ url, params: cfg.params || {} });
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
const I = require('../products/presentation/images');
const { makePhotoJudge } = require('../products/presentation/photoJudge');

const jpeg = (url) => ({ status: 200, headers: { 'content-type': 'image/jpeg' }, data: Buffer.from('fake-' + url) });
const pexels = (...photos) => () => ({ headers: {}, data: { photos: photos.map(([u, alt]) => ({ src: { large2x: u }, width: 4000, photographer: 'p', alt })) } });
const wiki = (...files) => () => ({ data: { query: { pages: Object.fromEntries(files.map(([u, title], i) => [String(i), {
  title: 'File:' + title, index: i, imageinfo: [{ mime: 'image/jpeg', width: 3000, thumburl: u, extmetadata: { ImageDescription: { value: '<p>' + title + '</p>' } } }],
}])) } } });
const searched = (re) => calls.filter((c) => re.test(c.url)).map((c) => c.params.query || c.params.gsrsearch);

test('query cleaning: lighting / mood words never reach the search', () => {
  assert.strictEqual(I.cleanQuery('women activists marching at a demonstration, sunlight, flags, inspiring atmosphere'), 'women activists marching at a demonstration flags');
  assert.strictEqual(I.cleanQuery('law library shelves, warm afternoon window light'), 'law library shelves');
  assert.deepStrictEqual(I.namedPhrases('Florence Nightingale hospital ward Scutari'), ['Florence Nightingale', 'Scutari']);
  assert.deepStrictEqual(I.namedPhrases('Crimean War painting 1854'), ['Crimean War', '1854']);
  assert.deepStrictEqual(I.namedPhrases('Diverse people voting in polling station'), []); // бірінші сөздің бас әрпі атау емес
  assert.ok(I.queryVariants('Crimean War historical painting soldiers charging').includes('Crimean War painting'));
});

test('named subject → archive first; a stock photo that does not match is rejected', async () => {
  calls.length = 0;
  script = {
    'https://commons.wikimedia.org': wiki(['https://wm/balaclava.jpg', 'The Charge of the Light Brigade, Crimean War, 1854']),
    'https://api.pexels.com': pexels(['https://px/reenact.jpg', 'Men in costumes at a festival']),
    'https://wm/': (u) => jpeg(u),
  };
  const judge = async (cands) => cands.map((c, i) => (/Crimean/.test(c.desc) ? i : -1)).filter((i) => i >= 0);
  const hit = await I.findImage('Crimean War cavalry charge painting', { used: new Set(), judge });
  assert.strictEqual(hit.url, 'https://wm/balaclava.jpg');
  assert.strictEqual(calls[0].url.includes('wikimedia'), true, 'архив бірінші сұралады');
  assert.match(hit.desc, /Light Brigade/);
});

test('every candidate off-topic → next source; nothing fits → no photo (not a wrong one)', async () => {
  calls.length = 0;
  script = {
    'https://api.pexels.com': pexels(['https://px/office.jpg', 'Business people shaking hands in office'], ['https://px/laptop.jpg', 'Woman using laptop']),
    'https://commons.wikimedia.org': wiki(['https://wm/flag.jpg', 'Random street in Paris']),
    'https://px/': (u) => jpeg(u), 'https://wm/': (u) => jpeg(u),
  };
  const judge = async () => [];
  const hit = await I.findImage('geologist examining rock outcrop', { used: new Set(), judge, budget: { left: 3 } });
  assert.strictEqual(hit, null);
  assert.ok(searched(/pexels/).length >= 1 && searched(/wikimedia/).length >= 1, 'келесі көзге өтті');
});

test('the judge order wins over the provider order', async () => {
  script = {
    'https://api.pexels.com': pexels(['https://px/a1.jpg', 'Children playing in a park'], ['https://px/a2.jpg', 'Pupils raising hands in a classroom']),
    'https://px/': (u) => jpeg(u),
  };
  const hit = await I.findImage('pupils raising hands classroom lesson', { used: new Set(), judge: async () => [1] });
  assert.strictEqual(hit.url, 'https://px/a2.jpg');
});

test('judge unavailable → word-overlap check keeps only photos that mention the subject', async () => {
  script = {
    'https://api.pexels.com': pexels(['https://px/b1.jpg', 'Woman smiling at camera'], ['https://px/b2.jpg', 'Aerial view of a landfill with trucks']),
    'https://px/': (u) => jpeg(u),
  };
  const hit = await I.findImage('landfill aerial view waste site', { used: new Set(), judge: async () => null });
  assert.strictEqual(hit.url, 'https://px/b2.jpg');
  assert.deepStrictEqual(I.lexicalFit([{ desc: 'Soldiers on parade' }, { desc: 'A cat' }], 'soldier marching'), [0]);
  assert.deepStrictEqual(I.lexicalFit([{}, {}], 'anything'), [0, 1], 'сипаттама жоқ ескі провайдер — бұрынғыдай');
});

test('makePhotoJudge: one model call per batch, answers cached, bad indexes ignored, no key → null', async () => {
  const origFetch = global.fetch;
  const prompts = [];
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    prompts.push(body.messages[1].content);
    return { ok: true, json: async () => ({ usage: {}, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ fit: [2, 0, 9] }) } }] }) };
  };
  try {
    delete process.env.DEEPSEEK_API_KEY;
    assert.strictEqual(await makePhotoJudge({ title: 'x' })([{ url: 'u', desc: 'd' }]), null);
    process.env.DEEPSEEK_API_KEY = 'test';
    const judge = makePhotoJudge({ topic: 'Қырым соғысы', title: 'Балаклава шайқасы', query: 'Battle of Balaclava painting' });
    const cands = [{ url: 'u0', desc: 'Charge of the Light Brigade painting' }, { url: 'u1', desc: 'Man in office' }, { url: 'u2', desc: 'Balaclava battle map 1854' }];
    assert.deepStrictEqual(await judge(cands), [2, 0]);
    assert.match(prompts[0], /Балаклава шайқасы/);
    assert.match(prompts[0], /2\) Balaclava battle map 1854/);
    assert.deepStrictEqual(await judge([cands[1], cands[2]]), [1], 'кэштен, қайта шақырусыз');
    assert.strictEqual(prompts.length, 1);
    assert.match(prompts[0], /Placement: photo in a frame/);
    // бүкіл слайдты жабатын фото — басқа шешім (медаль фонға жарамайды), кэш бөлек
    const bg = makePhotoJudge({ topic: 'Қырым соғысы', title: 'Қорытынды', query: 'Crimea medal', cover: true, background: true });
    await bg([cands[0]]);
    assert.strictEqual(prompts.length, 2);
    assert.match(prompts[1], /Placement: photo fills the whole slide/);
    assert.match(prompts[1], /\(cover or closing\)/);
  } finally {
    global.fetch = origFetch;
    delete process.env.DEEPSEEK_API_KEY;
  }
});
