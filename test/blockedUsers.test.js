'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blk-')), 'db.json');
delete process.env.DATABASE_URL;
const db = require('../storage/jsonDb');

test('users who blocked the bot are skipped by broadcasts until they press /start again', async () => {
  await db.initDB();
  await db.registerUser('a'); await db.registerUser('b');
  await db.setBlocked('b', true);
  assert.deepStrictEqual((await db.getAllChatIds()).sort(), ['a']);
  await db.setBlocked('b', false);
  assert.deepStrictEqual((await db.getAllChatIds()).sort(), ['a', 'b']);
});
