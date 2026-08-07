import test from 'node:test';
import assert from 'node:assert/strict';

import { summarizeSalesLedger } from '../services/salesReportLedgerService.js';

const row = (overrides = {}) => ({
  source_key: 'pos:1',
  transaction_date: '2026-08-04T04:00:00.000Z',
  sales_channel: 'restaurant_pos',
  payment_method: 'Cash',
  gross_revenue: 1000,
  refunded_amount: 0,
  net_revenue: 1000,
  ...overrides,
});

test('sales ledger reconciles mutually exclusive channel, payment, and transaction totals', () => {
  const report = summarizeSalesLedger([
    row(),
    row({ source_key: 'pos:2', sales_channel: 'eshop', payment_method: 'GCash', gross_revenue: 500, net_revenue: 500 }),
    row({ source_key: 'booking:1', sales_channel: 'reservation', gross_revenue: 2000, refunded_amount: 300, net_revenue: 1700 }),
  ], { period: 'month', categoryItemRevenue: 1200, unclassifiedItemAmount: 100, unclassifiedItemCount: 1 });

  assert.deepEqual(report.summary, {
    grossSales: 3500,
    refundedAmount: 300,
    netSales: 3200,
    totalTransactions: 3,
    refundCount: 1,
  });
  assert.equal(report.transactionCounts.total, 3);
  assert.equal(report.transactionCounts.restaurant_pos, 1);
  assert.equal(report.transactionCounts.eshop, 1);
  assert.equal(report.transactionCounts.reservation, 1);
  assert.equal(report.reconciliation.channelTotal, 3500);
  assert.equal(report.reconciliation.paymentMethodTotal, 3500);
  assert.equal(report.reconciliation.unclassifiedAmount, 100);
  assert.equal(report.reconciliation.unclassifiedCount, 1);
  assert.equal(report.reconciliation.feesAndAdjustmentsAmount, 2200);
  assert.equal(report.reconciliation.isGrossReconciled, true);
  assert.equal(report.reconciliation.isPaymentReconciled, true);
  assert.equal(report.reconciliation.isTransactionCountReconciled, true);
});

test('sales ledger subtracts full and partial refunds exactly once', () => {
  const report = summarizeSalesLedger([
    row({ refunded_amount: 1000, net_revenue: 0 }),
    row({ source_key: 'pos:2', gross_revenue: 800, refunded_amount: 200, net_revenue: 600 }),
  ]);

  assert.equal(report.summary.grossSales, 1800);
  assert.equal(report.summary.refundedAmount, 1200);
  assert.equal(report.summary.netSales, 600);
  assert.equal(report.summary.refundCount, 2);
});

test('sales ledger groups weekly trends by Monday in Asia/Manila', () => {
  const report = summarizeSalesLedger([
    row({ transaction_date: '2026-08-04T04:00:00.000Z' }),
    row({ source_key: 'pos:2', transaction_date: '2026-08-09T04:00:00.000Z', gross_revenue: 500 }),
  ], { period: 'week' });

  assert.deepEqual(report.salesOverTime, [{ period: '2026-08-03', sales: 1500 }]);
});
