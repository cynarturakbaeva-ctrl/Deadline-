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
