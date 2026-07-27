/**
 * Non-destructive runtime verification of the POST /api/bookings inventory
 * status guard.
 *
 * Strategy: create ONE temporary inventory row (clearly named test room),
 * fire real API requests against it, assert that no booking rows are created,
 * then delete the temporary row. No production/real room data is modified.
 *
 * The Available positive path is verified via a local BEGIN/ROLLBACK around
 * assertInventoryItemsBookable — never by completing an API booking insert.
 *
 * Run from reservision-backend/ with the API server running on :8000:
 *   node scripts/verify-booking-guard.mjs
 */
import db from '../config/db.js'
import {
  assertInventoryItemsBookable,
  isBookableInventoryStatus,
  normalizeInventoryStatus,
  UNAVAILABLE_BOOKING_MESSAGE,
} from '../services/inventoryBookabilityService.js'

const API = 'http://localhost:8000/api'
const TEST_ROOM_NAME = 'ZZ GUARD VERIFICATION ROOM (TEMP)'

let failures = 0
const check = (label, condition, detail = '') => {
  if (condition) console.log(`PASS  ${label}`)
  else { failures += 1; console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`) }
}

const getCounts = async () => {
  const [[b]] = await db.query('SELECT COUNT(*) AS c FROM bookings')
  const [[bi]] = await db.query('SELECT COUNT(*) AS c FROM booking_items')
  const [[bl]] = await db.query('SELECT COUNT(*) AS c FROM booking_logs')
  const [[od]] = await db.query('SELECT COUNT(*) AS c FROM occupied_dates')
  return { bookings: b.c, items: bi.c, logs: bl.c, occupied: od.c }
}

const getCsrf = async () => {
  const res = await fetch(`${API}/rooms`)
  const token = res.headers.get('x-csrf-token')
  if (!token) throw new Error('Could not obtain CSRF token from API')
  return token
}

const postBooking = async (csrf, itemId) => {
  const res = await fetch(`${API}/bookings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrf,
      'Cookie': `csrf_token=${csrf}`,
    },
    body: JSON.stringify({
      customer: { firstName: 'Guard', lastName: 'Verification' },
      contact: {
        email: 'guard-verification@example.com',
        phone: '09000000000',
        address: 'Test', city: 'Test', country: 'Philippines', postal: '0000',
      },
      checkIn: '2030-01-10',
      checkOut: '2030-01-12',
      nights: 2,
      adults: 2,
      children: 0,
      items: [{
        item: { item_id: itemId, name: TEST_ROOM_NAME, price: 1000, perNight: true, category: 'Room' },
        qty: 1,
      }],
      subtotal: 2000,
      total: 2000,
    }),
  })
  let body = null
  try { body = await res.json() } catch { body = null }
  return { status: res.status, body }
}

