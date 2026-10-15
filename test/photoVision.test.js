'use strict';
// Суретті көзбен таңдау + AI сурет: Gemini REST жалған fetch-пен, кішірейтілген суреттер жалған axios-пен (желісіз).
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

const thumbHits = [];
const fakeAxios = {
  get: async (url) => {
    thumbHits.push(url);
    if (/broken/.test(url)) { const e = new Error('404'); e.response = { status: 404 }; throw e; }
    return { status: 200, headers: { 'content-type': 'image/jpeg' }, data: Buffer.from('jpeg-' + url) };
  },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'axios' ? fakeAxios : origLoad.call(this, req, ...rest); };

const G = require('../core/googleAi');
const V = require('../products/presentation/photoVision');
const Gen = require('../products/presentation/imageGen');

const origFetch = global.fetch;
let replies = [];
const sent = [];
function stubFetch() {
  global.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ url, body, headers: init.headers });
    const r = replies.shift();
    if (typeof r === 'function') return r(url, body);
    return { ok: true, status: 200, text: async () => JSON.stringify(r) };
  };
}
const jsonReply = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }], usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 200, totalTokenCount: 3200 } });

test.afterEach(() => { global.fetch = origFetch; delete process.env.GOOGLE_API_KEY; replies = []; sent.length = 0; thumbHits.length = 0; });

test('no Google key → chooser is null (text judge stays), helpers return null without calling the network', async () => {
  delete process.env.GOOGLE_API_KEY; delete process.env.GEMINI_API_KEY;
  assert.strictEqual(V.makeVisionChooser({ title: 'x' }), null);
  assert.strictEqual(await G.geminiJson([{ text: 'x' }]), null);
  assert.strictEqual(await G.geminiImage('x'), null);
  assert.strictEqual(await Gen.generateSlideImage({ title: 'x', query: 'y' }, { left: 2 }), null);
});

test('vision chooser sends thumbnails (not full images), key in header, ranks by fit+appeal, drops ugly and off-topic', async () => {
  process.env.GOOGLE_API_KEY = 'k';
  stubFetch();
  replies.push(jsonReply({ photos: [
    { i: 0, fit: 9, appeal: 4, bg: 5, focus: '50% 30%', flaw: 'blurry' },   // сай, бірақ бұлыңғыр → түседі
    { i: 1, fit: 3, appeal: 10, bg: 9, focus: '', flaw: '' },                // әдемі, бірақ тақырыпқа жат → түседі
    { i: 2, fit: 8, appeal: 9, bg: 7, focus: '30% 60%', flaw: '' },
    { i: 3, fit: 10, appeal: 7, bg: 6, focus: '62% 40%', flaw: '' },
  ] }));
  const choose = V.makeVisionChooser({ topic: 'Қазақ хандығы', title: 'Керей мен Жәнібек', text: '1465 жыл', query: 'Kazakh Khanate founding' });
  const cands = [
    { url: 'https://big/0.jpg', thumb: 'https://t/0.jpg', source: 'pexels' },
    { url: 'https://big/1.jpg', thumb: 'https://t/1.jpg', source: 'unsplash' },
    { url: 'https://big/2.jpg', thumb: 'https://t/2.jpg', source: 'openverse' },
    { url: 'https://big/3.jpg', thumb: 'https://t/3.jpg', source: 'wikimedia', desc: 'Kazakh Khanate 1465 painting' },
  ];
  const ranked = await choose(cands);
  assert.deepStrictEqual(ranked.map((r) => r.i), [3, 2]);
  assert.strictEqual(ranked[0].focus, '62% 40%');
  assert.deepStrictEqual(thumbHits.sort(), ['https://t/0.jpg', 'https://t/1.jpg', 'https://t/2.jpg', 'https://t/3.jpg']);
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].url, /gemini-2\.5-flash-lite:generateContent$/);
  assert.ok(!/key=/.test(sent[0].url), 'кілт URL-де емес');
  assert.strictEqual(sent[0].headers['x-goog-api-key'], 'k');
  const parts = sent[0].body.contents[0].parts;
  assert.strictEqual(parts.filter((p) => p.inline_data).length, 4);
  assert.match(parts[0].text, /Керей мен Жәнібек/);
  assert.match(parts.find((p) => /Photo 3/.test(p.text || '')).text, /archive caption: Kazakh Khanate/);
  // кэш: қайта сұрағанда шақыру жоқ
  assert.deepStrictEqual((await choose(cands)).map((r) => r.i), [3, 2]);
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual(choose.scoreOf(cands[1]).fit, 3);
});

