/**
 * Daily payment reconciliation job (Sprint 4.5 Task 08)
 * Usage: node scripts/paymentReconciliation.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import db from '../config/db.js';
import { BOOKING_STATUS, PAYMENT_STATUS, REFUND_STATUS } from '../utils/paymentStatuses.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const reportsDir = path.join(__dirname, '..', 'reports');

const today = new Date().toISOString().slice(0, 10);

const report = {
  generated_at: new Date().toISOString(),
  date: today,
  issues: {
    missing_payment: [],
    missing_refund: [],
    amount_mismatch: [],
  },
  summary: {
    missing_payment_count: 0,
    missing_refund_count: 0,
    amount_mismatch_count: 0,
  },
};

try {
  const [missingPayments] = await db.query(
    `SELECT b.booking_id, b.booking_reference, b.booking_status, b.payment_status, b.total
     FROM bookings b
     WHERE b.booking_status = ?
      AND b.payment_status NOT IN (?, ?)`,
    [BOOKING_STATUS.CONFIRMED, PAYMENT_STATUS.PAID, PAYMENT_STATUS.REFUNDED],
  );
  report.issues.missing_payment = missingPayments;
  report.summary.missing_payment_count = missingPayments.length;

  const [amountMismatches] = await db.query(
    `SELECT b.booking_id, b.booking_reference, b.total AS booking_total,
            p.payment_id, p.amount AS payment_amount, p.payment_gateway, p.status AS payment_record_status
     FROM bookings b
     JOIN payments p ON p.booking_id = b.booking_id
     WHERE b.payment_status = ?
       AND ABS(b.total - p.amount) > 0.01`,
    [PAYMENT_STATUS.PAID],
  );
  report.issues.amount_mismatch = amountMismatches;
  report.summary.amount_mismatch_count = amountMismatches.length;

  const [missingRefunds] = await db.query(
    `SELECT r.refund_id, r.refund_reference, r.refund_status, r.gateway_reference, r.gateway_status, r.refund_amount
     FROM refunds r
     WHERE r.refund_status = ?
       AND (r.gateway_status IS NULL OR UPPER(r.gateway_status) NOT IN ('SUCCEEDED', 'SUCCESS'))`,
    [REFUND_STATUS.COMPLETED],
  );
  report.issues.missing_refund = missingRefunds;
  report.summary.missing_refund_count = missingRefunds.length;

  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const outputPath = path.join(reportsDir, `payment-reconciliation-${today}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log(`Reconciliation report written: ${outputPath}`);
  console.log(`Issues — missing payment: ${report.summary.missing_payment_count}, amount mismatch: ${report.summary.amount_mismatch_count}, missing refund: ${report.summary.missing_refund_count}`);
  process.exit(report.summary.missing_payment_count + report.summary.amount_mismatch_count + report.summary.missing_refund_count > 0 ? 1 : 0);
} catch (error) {
  console.error('Reconciliation failed:', error);
  process.exit(1);
}
