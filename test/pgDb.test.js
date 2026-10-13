'use strict';
/**
 * PostgreSQL бэкенді (storage/pgDb.js). Тек TEST_DATABASE_URL берілсе және `pg` орнатылса жүреді:
 *   TEST_DATABASE_URL=postgres://user:pass@host:5432/testdb npm test
 * НАЗАР: тест кестелерге жазады — тек бос ТЕСТ базасын беріңіз, жұмыс базасын емес.
 */
const test = require('node:test');
const assert = require('node:assert');

let Pool = null;
try { ({ Pool } = require('pg')); } catch {}
const URL = process.env.TEST_DATABASE_URL;
const skip = !URL || !Pool ? 'TEST_DATABASE_URL немесе pg жоқ' : false;

test('pgDb: кредит, чек, жұмыс, тарих — нақты PostgreSQL-де', { skip }, async () => {
  delete require.cache[require.resolve('../storage/pgDb')];
  const db = require('../storage/pgDb');
  const pool = new Pool({ connectionString: URL });
  db._setPool(pool);
  try {
    await db.initDB();
    const U = 't' + Date.now();
    await db.registerUser(U);
    assert.strictEqual(await db.useCredit(U), false);
    assert.strictEqual((await db.applyReceipt(U, 'R' + U, 990, 2)).applied, true);
    assert.strictEqual((await db.applyReceipt(U, 'R' + U, 990, 2)).applied, false, 'чек бір рет');
    const ok = await Promise.all(Array.from({ length: 5 }, () => db.useCredit(U)));
    assert.strictEqual(ok.filter(Boolean).length, 2, 'параллель списание атомарлы');
    assert.strictEqual((await db.getUser(U)).credits, 0);
    const job = await db.createJob(U, { topic: 'тест', text: 'a\u0000b' });
    await db.updateJob(job.id, { status: 'done', progress: 100, pptxPath: '/x' });
    const got = await db.getJob(job.id);
    assert.strictEqual(got.status, 'done'); assert.ok(got.finishedAt > 0);
    assert.strictEqual(got.payload.text, 'ab');
    await db.addHistory(U, { id: job.id, title: 'T', createdAt: Date.now() });
    assert.strictEqual((await db.getHistory(U, 5))[0].id, job.id);
  } finally {
    await pool.end();
  }
});

test('pgDb: воронка — қадам бір адамға бір күнде бір рет, арна /start-тан алынады', { skip }, async () => {
  delete require.cache[require.resolve('../storage/pgDb')];
  const db = require('../storage/pgDb');
  const pool = new Pool({ connectionString: URL });
  db._setPool(pool);
  try {
    await db.initDB();
    const id = 'fn' + Date.now();
    const t = Date.UTC(2031, 0, 5, 6, 0);
    const day = db.funnelDay(t);
    assert.strictEqual(await db.registerUser(id, null, 'ad_x'), true);
    assert.strictEqual(await db.registerUser(id, null, 'ad_x'), false);
    await db.logEvent(id, 'new', 'ad_x', t);
    await db.logEvent(id, 'start', 'ad_x', t);
    await db.logEvent(id, 'start', 'ad_y', t + 5); // сол күні қайта — есептелмейді
    await db.logEvent(id, 'app', null, t + 10);
    await db.logEvent(id, 'gen', null, t + 20);
    await db.logEvent(id, 'paid', null, t + 30);
    await db.logEvent(id + 'z', 'app', null, t);    // тіркелмеген → direct
    const f = await db.funnelStats(day);
    const a = f.sources.find((x) => x.source === 'ad_x');
    assert.deepStrictEqual([a.new, a.start, a.app, a.gen, a.paid], [1, 1, 1, 1, 1]);
    assert.strictEqual(f.sources.find((x) => x.source === 'direct').app, 1);
    assert.strictEqual(f.total.start, 1);
  } finally {
    await pool.query("DELETE FROM events WHERE day = '2031-01-05'").catch(() => {});
    await pool.end();
  }
});

