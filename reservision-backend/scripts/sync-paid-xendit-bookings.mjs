/**
 * Sync bookings where Xendit invoice is PAID but local DB was not updated (webhook missed).
 * Usage: node scripts/sync-paid-xendit-bookings.mjs [bookingId]
 */
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import db from '../config/db.js';
import { amountsMatch } from '../utils/bookingAmount.js';
import { BOOKING_STATUS, PAYMENT_RECORD_STATUS, PAYMENT_STATUS } from '../utils/paymentStatuses.js';

dotenv.config();

const XENDIT_API_KEY = process.env.XENDIT_SECRET_KEY;
const targetBookingId = process.argv[2] ? Number(process.argv[2]) : null;

const [rows] = await db.query(
  `SELECT b.booking_id, b.total, b.payment_status, p.payment_reference AS invoice_id
   FROM bookings b
   JOIN payments p ON p.booking_id = b.booking_id
   WHERE p.payment_gateway = 'xendit'
     AND p.status = 'pending'
     AND COALESCE(b.payment_status, '') NOT IN ('Paid', 'paid')
     ${targetBookingId ? 'AND b.booking_id = ?' : ''}
   ORDER BY b.booking_id DESC`,
  targetBookingId ? [targetBookingId] : [],
);

if (!rows.length) {
  console.log('No pending Xendit bookings to sync.');
  process.exit(0);
}

for (const row of rows) {
  const response = await fetch(`https://api.xendit.co/v2/invoices/${row.invoice_id}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${XENDIT_API_KEY}:`).toString('base64')}` },
  });
  const invoice = await response.json();

  const invoiceStatus = String(invoice.status).toUpperCase();
  if (!['PAID', 'SETTLED'].includes(invoiceStatus)) {
    console.log(`Booking ${row.booking_id}: Xendit status = ${invoice.status} (skip)`);
    continue;
  }

  if (String(invoice.external_id) !== String(row.booking_id)) {
    console.log(`Booking ${row.booking_id}: external_id mismatch`);
    continue;
  }

  if (!amountsMatch(invoice.amount, row.total)) {
    console.log(`Booking ${row.booking_id}: amount mismatch`);
    continue;
  }

  await db.query(
    `UPDATE bookings SET payment_status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE booking_id = ?`,
    [PAYMENT_STATUS.PAID, row.booking_id],
  );

  await db.query(
    `UPDATE payments SET status = ?, paid_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE booking_id = ? AND payment_gateway = 'xendit' AND payment_reference = ?`,
    [PAYMENT_RECORD_STATUS.PAID, invoice.paid_at ? new Date(invoice.paid_at) : new Date(), row.booking_id, row.invoice_id],
  );

  console.log(`Booking ${row.booking_id}: synced to Paid (booking_status unchanged — admin confirms separately)`);
}

process.exit(0);
