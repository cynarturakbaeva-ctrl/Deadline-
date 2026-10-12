'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { ratingKeyboard, ratePromptText, commentPromptText, parseFeedbackCallback, jobTagOf } = require('../core/feedbackUi');

test('баға батырмалары: 5 жұлдыз, таңдалғаны толық, callback ≤ 64 байт', () => {
  const kb = ratingKeyboard('jlx9k2ab3cd', 3);
  const row = kb.inline_keyboard[0];
  assert.deepStrictEqual(row.map((b) => b.text), ['⭐', '⭐', '⭐', '☆', '☆']);
  for (const b of row) assert.ok(Buffer.byteLength(b.callback_data) <= 64);
  assert.deepStrictEqual(parseFeedbackCallback(row[4].callback_data), { jobId: 'jlx9k2ab3cd', rating: 5 });
  assert.strictEqual(parseFeedbackCallback('fb:jlx9k2ab3cd:7'), null);
  assert.strictEqual(parseFeedbackCallback('rc:1:2'), null);
});

test('пікір: жұмыс нөмірі хабарлама мәтінінен оқылады (бот қайта қосылса да)', () => {
  assert.strictEqual(jobTagOf(ratePromptText('jlx9k2ab3cd')), 'jlx9k2ab3cd');
  assert.strictEqual(jobTagOf(commentPromptText('jlx9k2ab3cd', 4)), 'jlx9k2ab3cd');
  assert.ok(commentPromptText('jlx9k2ab3cd', 4).startsWith('⭐⭐⭐⭐ '));
  assert.strictEqual(jobTagOf('кез келген мәтін #хэштег'), null);
});

test('rateDueAt: 1 сағаттан кейін; түнге түссе — таңғы 10:00 (Алматы, UTC+5)', () => {
  const { rateDueAt } = require('../core/feedbackUi');
  const at = (iso) => Date.parse(iso); // UTC уақыты
  // 14:00 Алматы (09:00 UTC) → 15:00 Алматы
  assert.strictEqual(rateDueAt(at('2026-10-12T09:00:00Z')), at('2026-10-12T10:00:00Z'));
  // 22:30 Алматы → 23:30 түн → келесі күні 10:00 Алматы (05:00 UTC)
  assert.strictEqual(rateDueAt(at('2026-10-12T17:30:00Z')), at('2026-10-13T05:00:00Z'));
  // 02:00 Алматы → 03:00 түн → сол күні 10:00 Алматы
  assert.strictEqual(rateDueAt(at('2026-10-12T21:00:00Z')), at('2026-10-13T05:00:00Z'));
  // 07:30 Алматы → 08:30 → тыныштық біткен, сол уақыт
  assert.strictEqual(rateDueAt(at('2026-10-12T02:30:00Z')), at('2026-10-12T03:30:00Z'));
  // баптау: 30 минут
  assert.strictEqual(rateDueAt(at('2026-10-12T09:00:00Z'), { delayMin: 30 }), at('2026-10-12T09:30:00Z'));
});

test('JSON база: баға сұрауы кезегі — мерзімі жетпей берілмейді, бір рет қана, cleanup өшіреді', async () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-rate-'));
  fs.mkdirSync(path.join(dir, 'storage'));
  fs.copyFileSync(path.join(__dirname, '../storage/jsonDb.js'), path.join(dir, 'storage/jsonDb.js'));
  const db = require(path.join(dir, 'storage/jsonDb.js'));
  await db.initDB();
  const now = Date.now();
  assert.strictEqual(await db.scheduleRatePrompt({ jobId: 'jA', chatId: 1, kind: 'presentation', dueAt: now + 3600e3 }), true);
  assert.strictEqual(await db.scheduleRatePrompt({ jobId: 'jA', chatId: 1, dueAt: now }), false, 'бір жұмысқа бір сұрау');
  await db.scheduleRatePrompt({ jobId: 'jB', chatId: 2, kind: 'referat', dueAt: now - 1000 });
  assert.deepStrictEqual((await db.takeDueRatePrompts(now)).map((x) => [x.jobId, x.chatId, x.kind]), [['jB', '2', 'referat']]);
  assert.deepStrictEqual(await db.takeDueRatePrompts(now), [], 'екінші рет берілмейді');
  assert.strictEqual((await db.takeDueRatePrompts(now + 3600e3 + 1)).length, 1);
  await db.cleanupOldJobs(-60000);
  assert.strictEqual(await db.scheduleRatePrompt({ jobId: 'jA', chatId: 1, dueAt: now }), true, 'cleanup ескі сұрауларды өшірді');
});

test('comment prompt is optional: inline "write / skip" buttons, never force_reply (the menu stays visible)', () => {
  const { commentKeyboard, parseCommentCallback } = require('../core/feedbackUi');
  const kb = commentKeyboard('jlx9k2ab3cd');
  const btns = kb.inline_keyboard[0];
  assert.strictEqual(btns.length, 2);
  assert.deepStrictEqual(parseCommentCallback(btns[0].callback_data), { action: 'write', jobId: 'jlx9k2ab3cd' });
  assert.deepStrictEqual(parseCommentCallback(btns[1].callback_data), { action: 'skip', jobId: 'jlx9k2ab3cd' });
  assert.strictEqual(parseCommentCallback('fb:jlx9k2ab3cd:5'), null, 'rating callbacks are not comment callbacks');
  assert.ok(!('force_reply' in kb));
  assert.ok(/Өткізу/.test(commentPromptText('jlx9k2ab3cd', 5)));
});

test('the bot no longer asks for comments with force_reply', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'bot.js'), 'utf8');
  assert.ok(!/force_reply:\s*true/.test(src));
});
