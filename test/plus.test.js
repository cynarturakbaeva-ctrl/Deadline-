'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateReceipt } = require('../core/receipt');
const { PLUS, PRICE, FIRST_PRICE } = require('../core/pricing');

const base = (amount) => ({ ok: true, successful: true, recipient: 'Мурзабек Н', date: new Date(), amount, receiptNo: '1' });
const opts = { expectedName: 'Мурзабек Н', pricePerCredit: PRICE, firstPrice: FIRST_PRICE, bundles: [PLUS] };

test('Plus: 1990₸ = 50 credits', () => {
  assert.strictEqual(PLUS.amount, 1990);
  assert.strictEqual(PLUS.credits, 50);
  const v = validateReceipt(base(1990), opts);
  assert.ok(v.ok);
  assert.strictEqual(v.credits, 50);
});
test('ordinary prices still work, odd amounts rejected', () => {
  assert.strictEqual(validateReceipt(base(750), opts).credits, 3);
  assert.strictEqual(validateReceipt(base(1991), opts).ok, false);
  assert.strictEqual(validateReceipt(base(1990), { ...opts, bundles: [] }).ok, false);
});
