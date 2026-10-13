'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../core/admin');

const NOW = Date.UTC(2026, 9, 14, 9, 0); // 14.10, 14:00 Алматы
const H = 3600e3;
function sample() {
  return {
    users: [
      { chat_id: '1', name: 'Айдана', username: 'aidana', source: 'ad1', credits: 2, total: 3, free_used: true, created_at: NOW - 40 * H, last_success_at: NOW - 2 * H },
      { chat_id: '2', name: null, username: 'erlan', source: null, referred_by: '1', credits: 0, total: 0, free_used: true, created_at: NOW - 30 * H },
      { chat_id: '3', name: 'Блок', source: 'tiktok', credits: 0, total: 0, blocked: true, created_at: NOW - 300 * H },
    ],
    gens: [
      { job_id: 'j1', chat_id: '1', mode: 'presentation', topic: 'Су айналымы', slides: 8, free: false, status: 'done', cost_tg: 12.4, duration_ms: 70000, quality: 96, created_at: NOW - 2 * H },
      { job_id: 'j2', chat_id: '2', mode: 'presentation', topic: 'Кадастр', slides: 10, free: true, status: 'done', cost_tg: 14, created_at: NOW - 26 * H },
      { job_id: 'j3', chat_id: '1', mode: 'referat', topic: 'Тарих', status: 'failed', error: 'timeout', created_at: NOW - 3 * H },
    ],
    receipts: [
      { receipt_no: 'r1', chat_id: '1', amount: 250, credits: 1, status: 'confirmed', created_at: NOW - 5 * H },
      { receipt_no: 'm:1:1', chat_id: '1', amount: 500, credits: 2, status: 'manual', created_at: NOW - 27 * H },
    ],
    feedback: [
      { job_id: 'j1', chat_id: '1', rating: 5, comment: 'керемет', created_at: NOW - H },
      { job_id: 'j2', chat_id: '2', rating: 3, comment: null, created_at: NOW - 25 * H },
    ],
    events: [
      { chat_id: '2', kind: 'new', day: '2026-10-13', source: 'ref' },
      { chat_id: '2', kind: 'start', day: '2026-10-13', source: 'ref' },
      { chat_id: '1', kind: 'app', day: '2026-10-14', source: 'ad1' },
      { chat_id: '1', kind: 'gen', day: '2026-10-14', source: 'ad1' },
    ],
  };
}

test('overview: today / yesterday / totals in Almaty days', () => {
  const o = A.overview(sample(), { days: 7, now: NOW });
  assert.strictEqual(o.series.length, 7);
  assert.strictEqual(o.series[6].day, '2026-10-14');
  assert.deepStrictEqual([o.today.gens, o.today.failed, o.today.revenue, o.today.payments, o.today.rating, o.today.app], [2, 1, 250, 1, 5, 1]);
  assert.deepStrictEqual([o.yesterday.gens, o.yesterday.free, o.yesterday.revenue, o.yesterday.new, o.yesterday.rating], [1, 1, 500, 1, 3]);
  assert.strictEqual(o.week.revenue, 750);
  assert.strictEqual(o.week.cost, 26);
  assert.deepStrictEqual(o.totals, { users: 3, paying: 1, freeUsed: 2, blocked: 1, creditsLeft: 2 });
  assert.strictEqual(o.lowRatings, 1);
  assert.deepStrictEqual(o.sources.find((s) => s.source === 'ref'), { source: 'ref', new: 1, start: 1, app: 0, gen: 0, paid: 0 });
});

