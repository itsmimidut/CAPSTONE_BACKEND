import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRemainingRefundableAmount, canRejectRefundStatus, getRefundCompletionState, sanitizeSpreadsheetCell } from '../utils/refundPolicy.js';

test('only pending refunds can be rejected', () => {
  assert.equal(canRejectRefundStatus('Pending'), true);
  for (const status of ['Processing', 'Completed', 'Failed', 'Rejected']) {
    assert.equal(canRejectRefundStatus(status), false);
  }
});

test('partial refunds preserve a partial booking/payment state', () => {
  assert.deepEqual(getRefundCompletionState('Partial'), {
    bookingStatus: 'Partially Refunded',
    paymentStatus: 'Partially Refunded',
    updatePaymentRecordAsRefunded: false,
  });
});

test('full refunds close the booking and payment', () => {
  assert.deepEqual(getRefundCompletionState('Full'), {
    bookingStatus: 'Cancelled',
    paymentStatus: 'Refunded',
    updatePaymentRecordAsRefunded: true,
  });
});

test('spreadsheet cells neutralize formula prefixes', () => {
  for (const value of ['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '\tformula', '\rformula']) {
    assert.equal(sanitizeSpreadsheetCell(value), `'${value}`);
  }
  assert.equal(sanitizeSpreadsheetCell('Normal customer'), 'Normal customer');
});

test('remaining refundable balance prevents cumulative over-refunds', () => {
  assert.equal(calculateRemainingRefundableAmount({ paidAmount: 10000, completedRefundAmount: 2500 }), 7500);
  assert.equal(calculateRemainingRefundableAmount({ paidAmount: 10000, completedRefundAmount: 12000 }), 0);
});
