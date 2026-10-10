'use strict';
/** Серіктес бағдарламасы: рұқсат, пайыз, қайталанудан қорғау, төлем (JSON база). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-par-'));
  fs.mkdirSync(path.join(dir, 'storage'));
  fs.copyFileSync(path.join(__dirname, '../storage/jsonDb.js'), path.join(dir, 'storage/jsonDb.js'));
  const db = require(path.join(dir, 'storage/jsonDb.js'));
  await db.initDB();
  return db;
}

test('серіктес: рұқсатсыз пайыз жоқ, рұқсаттан кейін әр төлемнен 30%', async () => {
  const db = await freshDb();
  await db.registerUser('P', null);
  await db.registerUser('B', 'P');
  assert.strictEqual((await db.getPartner('P')).status, 'none');
  assert.strictEqual(await db.creditPartnerCommission('B', 1000, 'r:1'), null, 'серіктес емес — пайыз жоқ');

  assert.strictEqual(await db.requestPartner('P'), 'pending');
  assert.strictEqual(await db.creditPartnerCommission('B', 1000, 'r:2'), null, 'күтілуде — пайыз жоқ');
  await db.setPartnerStatus('P', 'active');

  const r1 = await db.creditPartnerCommission('B', 990, 'r:3');
  assert.deepStrictEqual(r1, { partnerId: 'P', commission: 297 });
  assert.strictEqual(await db.creditPartnerCommission('B', 990, 'r:3'), null, 'қайталанған чек — қайта есептелмейді');
  await db.creditPartnerCommission('B', 2000, 'r:4');
  const p = await db.getPartner('P');
  assert.deepStrictEqual([p.balance, p.earned, p.paid, p.buyers], [897, 897, 0, 1]);
});

test('серіктес: өзін-өзі шақыру және шақырушысыз клиент пайыз бермейді; төлем балансты кемітеді', async () => {
  const db = await freshDb();
  await db.registerUser('P', null);
  await db.requestPartner('P'); await db.setPartnerStatus('P', 'active');
  await db.registerUser('F', null);
  assert.strictEqual(await db.creditPartnerCommission('F', 1000, 'x:1'), null, 'шақырушысы жоқ');
  await db.registerUser('B', 'P');
  await db.creditPartnerCommission('B', 1000, 'x:2');
  assert.strictEqual(await db.payoutPartner('P', 500), null, 'баланстан артық алынбайды');
  assert.strictEqual(await db.payoutPartner('P', 100), 200);
  const p = await db.getPartner('P');
  assert.deepStrictEqual([p.balance, p.earned, p.paid], [200, 300, 100]);
  assert.strictEqual(await db.requestPartner('P'), 'active', 'белсенді серіктес қайта сұрата алмайды');
  assert.strictEqual((await db.listPartners()).length, 1);
});
