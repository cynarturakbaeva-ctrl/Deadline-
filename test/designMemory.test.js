'use strict';
// Студенттің дизайн жады: соңғы жүйе/палитра/суреттер сақталады және келесі презентацияға «болдырмау» болып беріледі.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../core/designMemory');

test('merge: newest first, no duplicates, bounded; bad JSON → empty memory', () => {
  let m = M.parse('not json');
  assert.deepStrictEqual(m, { systems: [], moods: [], photos: [] });
  m = M.merge(m, { system: 'journal', mood: 'ivory' });
  m = M.merge(JSON.stringify(m), { system: 'swiss', mood: 'cloud', photos: ['wm:a.jpg', 'px:1'] });
  m = M.merge(m, { system: 'journal', mood: 'midnight', photos: ['px:1', 'fl:9'] });
  assert.deepStrictEqual(m.systems, ['journal', 'swiss']);
  assert.deepStrictEqual(m.moods, ['midnight', 'cloud', 'ivory']);
  assert.deepStrictEqual(m.photos, ['px:1', 'fl:9', 'wm:a.jpg']);
  for (let i = 0; i < 200; i++) m = M.merge(m, { photos: ['k' + i] });
  assert.strictEqual(m.photos.length, M.KEEP.photos);
  assert.deepStrictEqual(M.avoidOptions(m).designAvoid.systems, ['journal', 'swiss']);
});

test('json db: memory survives per student and feeds the next deck\'s choice', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-'));
  process.env.DB_FILE = path.join(dir, 'db.json');
  delete require.cache[require.resolve('../storage/jsonDb')];
  const db = require('../storage/jsonDb');
  await db.initDB();
  await db.registerUser('77', null, null);
  assert.deepStrictEqual(await db.getDesignMemory('77'), { systems: [], moods: [], photos: [] });
  await db.pushDesignMemory('77', { system: 'academy', mood: 'mint' });
  await db.pushDesignMemory('77', { photos: ['wm:x.jpg'] });
  const mem = await db.getDesignMemory('77');
  assert.deepStrictEqual(mem, { systems: ['academy'], moods: ['mint'], photos: ['wm:x.jpg'] });
  assert.deepStrictEqual(await db.getDesignMemory('nobody'), { systems: [], moods: [], photos: [] });

  const { applyDeckTheme } = require('../products/presentation/deckPolish');
  const avoid = M.avoidOptions(mem).designAvoid;
  for (let i = 0; i < 50; i++) {
    const d = applyDeckTheme([{}], { seed: 'Тақырып|g' + i, avoid });
    assert.notStrictEqual(d.system, 'academy');
    assert.notStrictEqual(d.mood, 'mint');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

let Pool = null;
try { ({ Pool } = require('pg')); } catch {}
const URL = process.env.TEST_DATABASE_URL;
test('pg db: design_memory column is added and round-trips', { skip: !URL || !Pool ? 'TEST_DATABASE_URL немесе pg жоқ' : false }, async () => {
  delete require.cache[require.resolve('../storage/pgDb')];
  const db = require('../storage/pgDb');
  const pool = new Pool({ connectionString: URL });
  db._setPool(pool);
  try {
    await db.initDB();
    const U = 'dm' + Date.now();
    await db.registerUser(U);
    await db.pushDesignMemory(U, { system: 'mono', mood: 'cold', photos: ['na:iss1'] });
    await db.pushDesignMemory(U, { system: 'atelier', mood: 'blush' });
    assert.deepStrictEqual(await db.getDesignMemory(U), { systems: ['atelier', 'mono'], moods: ['blush', 'cold'], photos: ['na:iss1'] });
  } finally { await pool.end(); }
});
