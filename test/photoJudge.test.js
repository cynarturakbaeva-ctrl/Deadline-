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

test('makePhotoJudge: scores 0-10, below 7 dropped, best first, cached, judged against the slide text', async () => {
  const origFetch = global.fetch;
  const prompts = [];
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    prompts.push(body.messages[1].content);
    return { ok: true, json: async () => ({ usage: {}, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ scores: [8, 2, 10, 'x'] }) } }] }) };
  };
  try {
    delete process.env.DEEPSEEK_API_KEY;
    assert.strictEqual(await makePhotoJudge({ title: 'x' })([{ url: 'u', desc: 'd' }]), null);
    process.env.DEEPSEEK_API_KEY = 'test';
    const judge = makePhotoJudge({ topic: 'Қырым соғысы', title: 'Балаклава шайқасы', text: 'Жеңіл бригаданың шабуылы', query: 'Battle of Balaclava painting' });
    const cands = [{ url: 'u0', desc: 'Charge of the Light Brigade painting' }, { url: 'u1', desc: 'Man in office' }, { url: 'u2', desc: 'Balaclava battle map 1854' }];
    assert.deepStrictEqual(await judge(cands), [2, 0]);
    assert.deepStrictEqual([judge.scoreOf(cands[2]), judge.scoreOf(cands[1]), judge.scoreOf({ url: 'zz' })], [10, 2, null]);
    assert.match(prompts[0], /Балаклава шайқасы/);
    assert.match(prompts[0], /Slide says: Жеңіл бригаданың шабуылы/);
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

test('pooled best-of: a 10-point archive photo beats the first 7-point stock photo; ≥9 stops the search', async () => {
  calls.length = 0;
  script = {
    'https://api.pexels.com': pexels(['https://px/c1.jpg', 'Old sailing ship on the sea']),
    'https://commons.wikimedia.org': wiki(['https://wm/c2.jpg', 'HMS Victory at Portsmouth, 1805 painting']),
    'https://px/': (u) => jpeg(u), 'https://wm/': (u) => jpeg(u),
  };
  const scores = { 'https://px/c1.jpg': 7, 'https://wm/c2.jpg': 10 };
  const judge = async (cands) => cands.map((c, i) => i).filter((i) => scores[cands[i].url] >= 7);
  judge.scoreOf = (c) => scores[c.url];
  const hit = await I.findImage('sailing warship painting harbour', { used: new Set(), judge });
  assert.strictEqual(hit.url, 'https://wm/c2.jpg', 'кейінгі көздегі жоғары балл жеңеді');

  calls.length = 0;
  scores['https://px/c3.jpg'] = 9;
  script['https://api.pexels.com'] = pexels(['https://px/c3.jpg', 'Sailing warship in harbour']);
  const hit2 = await I.findImage('sailing warship harbour view', { used: new Set(), judge });
  assert.strictEqual(hit2.url, 'https://px/c3.jpg');
  assert.strictEqual(searched(/wikimedia/).length, 0, '9+ табылды — артық іздеу жоқ');
});

test('bigger renditions: Unsplash raw at 1920, Wikimedia 1920 thumbs, tall scans dropped, landscape first', async () => {
  process.env.UNSPLASH_ACCESS_KEY = 'u';
  try {
    script = {
      'https://api.unsplash.com': () => ({ headers: {}, data: { results: [{ urls: { raw: 'https://images.unsplash.com/photo-1?ixid=a', regular: 'https://r' }, width: 5000, user: { name: 'n' }, alt_description: 'x' }] } }),
      'https://commons.wikimedia.org': () => ({ data: { query: { pages: {
        0: { title: 'File:Scan page.jpg', index: 0, imageinfo: [{ mime: 'image/jpeg', width: 1000, height: 1800, thumburl: 'https://wm/tall.jpg' }] },
        1: { title: 'File:Portrait.jpg', index: 1, imageinfo: [{ mime: 'image/jpeg', width: 2000, height: 2600, thumburl: 'https://wm/portrait.jpg' }] },
        2: { title: 'File:Battle.jpg', index: 2, imageinfo: [{ mime: 'image/jpeg', width: 4000, height: 2500, thumburl: 'https://wm/wide.jpg' }] },
      } } } }),
    };
    const u = await I.unsplashCandidates('battle painting');
    assert.strictEqual(u[0].url, 'https://images.unsplash.com/photo-1?ixid=a&w=1920&q=75&fm=jpg&fit=max');
    assert.strictEqual(u[0].w, 1920);
    calls.length = 0;
    const w = await I.wikimediaCandidates('battle painting');
    assert.strictEqual(calls[0].params.iiurlwidth, 1920);
    assert.deepStrictEqual(w.map((c) => c.url), ['https://wm/wide.jpg', 'https://wm/portrait.jpg']);
  } finally { delete process.env.UNSPLASH_ACCESS_KEY; }
});