let tempItemId = null
try {
  check('normalize Available', normalizeInventoryStatus('Available') === 'available')
  check('normalize AVAILABLE', normalizeInventoryStatus('AVAILABLE') === 'available')
  check('normalize trailing whitespace', normalizeInventoryStatus('Available ') === 'available')
  check('normalize null → empty', normalizeInventoryStatus(null) === '')
  check('isBookable Available', isBookableInventoryStatus('Available') === true)
  check('isBookable Under Maintenance', isBookableInventoryStatus('Under Maintenance') === false)
  check('isBookable Occupied', isBookableInventoryStatus('Occupied') === false)
  check('isBookable empty', isBookableInventoryStatus('') === false)

  const csrf = await getCsrf()

  const [ins] = await db.query(
    `INSERT INTO inventory_items
       (category, category_type, room_number, name, quantity, description, max_guests, price, status, promo, images, primaryImageIndex)
     VALUES ('Test', 'room', 'ZZ99', ?, 1, 'temporary guard verification row', 2, 1000, 'Under Maintenance', 0, '[]', 0)`,
    [TEST_ROOM_NAME]
  )
  tempItemId = ins.insertId
  console.log(`\nCreated temporary inventory item #${tempItemId} (will be deleted).\n`)

  let before = await getCounts()
  let r = await postBooking(csrf, tempItemId)
  let after = await getCounts()
  check('Under Maintenance → HTTP 409', r.status === 409, `got ${r.status} ${JSON.stringify(r.body)}`)
  check('Under Maintenance → customer-safe message',
    r.body?.message === UNAVAILABLE_BOOKING_MESSAGE, JSON.stringify(r.body))
  check('Under Maintenance → no booking/item/log/occupied rows created',
    JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`)

  await db.query('UPDATE inventory_items SET status = ? WHERE item_id = ?', ['Occupied', tempItemId])
  before = await getCounts()
  r = await postBooking(csrf, tempItemId)
  after = await getCounts()
  check('Occupied → HTTP 409', r.status === 409, `got ${r.status} ${JSON.stringify(r.body)}`)
  check('Occupied → no rows created', JSON.stringify(before) === JSON.stringify(after))

  await db.query('UPDATE inventory_items SET status = NULL WHERE item_id = ?', [tempItemId])
  before = await getCounts()
  r = await postBooking(csrf, tempItemId)
  after = await getCounts()
  check('NULL status → HTTP 409', r.status === 409, `got ${r.status} ${JSON.stringify(r.body)}`)
  check('NULL status → no rows created', JSON.stringify(before) === JSON.stringify(after))

  // Available positive path: local transaction always rolled back (no permanent booking).
  await db.query('UPDATE inventory_items SET status = ? WHERE item_id = ?', ['Available', tempItemId])
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    const bookability = await assertInventoryItemsBookable(connection, [tempItemId])
    check('Available → assertInventoryItemsBookable ok', bookability.ok === true, JSON.stringify(bookability))
    await connection.rollback()
  } finally {
    connection.release()
  }

  before = await getCounts()
  r = await postBooking(csrf, 99999999)
  after = await getCounts()
  check('Nonexistent item id → HTTP 409', r.status === 409, `got ${r.status} ${JSON.stringify(r.body)}`)
  check('Nonexistent item id → no rows created', JSON.stringify(before) === JSON.stringify(after))

  await db.query('UPDATE inventory_items SET status = ? WHERE item_id = ?', ['Under Maintenance', tempItemId])
  before = await getCounts()
  const confirmRes = await fetch(`${API}/bookings/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrf,
      'Cookie': `csrf_token=${csrf}`,
    },
    body: JSON.stringify({
      guest: {
        firstName: 'Guard', lastName: 'Confirm',
        email: 'guard-confirm@example.com', phone: '09000000000',
        address: 'Test', city: 'Test', country: 'Philippines', postal: '0000',
        adults: 2, children: 0,
      },
      checkIn: '2030-02-10',
      checkOut: '2030-02-12',
      items: [{
        item_id: tempItemId,
        name: TEST_ROOM_NAME,
        price: 1000,
        qty: 1,
        booking_type: 'room',
        check_in: '2030-02-10',
        check_out: '2030-02-12',
      }],
      paymentMethod: 'cash',
      total: 2000,
    }),
  })
  let confirmBody = null
  try { confirmBody = await confirmRes.json() } catch { confirmBody = null }
  after = await getCounts()
  check('POST /bookings/confirm Under Maintenance → HTTP 409',
    confirmRes.status === 409, `got ${confirmRes.status} ${JSON.stringify(confirmBody)}`)
  check('POST /bookings/confirm → customer-safe message',
    confirmBody?.message === UNAVAILABLE_BOOKING_MESSAGE, JSON.stringify(confirmBody))
  check('POST /bookings/confirm → no rows created',
    JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} vs ${JSON.stringify(after)}`)
} catch (error) {
  failures += 1
  console.error('FATAL:', error.message)
} finally {
  if (tempItemId) {
    const [leftovers] = await db.query(
      'SELECT booking_id FROM booking_items WHERE inventory_item_id = ?',
      [tempItemId]
    )
    for (const row of leftovers) {
      await db.query('DELETE FROM occupied_dates WHERE booking_id = ?', [row.booking_id])
      await db.query('DELETE FROM booking_items WHERE booking_id = ?', [row.booking_id])
      await db.query('DELETE FROM booking_logs WHERE booking_id = ?', [row.booking_id])
      await db.query('DELETE FROM bookings WHERE booking_id = ?', [row.booking_id])
    }
    await db.query('DELETE FROM occupied_dates WHERE inventory_item_id = ?', [tempItemId])
    await db.query('DELETE FROM inventory_items WHERE item_id = ?', [tempItemId])
    console.log(`\nCleaned up temporary inventory item #${tempItemId}.`)
  }
  await db.end()
}

console.log(failures === 0
  ? '\nAll booking-guard runtime checks passed.'
  : `\n${failures} check(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
