'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freedb-'));
process.env.DB_FILE = path.join(dir, 'db.json');
delete process.env.DATABASE_URL;
const db = require('../storage/jsonDb');
const { exportToPptx } = require('../products/presentation/pptxExporter');

test('first presentation is free exactly once, never for buyers, and comes back if generation fails', async () => {
  await db.initDB();
  await db.registerUser('u1', null, 'madein');
  assert.strictEqual((await db.getUser('u1')).freeUsed, false);
  assert.strictEqual(await db.claimFreeDeck('u1'), true);
  assert.strictEqual(await db.claimFreeDeck('u1'), false, 'only once');
  assert.strictEqual((await db.getUser('u1')).freeUsed, true);
  assert.strictEqual(await db.countFreeDecksSince(Date.now() - 60000), 1);
  await db.releaseFreeDeck('u1');
  assert.strictEqual(await db.claimFreeDeck('u1'), true, 'refunded after a failed generation');

  await db.registerUser('buyer');
  await db.addCredits('buyer', 1);
  assert.strictEqual(await db.claimFreeDeck('buyer'), false, 'people who already paid do not get it');

  const ff = await db.freeFunnel();
  assert.strictEqual(ff.freeUsers, 1);
  const madein = ff.sources.find((s) => s.source === 'madein');
  assert.ok(madein && madein.users === 1 && madein.free === 1);
});

test('free decks carry a linked "Made in DeadLine" picture in every slide corner', async () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const f = path.join(dir, 's.png'); fs.writeFileSync(f, PNG);
  const out = await exportToPptx([f, f], 'T', [], { badge: { url: 'https://t.me/deadline_bot?start=madein', dark: true } });
  const zip = await JSZip.loadAsync(fs.readFileSync(out));
  for (const n of [1, 2]) {
    const xml = await zip.file(`ppt/slides/slide${n}.xml`).async('string');
    assert.strictEqual((xml.match(/<p:pic>/g) || []).length, 2, 'background + badge');
    assert.ok(/descr="Made in DeadLine"/.test(xml) && /hlinkClick/.test(xml));
    const rels = await zip.file(`ppt/slides/_rels/slide${n}.xml.rels`).async('string');
    assert.ok(rels.includes('start=madein'));
  }
  const plain = await exportToPptx([f], 'T', [], {});
  const x2 = await (await JSZip.loadAsync(fs.readFileSync(plain))).file('ppt/slides/slide1.xml').async('string');
  assert.strictEqual((x2.match(/<p:pic>/g) || []).length, 1, 'paid decks have no badge');
});