test('pgDb: админ — генерация журналы, қолмен төлем, аты-жөні → adminData', { skip }, async () => {
  delete require.cache[require.resolve('../storage/pgDb')];
  const db = require('../storage/pgDb');
  const pool = new Pool({ connectionString: URL });
  db._setPool(pool);
  const id = 'adm' + Date.now();
  try {
    await db.initDB();
    await db.registerUser(id, null, 'ad1');
    await db.setUserProfile(id, { name: 'Тест Адам', username: 'tester' });
    const t = Date.now();
    await db.logGen('j' + id, { chat_id: id, mode: 'presentation', topic: 'Тақырып', slides: 8, free: true, status: 'queued', created_at: t });
    await db.logGen('j' + id, { status: 'done', title: 'Дайын', quality: 95.5, cost_tg: 12.3, tokens: 40000, duration_ms: 70000, finished_at: t + 70000 });
    await db.logPayment(id, 250, 1, 'm:' + id);
    await db.logPayment(id, 250, 1, 'm:' + id);
    await db.setFeedback('j' + id, id, { rating: 2, comment: 'нашар' });
    const d = await db.adminData({ chatId: id });
    assert.deepStrictEqual([d.users[0].name, d.users[0].username, d.users[0].credits], ['Тест Адам', 'tester', 0]);
    assert.deepStrictEqual([d.gens[0].status, d.gens[0].topic, d.gens[0].title, d.gens[0].slides, d.gens[0].free, d.gens[0].cost_tg], ['done', 'Тақырып', 'Дайын', 8, true, 12.3]);
    assert.strictEqual(d.receipts.length, 1);
    assert.deepStrictEqual([d.receipts[0].amount, d.receipts[0].status], [250, 'manual']);
    assert.strictEqual(d.feedback[0].rating, 2);
    const all = await db.adminData({ since: t - 1000 });
    assert.ok(all.gens.some((g) => g.job_id === 'j' + id));
    assert.ok(all.users.length >= 1);
    const calc = require('../core/admin');
    assert.strictEqual(calc.gensList(all, { filter: 'low' }).items.find((g) => g.jobId === 'j' + id).comment, 'нашар');
  } finally {
    await pool.query('DELETE FROM gen_log WHERE chat_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM receipts WHERE chat_id = $1', [id]).catch(() => {});
    await pool.end();
  }
});

test('pgDb: тестер режимі — күніне 3, пікірсіз келесісі жоқ, атомарлы, @username бойынша табу', { skip }, async () => {
  delete require.cache[require.resolve('../storage/pgDb')];
  const db = require('../storage/pgDb');
  const T = require('../core/tester');
  const pool = new Pool({ connectionString: URL });
  db._setPool(pool);
  try {
    await db.initDB();
    const U = 'tt' + Date.now();
    const NOW = Date.now();
    await db.registerUser(U);
    await db.setUserProfile(U, { name: 'Тестер', username: 'Tst_' + U });
    assert.strictEqual((await db.findUser({ username: ('tst_' + U).toLowerCase() })).chat_id, U);
    assert.strictEqual(await db.useTesterCredit(U, NOW), null, 'тестер емес');
    await db.setTester(U, T.untilFor(7, NOW), NOW);
    // параллель 3 сұраныс — тек біреуі өтеді (busy)
    const got = await Promise.all([1, 2, 3].map(() => db.useTesterCredit(U, NOW)));
    assert.deepStrictEqual(got.filter((x) => x != null), [2]);
    await db.setTesterPending(U, 'job-' + U);
    assert.strictEqual(await db.useTesterCredit(U, NOW), null, 'пікір күтілуде');
    await db.logTesterFeedback('job-' + U, U, 'Сурет сай емес, фактілер дұрыс');
    assert.strictEqual(await db.useTesterCredit(U, NOW), 1);
    await db.refundTesterCredit(U);
    assert.strictEqual((await db.getTester(U)).tester_credits, 2);
    assert.strictEqual((await db.addTesterCredits(U, 3, NOW)).tester_credits, 5);
    assert.strictEqual(await db.useTesterCredit(U, NOW + 86400e3), 4, 'ертең: 5 сақталды (3-ке түспейді), біреуі жұмсалды');
    await db.logGen('job-' + U, { chat_id: U, tester: true, topic: 'T', status: 'done', created_at: NOW });
    const td = await db.testerData();
    assert.ok(td.users.some((u) => u.chat_id === U && u.tester_until > NOW));
    assert.ok(td.gens.some((g) => g.job_id === 'job-' + U));
    assert.ok(td.feedback.some((f) => f.job_id === 'job-' + U && /Сурет/.test(f.text)));
    await db.setTester(U, null, NOW + 1000);
    assert.strictEqual(T.isActive(await db.getTester(U), NOW + 2000), false);
  } finally {
    await pool.end();
  }
});
