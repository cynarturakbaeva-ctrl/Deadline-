'use strict';
/** Ескі нәтижелерді тазалау: база (JSON) және файлдар (server.js runCleanup логикасы). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('JSON база: 48 сағаттан ескі және тұрып қалған жұмыстар мен тарих өшеді, жаңалары қалады', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-ret-'));
  fs.mkdirSync(path.join(dir, 'storage'));
  fs.copyFileSync(path.join(__dirname, '../storage/jsonDb.js'), path.join(dir, 'storage/jsonDb.js'));
  const db = require(path.join(dir, 'storage/jsonDb.js'));
  await db.initDB();
  const fresh = await db.createJob('u1', { topic: 'жаңа' });
  await db.updateJob(fresh.id, { status: 'done' });
  const running = await db.createJob('u1', { topic: 'жүріп жатыр' });
  const old = await db.createJob('u1', { topic: 'ескі' });
  await db.updateJob(old.id, { status: 'done' });
  const stuck = await db.createJob('u1', { topic: 'тұрып қалған' });
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'data/db.json'), 'utf8'));
  const ago = Date.now() - 3 * 24 * 3600e3;
  raw.jobs[old.id].finished_at = ago; raw.jobs[old.id].created_at = ago;
  raw.jobs[stuck.id].created_at = ago;
  fs.writeFileSync(path.join(dir, 'data/db.json'), JSON.stringify(raw));
  await db.initDB();
  await db.addHistory('u1', { id: fresh.id, title: 'жаңа' });
  await db.addHistory('u1', { id: old.id, title: 'ескі', createdAt: ago });

  assert.strictEqual(await db.cleanupOldJobs(48 * 3600e3), 2);
  assert.ok(await db.getJob(fresh.id));
  assert.ok(await db.getJob(running.id));
  assert.strictEqual(await db.getJob(old.id), null);
  assert.strictEqual(await db.getJob(stuck.id), null);
  assert.deepStrictEqual((await db.getHistory('u1', 10)).map((h) => h.id), [fresh.id]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('server.js: тазалау сағат сайын жүреді, файлдар мен уақытша нәтижелер өшіріледі', () => {
  const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  assert.match(src, /JOB_RETENTION_HOURS \|\| '48'/);
  assert.match(src, /setInterval\(runCleanup, 60 \* 60 \* 1000\)/);
  assert.match(src, /removeOldFiles\(REF_DIR, cutoff\)/);
  assert.match(src, /removeOldFiles\(MATERIAL_DIR, cutoff\)/);
  assert.match(src, /fs\.unlinkSync\(result\.pptxPath\)/);
});