test('background placement also needs bg ≥ 6; broken thumbnails are skipped; API failure → null (fallback)', async () => {
  process.env.GOOGLE_API_KEY = 'k';
  stubFetch();
  replies.push(jsonReply({ photos: [{ i: 0, fit: 9, appeal: 9, bg: 2 }, { i: 1, fit: 8, appeal: 8, bg: 8 }] }));
  const choose = V.makeVisionChooser({ title: 'Cover', background: true, cover: true });
  const ranked = await choose([
    { url: 'https://big/a.jpg', thumb: 'https://t/a.jpg' }, { url: 'https://big/x.jpg', thumb: 'https://t/broken.jpg' }, { url: 'https://big/b.jpg', thumb: 'https://t/b.jpg' },
  ]);
  assert.deepStrictEqual(ranked.map((r) => r.i), [2], 'фонға жарамайтын медаль түседі; сынық thumbnail жіберілмейді');
  assert.strictEqual(sent[0].body.contents[0].parts.filter((p) => p.inline_data).length, 2);

  replies.push(() => ({ ok: false, status: 400, text: async () => 'bad request' }));
  const choose2 = V.makeVisionChooser({ title: 'Other' });
  assert.strictEqual(await choose2([{ url: 'https://big/c.jpg', thumb: 'https://t/c.jpg' }]), null);
});

test('AI image: named subjects never generated; budget caps; generated image is checked (text/artefacts rejected)', async () => {
  process.env.GOOGLE_API_KEY = 'k';
  stubFetch();
  const budget = { left: 2 };
  assert.strictEqual(await Gen.generateSlideImage({ title: 'Абай', query: 'Abai Kunanbayev portrait', named: true }, budget), null);
  assert.strictEqual(budget.left, 2, 'атаулыға ақша жұмсалмайды');

  const img = 'A'.repeat(2000);
  // 1) interactions пішіні: сурет жауапта терең жатыр
  replies.push({ id: 'x', steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/jpeg', data: img }] }] });
  replies.push(jsonReply({ photos: [{ i: 0, fit: 9, appeal: 8, flaw: '' }] }));
  const ok = await Gen.generateSlideImage({ topic: 'Экология', title: 'Арал теңізі', query: 'dried Aral Sea ship graveyard' }, budget);
  assert.strictEqual(ok.dataUri, 'data:image/jpeg;base64,' + img);
  assert.match(sent[0].url, /\/interactions$/);
  assert.strictEqual(sent[0].body.model, 'gemini-3.1-flash-lite-image');
  assert.strictEqual(sent[0].body.response_format.aspect_ratio, '16:9');
  assert.match(sent[0].body.input, /NO text, letters/);
  assert.match(sent[0].body.input, /Арал теңізі/);

  // 2) тексеруден өтпеді (мәтін бар) → алынбайды
  replies.push({ steps: [{ type: 'model_output', content: [{ type: 'image', mime_type: 'image/jpeg', data: img }] }] });
  replies.push(jsonReply({ photos: [{ i: 0, fit: 9, appeal: 8, flaw: 'text' }] }));
  assert.strictEqual(await Gen.generateSlideImage({ title: 'Су', query: 'water' }, budget), null);
  assert.strictEqual(budget.left, 0);
  assert.strictEqual(await Gen.generateSlideImage({ title: 'Тағы', query: 'more' }, budget), null, 'лимит бітті');
});

test('generateContent image shape is understood too (inlineData in candidates)', () => {
  const img = 'B'.repeat(1500);
  const hit = G.findImageData({ candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: img } }] } }] });
  assert.deepStrictEqual(hit, { mime: 'image/png', data: img });
  assert.strictEqual(G.findImageData({ candidates: [{ content: { parts: [{ text: 'no image' }] } }] }), null);
  assert.strictEqual(V.normFocus('62%, 140%'), '62% 100%');
  assert.strictEqual(V.normFocus('center'), '');
});
