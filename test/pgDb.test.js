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
