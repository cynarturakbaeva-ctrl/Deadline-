'use strict';
// Тестер режимі: күніне 3 (жиналмайды), админ қосқаны сақталады, пікірсіз келесісі жоқ, @username/ID арқылы табу.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../core/tester');

const DAY = 86400e3;
const NOW = Date.UTC(2026, 9, 14, 9, 0); // 14.10, 14:00 Алматы

test('daily credits top up to 3 and never accumulate; extra from admin is kept', () => {
  const u = { tester_until: NOW + 5 * DAY, tester_credits: 1, tester_day: T.dayOf(NOW) };
  assert.strictEqual(T.creditsToday(u, NOW), 1, 'бүгін жұмсалғаны есептеледі');
  assert.strictEqual(T.creditsToday(u, NOW + DAY), 3, 'ертең 3-ке дейін толады');
  assert.strictEqual(T.creditsToday({ ...u, tester_credits: 3 }, NOW + 2 * DAY), 3, 'жұмсамаса да 3 (6 емес)');
  assert.strictEqual(T.creditsToday({ ...u, tester_credits: 5 }, NOW + DAY), 5, 'админ қосқан артығы сақталады');
  assert.strictEqual(T.creditsToday({ ...u, tester_until: NOW - 1 }, NOW), 0, 'мерзімі біткен');
});

test('until = Almaty midnight after N days; @username / link / id parsing', () => {
  const until = T.untilFor(7, NOW);
  assert.strictEqual(new Date(until).toISOString(), '2026-10-20T19:00:00.000Z'); // 21.10 00:00 Алматы
  assert.deepStrictEqual(T.parseWho('@Aidana_K'), { username: 'aidana_k' });
  assert.deepStrictEqual(T.parseWho('https://t.me/aidana_k'), { username: 'aidana_k' });
  assert.deepStrictEqual(T.parseWho(' 7369910426 '), { id: '7369910426' });
  assert.strictEqual(T.parseWho('a b'), null);
  assert.match(T.questionsText('Тақырып *x*'), /3️⃣ Мұғалімге/);
});

test('testersList: active first, gens/feedback counted, recent feedback with topic', () => {
  const r = T.testersList({
    users: [
      { chat_id: '1', name: 'Айдана', username: 'aidana', tester_until: NOW + DAY, tester_credits: 2, tester_day: T.dayOf(NOW), tester_pending: 'j2' },
      { chat_id: '2', name: null, username: 'erlan', tester_until: NOW - DAY, tester_credits: 0 },
    ],
    gens: [{ job_id: 'j1', chat_id: '1', title: 'Су', status: 'done', created_at: NOW - 3600e3 }, { job_id: 'j2', chat_id: '1', topic: 'Тас', status: 'done', created_at: NOW }],
    feedback: [{ job_id: 'j1', chat_id: '1', text: 'Сурет 3-слайдта сай емес', created_at: NOW - 1000 }],
  }, NOW);
  assert.deepStrictEqual(r.items.map((x) => [x.id, x.active, x.gens, x.feedbacks, x.creditsToday]), [['1', true, 2, 1, 2], ['2', false, 0, 0, 0]]);
  assert.strictEqual(r.items[0].pending, 'j2');
  assert.deepStrictEqual([r.active, r.gens, r.feedbacks], [1, 2, 1]);
  assert.deepStrictEqual([r.recent[0].name, r.recent[0].topic], ['Айдана', 'Су']);
});

test('json db: set tester, spend 3, blocked while pending, feedback unlocks, refund, admin credits, stop', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tst-'));
  process.env.DB_FILE = path.join(dir, 'db.json');
  delete require.cache[require.resolve('../storage/jsonDb')];
  const db = require('../storage/jsonDb');
  await db.initDB();
  await db.registerUser('9', null, null);
  await db.setUserProfile('9', { name: 'Тест', username: 'Tester_One' });
  assert.deepStrictEqual(await db.findUser({ username: 'tester_one' }), { chat_id: '9', name: 'Тест', username: 'Tester_One' });
  assert.strictEqual(await db.findUser({ username: 'nobody' }), null);
  assert.strictEqual(await db.useTesterCredit('9', NOW), null, 'тестер емес');

  await db.setTester('9', T.untilFor(7, NOW), NOW);
  assert.strictEqual(await db.useTesterCredit('9', NOW), 2);
  assert.strictEqual(await db.useTesterCredit('9', NOW), null, 'пікір күтіліп тұр (busy)');
  await db.setTesterPending('9', 'jA');
  assert.strictEqual(await db.useTesterCredit('9', NOW), null, 'пікір жазылмайынша — жоқ');
  await db.logTesterFeedback('jA', '9', 'Бәрі жақсы, 2-слайдта сурет сай емес');
  assert.strictEqual(await db.useTesterCredit('9', NOW), 1);
  await db.refundTesterCredit('9'); // генерация құлады
  assert.strictEqual((await db.getTester('9')).tester_credits, 2);
  assert.strictEqual((await db.getTester('9')).tester_pending, null);
  await db.useTesterCredit('9', NOW); await db.setTesterPending('9', null);
  await db.useTesterCredit('9', NOW); await db.setTesterPending('9', null);
  assert.strictEqual(await db.useTesterCredit('9', NOW), null, 'бүгінгі 3 бітті');
  assert.strictEqual((await db.addTesterCredits('9', 2, NOW)).tester_credits, 2, 'админ қосты');
  assert.strictEqual(await db.useTesterCredit('9', NOW + DAY), 2, 'ертең: 2 + толтыру → max(2,3)=3, біреуі жұмсалды');

  await db.logGen('jA', { chat_id: '9', tester: true, topic: 'Т', status: 'done', created_at: NOW });
  const td = await db.testerData();
  assert.deepStrictEqual([td.users.length, td.gens.length, td.feedback.length], [1, 1, 1]);
  await db.setTester('9', null, NOW + DAY);
  assert.strictEqual(T.isActive(await db.getTester('9'), NOW + DAY + 1), false, 'тоқтатылды, тарихы қалды');
  assert.strictEqual((await db.testerData()).users.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
