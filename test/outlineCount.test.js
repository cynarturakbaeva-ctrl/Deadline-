'use strict';
// Студент 8 слайд сұраса — 8 алады (модель 7 қайтарса бір рет толықтыру сұралады; көп болса қорытынды сақталады)
const test = require('node:test');
const assert = require('node:assert');
const G = require('../products/presentation/gemini');

const origFetch = global.fetch;
let replies = [];
const asked = [];
function stub() {
  global.fetch = async (url, init) => {
    asked.push(JSON.parse(init.body));
    const content = JSON.stringify(replies.shift());
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: {} }), text: async () => content };
  };
}
test.afterEach(() => { global.fetch = origFetch; replies = []; asked.length = 0; delete process.env.DEEPSEEK_API_KEY; });
const list = (n) => Array.from({ length: n }, (_, i) => (i === n - 1 ? 'Қорытынды' : `Слайд ${i + 1}`));

test('outline shorter than asked → one completion call → exactly the asked count', async () => {
  process.env.DEEPSEEK_API_KEY = 'k'; stub();
  replies.push({ title: 'T', slideTopics: list(7) }, { title: 'T', slideTopics: list(8) });
  const o = await G.generateOutline('Абай мен әл-Фараби', 8, 'Kazakh', null);
  assert.strictEqual(o.slideTopics.length, 8);
  assert.strictEqual(asked.length, 2);
  assert.match(asked[1].messages[1].content, /only 7 slides/);
});

test('outline longer than asked → trimmed, closing slide kept; exact count → no extra call', async () => {
  process.env.DEEPSEEK_API_KEY = 'k'; stub();
  replies.push({ title: 'T', slideTopics: list(10) });
  const o = await G.generateOutline('x', 8, 'Kazakh', null);
  assert.strictEqual(o.slideTopics.length, 8);
  assert.strictEqual(o.slideTopics[7], 'Қорытынды');
  replies.push({ title: 'T', slideTopics: list(8) });
  await G.generateOutline('x', 8, 'Kazakh', null);
  assert.strictEqual(asked.length, 2);
});
