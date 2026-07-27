import db from '../config/db.js'

const ref = 'BK20260719001'
const [rows] = await db.query(
  'SELECT booking_id FROM bookings WHERE booking_reference = ? OR email = ?',
  [ref, 'guard-verification@example.com']
)
console.log('found bookings', rows)

for (const r of rows) {
  await db.query('DELETE FROM occupied_dates WHERE booking_id = ?', [r.booking_id])
  await db.query('DELETE FROM booking_items WHERE booking_id = ?', [r.booking_id])
  await db.query('DELETE FROM booking_logs WHERE booking_id = ?', [r.booking_id])
  await db.query('DELETE FROM bookings WHERE booking_id = ?', [r.booking_id])
  console.log('deleted booking', r.booking_id)
}

const [inv] = await db.query(
  "DELETE FROM inventory_items WHERE name LIKE 'ZZ GUARD%'"
)
console.log('deleted inventory rows', inv.affectedRows)

// Also clear any orphaned occupied dates for deleted inventory
await db.query(
  `DELETE od FROM occupied_dates od
   LEFT JOIN inventory_items ii ON ii.item_id = od.inventory_item_id
   WHERE ii.item_id IS NULL`
)

await db.end()
console.log('cleanup done')
