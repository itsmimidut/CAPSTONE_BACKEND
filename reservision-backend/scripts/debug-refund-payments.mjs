import db from '../config/db.js';

const [refunds] = await db.query(
  `SELECT refund_id, booking_id, refund_amount, refund_status, original_amount
   FROM refunds
   ORDER BY refund_id DESC
   LIMIT 10`,
);

for (const r of refunds) {
  const [payments] = await db.query(
    `SELECT payment_id, payment_reference, payment_gateway, status, amount, payment_method, created_at
     FROM payments
     WHERE booking_id = ?
     ORDER BY created_at DESC`,
    [r.booking_id],
  );
  const [booking] = await db.query(
    `SELECT booking_id, payment_status, payment_method, total, booking_status
     FROM bookings WHERE booking_id = ?`,
    [r.booking_id],
  );

  console.log('\n--- Refund', r.refund_id, '| booking', r.booking_id, '| refund', r.refund_amount, '|', r.refund_status);
  console.log('Booking:', booking[0]);
  console.log('Payments:', payments);
}

process.exit(0);
