'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { foldFunnel, funnelText } = require('../core/funnel');

test('funnel: json db counts each step once per person per day, attributes it to the /start source', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'funnel-'));
  process.env.DB_FILE = path.join(dir, 'db.json');
  delete require.cache[require.resolve('../storage/jsonDb')];
  const db = require('../storage/jsonDb');
  await db.initDB();
  const t = Date.UTC(2026, 9, 13, 6, 0); // 11:00 Алматы
  const day = db.funnelDay(t);
  assert.strictEqual(day, '2026-10-13');
  assert.strictEqual(db.funnelDay(Date.UTC(2026, 9, 12, 19, 30)), '2026-10-13', 'Алматы түн ортасынан кейін — жаңа күн');

  assert.strictEqual(await db.registerUser('1', null, 'ad_a'), true);
  assert.strictEqual(await db.registerUser('1', null, 'ad_a'), false, 'екінші /start — жаңа адам емес');
  await db.logEvent('1', 'new', 'ad_a', t);
  await db.logEvent('1', 'start', 'ad_a', t);
  await db.logEvent('1', 'start', 'ad_a', t + 1000); // қайталанған /start — бір рет
  await db.logEvent('1', 'app', null, t + 2000);     // арнасы /start-тан
  await db.logEvent('1', 'gen', null, t + 3000);
  await db.logEvent('1', 'free', null, t + 3000);

  await db.registerUser('2', null, 'tiktok');          // ертеде тіркелген, бүгін белгісіз /start
  await db.logEvent('2', 'start', null, t);
  await db.logEvent('2', 'app', null, t);
  await db.logEvent('3', 'app', null, t);              // тіркелмеген → direct

  const f = await db.funnelStats(day);
  assert.deepStrictEqual(f.total, { new: 1, start: 2, app: 3, gen: 1, free: 1, paid: 0 });
  const by = Object.fromEntries(f.sources.map((x) => [x.source, x]));
  assert.strictEqual(by.ad_a.app, 1);
  assert.strictEqual(by.ad_a.gen, 1);
  assert.strictEqual(by.tiktok.start, 1);
  assert.strictEqual(by.direct.app, 1);
  assert.deepStrictEqual((await db.funnelStats('2026-10-12')).total.start, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('funnel text shows conversion between steps', () => {
  const today = foldFunnel('2026-10-13', [
    { source: 'ad_a', kind: 'start', n: 40 }, { source: 'ad_a', kind: 'app', n: 10 }, { source: 'ad_a', kind: 'gen', n: 5 },
    { source: 'ad_a', kind: 'free', n: 5 }, { source: 'ad_a', kind: 'new', n: 30 }, { source: 'direct', kind: 'app', n: 2 },
  ]);
  const txt = funnelText(today, foldFunnel('2026-10-12', []));
  assert.match(txt, /жаңа адам 30 · \/start 40 → Mini App 12 \(30%\) → жасатты 5 \(тегін 5\) → төледі 0/);
  assert.match(txt, /• ad_a: жаңа 30 · \/start 40 → Mini App 10 \(25%\)/);
  assert.match(txt, /Кеше: жаңа 0/);
});
