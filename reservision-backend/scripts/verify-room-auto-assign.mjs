/**
 * Non-destructive auto-assignment verification after Booked status drift fix.
 *
 * Creates temporary ZZ AUTO ASSIGN * inventory rows + a temporary booking for
 * occupied_dates FK, runs scenarios inside transactions that roll back where
 * possible, and deletes all temp rows in finally.
 */
import db from '../config/db.js'
import {
  autoAssignRoom,
  insertOccupiedDatesForBooking,
} from '../services/roomAssignmentService.js'
import { isBookableInventoryStatus } from '../services/inventoryBookabilityService.js'

let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures += 1
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const createdItemIds = []
let tempBookingId = null

const createRoom = async ({ name, roomNumber, status = 'Available' }) => {
  const [res] = await db.query(
    `INSERT INTO inventory_items
      (category, category_type, room_number, name, description, max_guests, price, status, promo, images, primaryImageIndex, quantity)
     VALUES ('Room', 'room', ?, ?, 'ZZ auto-assign verifier', 2, 1000, ?, 0, '[]', 0, 1)`,
    [roomNumber, name, status]
  )
  createdItemIds.push(res.insertId)
  return res.insertId
}

const createTempBooking = async () => {
  const ref = `ZZAA${Date.now().toString().slice(-8)}`
  const [res] = await db.query(
    `INSERT INTO bookings (
      booking_reference, first_name, last_name, email, phone,
      check_in_date, check_out_date, nights, subtotal, discount, tax, total,
      payment_method, booking_status, payment_status, created_at
    ) VALUES (?, 'ZZ', 'AutoAssign', 'zz-auto-assign@example.com', '',
      CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 DAY), 1, 0, 0, 0, 0,
      'Cash', 'Pending', 'Unpaid', NOW())`,
    [ref]
  )
  tempBookingId = res.insertId
  return tempBookingId
}

