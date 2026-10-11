'use strict';
// Регрессия: <a:rPr b="1" ... b="true"> — PowerPoint файлды ашпайды
const test = require('node:test');
const assert = require('node:assert');
const { dedupeAttrs, xmlProblem } = require('../products/presentation/templateFill');

test('қайталанған атрибут табылады және алынады, мәтін өзгермейді', () => {
  const x = '<a:p><a:r><a:rPr b="1" lang="kk-KZ" b="true" sz="2000"/><a:t>b=&quot;1&quot; b=&quot;2&quot;</a:t></a:r></a:p>';
  assert.match(xmlProblem(x), /қайталанған атрибут/);
  const d = dedupeAttrs(x);
  assert.strictEqual(xmlProblem(d), null);
  assert.ok(d.includes('<a:rPr b="1" lang="kk-KZ" sz="2000"/>'));
  assert.ok(d.includes('<a:t>b=&quot;1&quot; b=&quot;2&quot;</a:t>'));
  const clean = '<a:rPr lang="en-US" b="1"/>';
  assert.strictEqual(dedupeAttrs(clean), clean);
});