test('users: search by name/@username/id, filters, enrichment', () => {
  const d = sample();
  assert.deepStrictEqual(A.usersList(d, { q: '@erl', now: NOW }).items.map((u) => u.id), ['2']);
  assert.deepStrictEqual(A.usersList(d, { q: '3', now: NOW }).items.map((u) => u.id), ['3']);
  assert.deepStrictEqual(A.usersList(d, { filter: 'paying', now: NOW }).items.map((u) => u.id), ['1']);
  assert.deepStrictEqual(A.usersList(d, { filter: 'free', now: NOW }).items.map((u) => u.id), ['2']);
  assert.deepStrictEqual(A.usersList(d, { filter: 'blocked', now: NOW }).items.map((u) => u.id), ['3']);
  const u1 = A.usersList(d, { now: NOW }).items[0];
  assert.deepStrictEqual([u1.id, u1.gens, u1.paidSum, u1.lastRating, u1.source], ['1', 2, 750, 5, 'ad1']);
  assert.strictEqual(A.usersList(d, { q: 'erlan', now: NOW }).items[0].source, 'ref');
  assert.strictEqual(A.usersList(d, { q: 'erlan', now: NOW }).items[0].name, '@erlan');
});

test('gens: rating + comment joined, filters', () => {
  const d = sample();
  const all = A.gensList(d);
  assert.deepStrictEqual(all.items.map((g) => g.jobId), ['j1', 'j3', 'j2']);
  assert.deepStrictEqual([all.items[0].rating, all.items[0].comment, all.items[0].name, all.items[0].durationS], [5, 'керемет', 'Айдана', 70]);
  assert.deepStrictEqual(A.gensList(d, { filter: 'low' }).items.map((g) => g.jobId), ['j2']);
  assert.deepStrictEqual(A.gensList(d, { filter: 'failed' }).items.map((g) => g.jobId), ['j3']);
  assert.deepStrictEqual(A.gensList(d, { filter: 'referat' }).items.map((g) => g.jobId), ['j3']);
  assert.deepStrictEqual(A.gensList(d, { filter: 'free' }).items.map((g) => g.jobId), ['j2']);
});

test('payments + user detail', () => {
  const d = sample();
  const p = A.paymentsList(d);
  assert.deepStrictEqual([p.total, p.sum, p.items[0].kind, p.items[1].kind], [2, 750, 'чек', 'қолмен']);
  const one = A.userDetail({ ...d, users: d.users.filter((u) => u.chat_id === '1'), gens: d.gens.filter((g) => g.chat_id === '1'), receipts: d.receipts, feedback: d.feedback.filter((f) => f.chat_id === '1'), events: d.events.filter((e) => e.chat_id === '1') }, '1');
  assert.deepStrictEqual([one.gens.length, one.payments.length, one.paidSum, one.activeDays], [2, 2, 750, 1]);
  assert.strictEqual(A.userDetail(d, 'nope'), null);
});

test('json db: gen log, manual payment, profile → adminData', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adm-'));
  process.env.DB_FILE = path.join(dir, 'db.json');
  delete require.cache[require.resolve('../storage/jsonDb')];
  const db = require('../storage/jsonDb');
  await db.initDB();
  await db.registerUser('7', null, 'ad1');
  await db.setUserProfile('7', { name: 'Тест Адам', username: 'test' });
  await db.logGen('jX', { chat_id: '7', mode: 'presentation', topic: 'T', free: true, status: 'queued', created_at: Date.now() });
  await db.logGen('jX', { status: 'done', title: 'Тақырып', cost_tg: 11 });
  await db.logPayment('7', 250, 1, 'm:7:1');
  await db.logPayment('7', 250, 1, 'm:7:1'); // қайталанбайды
  const d = await db.adminData({ since: 0 });
  assert.deepStrictEqual([d.users[0].name, d.users[0].username], ['Тест Адам', 'test']);
  assert.deepStrictEqual([d.gens[0].status, d.gens[0].title, d.gens[0].topic, d.gens[0].cost_tg], ['done', 'Тақырып', 'T', 11]);
  assert.strictEqual(d.receipts.length, 1);
  assert.strictEqual((await db.getUser('7')).credits, 0, 'logPayment кредит қоспайды');
  const mine = await db.adminData({ chatId: '7' });
  assert.strictEqual(mine.gens.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