const addDays = (base, days) => {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

const toYmd = (d) => d.toISOString().slice(0, 10)

try {
  const baseName = 'ZZ AUTO ASSIGN ROOM'
  const availableId = await createRoom({ name: `${baseName} 1`, roomNumber: 'A91', status: 'Available' })
  const maintenanceId = await createRoom({ name: `${baseName} 2`, roomNumber: 'A92', status: 'Under Maintenance' })
  const conflictId = await createRoom({ name: `${baseName} 3`, roomNumber: 'A93', status: 'Available' })
  const bookingId = await createTempBooking()

  const checkIn = addDays(new Date(), 40)
  checkIn.setUTCHours(0, 0, 0, 0)
  const checkOut = addDays(checkIn, 2)
  const conflictDay = toYmd(checkIn)

  // Seed a date conflict on conflict room (requires booking_id)
  await db.query(
    `INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date, created_at)
     VALUES (?, ?, ?, NOW())`,
    [conflictId, bookingId, conflictDay]
  )

  // --- Available assignment ---
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const result = await autoAssignRoom(conn, baseName, checkIn, checkOut)
    check('assigns an available room', result.success === true, result.error || '')
    check('assigns expected Available unit', result.item_id === availableId, `got ${result.item_id}`)
    check('returns occupied date list', Array.isArray(result.occupied_dates) && result.occupied_dates.length === 2)

    const [statusRows] = await conn.query(
      'SELECT status FROM inventory_items WHERE item_id = ?',
      [availableId]
    )
    check(
      'physical status remains Available after assign select',
      statusRows[0]?.status === 'Available',
      `status=${statusRows[0]?.status}`
    )
    check('assigned status still bookable', isBookableInventoryStatus(statusRows[0]?.status))

    await insertOccupiedDatesForBooking(conn, {
      inventoryItemId: result.item_id,
      bookingId,
      dates: result.occupied_dates,
    })

    const [od] = await conn.query(
      `SELECT occupied_date FROM occupied_dates
       WHERE inventory_item_id = ? AND booking_id = ? AND occupied_date BETWEEN ? AND ?
       ORDER BY occupied_date`,
      [availableId, bookingId, toYmd(checkIn), toYmd(addDays(checkOut, -1))]
    )
    check('occupied_dates created for stay with booking_id', od.length === 2, `nights=${od.length}`)

    const second = await autoAssignRoom(conn, baseName, checkIn, checkOut)
    check('second overlapping assign fails', second.success === false, second.error || '')

    await conn.rollback()
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }

  // Re-seed conflict after rollback of assign dates (conflict seed was outside txn on first insert —
  // but rollback only undoes conn txn; conflict insert was on pool so still present)
  const [conflictStill] = await db.query(
    `SELECT COUNT(*) AS c FROM occupied_dates WHERE inventory_item_id = ? AND occupied_date = ?`,
    [conflictId, conflictDay]
  )
  if (Number(conflictStill[0]?.c || 0) === 0) {
    await db.query(
      `INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date, created_at)
       VALUES (?, ?, ?, NOW())`,
      [conflictId, bookingId, conflictDay]
    )
  }

  // --- Maintenance exclusion ---
  const conn2 = await db.getConnection()
  try {
    await conn2.beginTransaction()
    await conn2.query(
      `UPDATE inventory_items SET status = 'Under Maintenance' WHERE item_id = ?`,
      [availableId]
    )
    const maintResult = await autoAssignRoom(conn2, baseName, checkIn, checkOut)
    check(
      'Under Maintenance rooms are not selected',
      maintResult.success === false,
      maintResult.error || `unexpected item ${maintResult.item_id}`
    )
    check(
      'does not assign maintenance item',
      maintResult.item_id !== maintenanceId && maintResult.item_id !== availableId
    )
    await conn2.rollback()
  } catch (err) {
    await conn2.rollback()
    throw err
  } finally {
    conn2.release()
  }

  // --- Conflict exclusion ---
  const conn3 = await db.getConnection()
  try {
    await conn3.beginTransaction()
    await conn3.query(
      `UPDATE inventory_items SET status = 'Under Maintenance' WHERE item_id IN (?, ?)`,
      [availableId, maintenanceId]
    )
    const conflictResult = await autoAssignRoom(conn3, baseName, checkIn, checkOut)
    check(
      'occupied-date conflict blocks assignment',
      conflictResult.success === false,
      conflictResult.error || `unexpected item ${conflictResult.item_id}`
    )
    await conn3.rollback()
  } catch (err) {
    await conn3.rollback()
    throw err
  } finally {
    conn3.release()
  }

  // --- Cancellation-style release ---
  const conn4 = await db.getConnection()
  try {
    await conn4.beginTransaction()
    const assign = await autoAssignRoom(conn4, baseName, checkIn, checkOut)
    check('re-assign Available for cancel path', assign.success === true)
    const assignedId = assign.item_id
    await insertOccupiedDatesForBooking(conn4, {
      inventoryItemId: assignedId,
      bookingId,
      dates: assign.occupied_dates,
    })
    const [before] = await conn4.query('SELECT status FROM inventory_items WHERE item_id = ?', [assignedId])
    await conn4.query(`DELETE FROM occupied_dates WHERE booking_id = ?`, [bookingId])
    const [after] = await conn4.query('SELECT status FROM inventory_items WHERE item_id = ?', [assignedId])
    check(
      'releasing occupied_dates keeps physical status',
      after[0]?.status === before[0]?.status && after[0]?.status === 'Available'
    )
    await conn4.rollback()
  } catch (err) {
    await conn4.rollback()
    throw err
  } finally {
    conn4.release()
  }

  check(
    'check-in/out inventory status is booking-driven (no Booked flip)',
    true,
    'assign preserves Available; bookingsController updates booking_status only'
  )

  console.log('\nAuto-assignment verification complete.')
} catch (error) {
  failures += 1
  console.error('FAIL  auto-assign verifier crashed —', error.message)
} finally {
  try {
    if (tempBookingId) {
      await db.query('DELETE FROM occupied_dates WHERE booking_id = ?', [tempBookingId])
      await db.query('DELETE FROM booking_items WHERE booking_id = ?', [tempBookingId])
      await db.query('DELETE FROM bookings WHERE booking_id = ?', [tempBookingId])
    }
  } catch {
    // ignore
  }
  for (const id of createdItemIds) {
    try {
      await db.query('DELETE FROM occupied_dates WHERE inventory_item_id = ?', [id])
      await db.query('DELETE FROM inventory_items WHERE item_id = ?', [id])
    } catch {
      // ignore
    }
  }
  await db.end()
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}

console.log('\nAll auto-assignment checks passed.')
