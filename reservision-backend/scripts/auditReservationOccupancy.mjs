import db from '../config/db.js';
import { buildOccupiedDateRange, reserveInventoryDateRange } from '../services/reservationConflictService.js';

const apply = process.argv.includes('--apply');
const [candidates] = await db.query(
  `SELECT b.booking_id, b.booking_reference, b.check_in_date, b.check_out_date,
          bi.inventory_item_id, ii.item_id AS resolved_inventory_item_id, COALESCE(ii.name, bi.item_name) AS item_name
     FROM bookings b
     JOIN booking_items bi ON bi.booking_id = b.booking_id
     LEFT JOIN inventory_items ii ON ii.item_id = bi.inventory_item_id
     LEFT JOIN occupied_dates own_od
       ON own_od.booking_id = b.booking_id AND own_od.inventory_item_id = bi.inventory_item_id
    WHERE LOWER(COALESCE(b.booking_status, '')) NOT IN ('cancelled','checked-out','completed','expired')
      AND COALESCE(b.is_historical_import, 0) = 0
      AND LOWER(COALESCE(bi.item_type, '')) IN ('room','cottage')
      AND bi.inventory_item_id IS NOT NULL
      AND b.check_in_date IS NOT NULL AND b.check_out_date IS NOT NULL
    GROUP BY b.booking_id, bi.inventory_item_id
   HAVING COUNT(own_od.id) = 0
    ORDER BY b.check_in_date, b.booking_id`,
);

const report = [];
for (const booking of candidates) {
  const isoDate = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const startDate = isoDate(booking.check_in_date);
  const endDate = isoDate(booking.check_out_date);
  if (!booking.resolved_inventory_item_id) {
    report.push({ ...booking, status: 'INVENTORY_MISSING', reason: `Stale inventory ID ${booking.inventory_item_id}` });
    continue;
  }
  let dates;
  try { dates = buildOccupiedDateRange(startDate, endDate); }
  catch (error) { report.push({ ...booking, status: 'INVALID_DATES', reason: error.message }); continue; }
  const [conflicts] = await db.query(
    `SELECT od.occupied_date, b.booking_reference
       FROM occupied_dates od LEFT JOIN bookings b ON b.booking_id = od.booking_id
      WHERE od.inventory_item_id = ? AND od.occupied_date BETWEEN ? AND ? AND od.booking_id <> ? LIMIT 1`,
    [booking.inventory_item_id, dates[0], dates[dates.length - 1], booking.booking_id],
  );
  if (conflicts.length) {
    report.push({ ...booking, status: 'CONFLICT', reason: `${isoDate(conflicts[0].occupied_date)} / ${conflicts[0].booking_reference || 'unknown booking'}` });
    continue;
  }
  if (!apply) { report.push({ ...booking, status: 'READY_TO_BACKFILL', nights: dates.length }); continue; }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await reserveInventoryDateRange(connection, {
      inventoryItemId: booking.inventory_item_id,
      bookingId: booking.booking_id,
      startDate,
      endDate,
      itemName: booking.item_name,
      excludeBookingId: booking.booking_id,
    });
    await connection.query(
      `INSERT INTO booking_logs (booking_id, action, description, performed_by)
       VALUES (?, 'occupancy_backfilled', 'Missing occupied dates restored by Phase 3 reconciliation', 'Phase 3 migration')`,
      [booking.booking_id],
    );
    await connection.commit();
    report.push({ ...booking, status: 'BACKFILLED', nights: dates.length });
  } catch (error) {
    await connection.rollback();
    report.push({ ...booking, status: 'FAILED', reason: error.message });
  } finally { connection.release(); }
}

console.table(report.map(row => ({
  booking_id: row.booking_id,
  reference: row.booking_reference,
  item: row.item_name,
  status: row.status,
  nights: row.nights || '',
  reason: row.reason || '',
})));
const summary = report.reduce((acc, row) => { acc[row.status] = (acc[row.status] || 0) + 1; return acc; }, {});
console.log(JSON.stringify({ mode: apply ? 'APPLY' : 'DRY_RUN', candidates: candidates.length, summary }, null, 2));
await db.end();
