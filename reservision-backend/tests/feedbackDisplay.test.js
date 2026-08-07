import test from 'node:test';
import assert from 'node:assert/strict';
import { getPublicCustomerName, maskCustomerName } from '../utils/feedbackDisplay.js';

test('public customer names expose only first name and last initial', () => {
  assert.equal(maskCustomerName('John Rhey Tamares'), 'John T.');
  assert.equal(maskCustomerName(' Maria   Santos '), 'Maria S.');
  assert.equal(maskCustomerName('Maria'), 'Maria');
  assert.equal(maskCustomerName('J'), 'J');
  assert.equal(maskCustomerName(null), 'Verified Guest');
});

test('anonymous feedback never exposes the supplied name', () => {
  assert.equal(
    getPublicCustomerName({ isAnonymous: true, customerName: 'Private Person' }),
    'Anonymous Guest',
  );
});
