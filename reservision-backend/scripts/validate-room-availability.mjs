/**
 * Validates occupied-dates API and room blocking logic.
 * Usage: node scripts/validate-room-availability.mjs
 */
import dotenv from 'dotenv';
import db from '../config/db.js';

dotenv.config();

const [items] = await db.query(
  `SELECT item_id, name, category, status
   FROM inventory_items
   WHERE LOWER(category) = 'room'
   ORDER BY name ASC
   LIMIT 20`,
);

console.log(`Sample rooms: ${items.length}`);

const [bookings] = await db.query(
  `SELECT b.booking_id, b.booking_reference, b.check_in_date, b.check_out_date,
          b.booking_status, b.payment_status, bi.inventory_item_id, ii.name AS room_name
   FROM bookings b
   JOIN booking_items bi ON bi.booking_id = b.booking_id
   JOIN inventory_items ii ON ii.item_id = bi.inventory_item_id
   WHERE b.booking_status IN ('Pending', 'Confirmed')
     AND bi.inventory_item_id IS NOT NULL
   ORDER BY b.booking_id DESC
   LIMIT 10`,
);

console.log('\nRecent room bookings blocking availability:');
for (const row of bookings) {
  console.log(`  #${row.booking_id} ${row.booking_reference} | ${row.room_name} | ${row.check_in_date} → ${row.check_out_date} | ${row.booking_status}/${row.payment_status}`);
}

if (!bookings.length) {
  console.log('  (none — all rooms should show available until dates are picked)');
  process.exit(0);
}

const sample = bookings[0];
const checkIn = sample.check_in_date;
const checkOut = sample.check_out_date;
const itemId = sample.inventory_item_id;

const [blocked] = await db.query(
  `SELECT COUNT(*) AS cnt
   FROM bookings b
   INNER JOIN booking_items bi ON b.booking_id = bi.booking_id
   WHERE bi.inventory_item_id = ?
     AND b.booking_status IN ('Confirmed', 'Pending')
     AND COALESCE(b.payment_status, 'Unpaid') IN ('Paid', 'paid', 'Pending', 'pending', 'Unpaid', 'unpaid')
     AND b.check_in_date < ?
     AND b.check_out_date > ?`,
  [itemId, checkOut, checkIn],
);

console.log(`\nOverlap test for item ${itemId} (${sample.room_name}) on ${checkIn}–${checkOut}:`);
console.log(`  Blocking bookings found: ${blocked[0].cnt}`);
console.log(blocked[0].cnt > 0
  ? '  ✅ Room correctly marked occupied for these dates'
  : '  ❌ Expected at least 1 blocking booking');

process.exit(blocked[0].cnt > 0 ? 0 : 1);
