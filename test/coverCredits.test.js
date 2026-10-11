'use strict';
/** Титул деректері: толтырылған өрістердің бәрі 1-слайдқа шығады және кейінгі кезең қысқартса да қайта қойылады. */
const test = require('node:test');
const assert = require('node:assert');
const { parseCoverMeta, applyCoverCredits } = require('../products/presentation/gemini');

const input = 'Тақырып. 8 слайд\nУниверситет: Есенов университеті\nФакультет: Инжиниринг\nКафедра: Ақпараттық жүйелер\nТоп: ИС-23\nОрындаған: Нұрқаев М.\nТексерген: Сәрсенбаева А.';

test('барлық 6 өріс оқылады және титулға толық қойылады', () => {
  const m = parseCoverMeta(input);
  assert.deepStrictEqual(
    [m.university, m.faculty, m.department, m.group, m.performedBy, m.checkedBy],
    ['Есенов университеті', 'Инжиниринг', 'Ақпараттық жүйелер', 'ИС-23', 'Нұрқаев М.', 'Сәрсенбаева А.']
  );
  const cover = { title: 'T', subtitle: 'Қысқа', bullets: ['x'] };
  assert.ok(applyCoverCredits(cover, m, 'Kazakh'));
  assert.strictEqual(cover.bullets.length, 6);
  // кейінгі кезең (review/composition) қысқартты → қайта қойылады
  cover.bullets = cover.bullets.slice(0, 2);
  applyCoverCredits(cover, m, 'Kazakh');
  assert.deepStrictEqual(cover.bullets, [
    'Есенов университеті', 'Факультет: Инжиниринг', 'Кафедра: Ақпараттық жүйелер',
    'Орындаған: Нұрқаев М.', 'Тексерген: Сәрсенбаева А.', 'Топ: ИС-23',
  ]);
});

test('тек аты-жөн мен оқытушы толтырылса — тек солар; бос болса титул өзгермейді', () => {
  const cover = { title: 'T', bullets: ['a', 'b'] };
  applyCoverCredits(cover, parseCoverMeta('Т\nОрындаған: А\nТексерген: Б'), 'Russian');
  assert.deepStrictEqual(cover.bullets, ['Выполнил(а): А', 'Проверил(а): Б']);
  const c2 = { title: 'T', bullets: ['a'] };
  assert.strictEqual(applyCoverCredits(c2, parseCoverMeta('Т'), 'Kazakh'), false);
  assert.deepStrictEqual(c2.bullets, ['a']);
});
