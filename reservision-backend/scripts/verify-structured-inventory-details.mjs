/**
 * Non-destructive Phase 3 structured inventory verification.
 * Creates ZZ STRUCTURED * temp items, exercises API round-trips, deletes in finally.
 *
 * Run with API server on :8000:
 *   node scripts/verify-structured-inventory-details.mjs
 */
import db from '../config/db.js'
import {
  validateStructuredDetails,
  normalizeAmenityName,
} from '../services/inventoryStructuredDetailsValidator.js'
import {
  persistStructuredDetails,
  attachStructuredDetails,
  hasMeaningfulStructuredDetails,
} from '../services/inventoryStructuredDetailsService.js'

const API = 'http://localhost:8000/api'
const PREFIX = 'ZZ STRUCTURED'

let failures = 0
const check = (label, condition, detail = '') => {
  if (condition) console.log(`PASS  ${label}`)
  else {
    failures += 1
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const createdIds = []

const getCsrf = async () => {
  const res = await fetch(`${API}/rooms`)
  const token = res.headers.get('x-csrf-token')
  if (!token) throw new Error('Could not obtain CSRF token — is the API running on :8000?')
  return token
}

const postRoom = async (csrf, fields, files = []) => {
  const form = new FormData()
  Object.entries(fields).forEach(([k, v]) => {
    if (v != null) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  })
  files.forEach((f) => form.append('images', f))
  const res = await fetch(`${API}/rooms`, {
    method: 'POST',
    headers: { 'x-csrf-token': csrf, Cookie: `csrf_token=${csrf}` },
    body: form,
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

const hasAuthError = (result) => result?.status === 401 || result?.body?.code === 'TOKEN_MISSING'

const putRoom = async (csrf, id, fields) => {
  const form = new FormData()
  Object.entries(fields).forEach(([k, v]) => {
    if (v != null) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v))
  })
  const res = await fetch(`${API}/rooms/${id}`, {
    method: 'PUT',
    headers: { 'x-csrf-token': csrf, Cookie: `csrf_token=${csrf}` },
    body: form,
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

const getRoom = async (id) => {
  const res = await fetch(`${API}/rooms/${id}`)
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

const roomPayload = (name, categoryType, structured) => ({
  category: categoryType === 'event' ? 'Event Area' : categoryType === 'cottage' ? 'Cottage' : 'Room',
  category_type: categoryType,
  room_number: categoryType === 'event' ? 'Test Hall' : '999',
  name,
  description: 'Short overview for structured verification.',
  max_guests: 4,
  capacity: 4,
  price: 4000,
  status: 'Available',
  promo: 0,
  primaryImageIndex: 0,
  existingImages: '[]',
  ...(categoryType === 'event' ? { venue: 'Test Hall', rate_type: 'per_event' } : {}),
  structured_details: structured,
})

const sampleRoomStructured = {
  amenities: [
    { name: 'Complimentary Breakfast', sort_order: 0, source: 'manual' },
    { name: 'Pool Access', sort_order: 1, source: 'manual' },
  ],
  accommodation: {
    check_in_time: '14:00',
    check_out_time: '11:00',
    location: 'Second floor',
    max_extra_guests: null,
    beds: [{ bed_type: 'Queen-sized Bed', quantity: 1, notes: null, sort_order: 0, source: 'manual' }],
    extra_guest_policies: [
      { min_age: 0, max_age: 2, amount: 0, label: '0-2 yrs', sort_order: 0, source: 'manual' },
      { min_age: 3, max_age: 6, amount: 500, label: '3-6 yrs', sort_order: 1, source: 'manual' },
    ],
  },
  event: null,
}

const sampleEventStructured = {
  amenities: [{ name: 'Air-conditioned venue', sort_order: 0, source: 'manual' }],
  accommodation: null,
  event: { venue: 'Main Hall', location: 'Near entrance' },
}

// --- Unit validation fixtures ---
const dup = validateStructuredDetails({
  amenities: [{ name: 'Wi-Fi' }, { name: 'wifi' }],
}, 'room')
check('validation rejects duplicate amenities', !dup.ok)

const overlap = validateStructuredDetails({
  accommodation: {
    extra_guest_policies: [
      { min_age: 0, max_age: 5, amount: 0 },
      { min_age: 3, max_age: 8, amount: 500 },
    ],
  },
}, 'room')
check('validation rejects overlapping age ranges', !overlap.ok)

const eventAcc = validateStructuredDetails({
  accommodation: { location: 'x' },
}, 'event')
check('validation rejects accommodation on event', !eventAcc.ok)

const roomEvent = validateStructuredDetails({
  event: { venue: 'Hall' },
}, 'room')
check('validation rejects event branch on room', !roomEvent.ok)

check('normalize amenity wifi', normalizeAmenityName('WIFI Internet Access') === 'wifi')

// --- Transaction rollback (service-level) ---
let rollbackItemId = null
try {
  const [ins] = await db.query(
    `INSERT INTO inventory_items
      (category, category_type, room_number, name, description, max_guests, price, status, promo, images, primaryImageIndex, quantity)
     VALUES ('Room','room','998','ZZ ROLLBACK ROOM','x',2,1000,'Available',0,'[]',0,1)`
  )
  rollbackItemId = ins.insertId
  const conn = await db.getConnection()
  await conn.beginTransaction()
  try {
    await persistStructuredDetails(conn, rollbackItemId, 'room', {
      amenities: [{ name: 'Test', sort_order: 0, source: 'manual' }],
      accommodation: {
        beds: [{ bed_type: 'King', quantity: 0, sort_order: 0, source: 'manual' }],
      },
    })
    await conn.commit()
    check('rollback test should not reach commit on invalid bed qty', false)
  } catch {
    await conn.rollback()
    const [rows] = await db.query(
      'SELECT COUNT(*) AS c FROM inventory_item_amenities WHERE inventory_item_id=?',
      [rollbackItemId]
    )
    check('transaction rollback preserves existing child rows', Number(rows[0].c) === 0)
  } finally {
    conn.release()
  }
} finally {
  if (rollbackItemId) await db.query('DELETE FROM inventory_items WHERE item_id=?', [rollbackItemId])
}

// --- API round trips (optional if server up) ---
let csrf
try {
  csrf = await getCsrf()
} catch (e) {
  console.warn('SKIP  API round-trip tests —', e.message)
  await db.end()
  if (failures) process.exit(1)
  console.log('\nUnit checks passed (API tests skipped).')
  process.exit(0)
}

try {
  // Room create
  const roomName = `${PREFIX} ROOM`
  const createRoom = await postRoom(csrf, roomPayload(roomName, 'room', sampleRoomStructured))
  if (hasAuthError(createRoom)) {
    console.warn('SKIP  API round-trip tests — admin authentication not available for script.')
    await db.end()
    if (failures) process.exit(1)
    console.log('\nUnit checks passed (API tests skipped due auth).')
    process.exit(0)
  }
  check('room create succeeds', createRoom.status === 200 && createRoom.body?.success, JSON.stringify(createRoom.body))
  const roomId = createRoom.body?.id
  if (roomId) createdIds.push(roomId)

  const fetched = await getRoom(roomId)
  const room = fetched.body?.data
  check('room fetch has structured_details', Boolean(room?.structured_details))
  check('room amenities persisted', room?.structured_details?.amenities?.length === 2)
  check('room bed persisted', room?.structured_details?.accommodation?.beds?.length === 1)
  check('room check-in persisted', room?.structured_details?.accommodation?.check_in_time === '14:00')
  check('room has_structured_details flag', room?.has_structured_details === true)

  // Omitted branch preserved on partial update
  const partial = await putRoom(csrf, roomId, {
    name: `${roomName} UPDATED`,
    category: 'Room',
    category_type: 'room',
    room_number: '999',
    description: room.description,
    max_guests: 4,
    price: 4200,
    status: 'Available',
    promo: 0,
    primaryImageIndex: 0,
    existingImages: JSON.stringify(room.images || []),
  })
  check('partial update without structured_details succeeds', partial.status === 200 && partial.body?.success)
  const afterPartial = (await getRoom(roomId)).body?.data
  check('amenities preserved when structured_details omitted', afterPartial?.structured_details?.amenities?.length === 2)

  // Empty amenities clears intentionally
  const clearAmenities = await putRoom(csrf, roomId, {
    name: afterPartial.name,
    category: 'Room',
    category_type: 'room',
    room_number: '999',
    description: afterPartial.description,
    max_guests: 4,
    price: 4200,
    status: 'Available',
    promo: 0,
    primaryImageIndex: 0,
    existingImages: JSON.stringify(afterPartial.images || []),
    structured_details: { amenities: [] },
  })
  check('clear amenities update succeeds', clearAmenities.status === 200)
  const afterClear = (await getRoom(roomId)).body?.data
  check('empty amenities array clears amenities', (afterClear?.structured_details?.amenities || []).length === 0)
  check('beds preserved when only amenities sent', (afterClear?.structured_details?.accommodation?.beds || []).length === 1)

  // Cottage
  const cottageName = `${PREFIX} COTTAGE`
  const cottageCreate = await postRoom(csrf, roomPayload(cottageName, 'cottage', sampleRoomStructured))
  const cottageId = cottageCreate.body?.id
  if (cottageId) createdIds.push(cottageId)
  check('cottage create succeeds', cottageCreate.status === 200)
  const cottageBad = await postRoom(csrf, roomPayload(`${PREFIX} COTTAGE BAD`, 'cottage', {
    event: { venue: 'nope' },
  }))
  check('cottage rejects event branch', cottageBad.status === 422 || cottageBad.status === 400)

  // Event
  const eventName = `${PREFIX} EVENT`
  const eventCreate = await postRoom(csrf, roomPayload(eventName, 'event', sampleEventStructured))
  const eventId = eventCreate.body?.id
  if (eventId) createdIds.push(eventId)
  check('event create succeeds', eventCreate.status === 200)
  const eventData = (await getRoom(eventId)).body?.data
  check('event amenities persisted', eventData?.structured_details?.amenities?.length === 1)
  check('event accommodation null', eventData?.structured_details?.accommodation == null)
  const eventBad = await postRoom(csrf, roomPayload(`${PREFIX} EVENT BAD`, 'event', {
    accommodation: { location: 'x' },
  }))
  check('event rejects accommodation branch', eventBad.status === 422 || eventBad.status === 400)

  // Legacy payload without structured_details on create still works
  const legacyName = `${PREFIX} LEGACY`
  const legacyCreate = await postRoom(csrf, {
    ...roomPayload(legacyName, 'room', undefined),
    structured_details: undefined,
    description: '<p>Legacy only</p>',
  })
  const legacyId = legacyCreate.body?.id
  if (legacyId) createdIds.push(legacyId)
  check('legacy create without structured_details succeeds', legacyCreate.status === 200)
  const legacyRow = (await getRoom(legacyId)).body?.data
  check('legacy item has no meaningful structured flag', legacyRow?.has_structured_details !== true)

  // attachStructuredDetails batch
  const [rows] = await db.query(
    'SELECT item_id, category_type, venue, room_number FROM inventory_items WHERE item_id IN (?)',
    [createdIds]
  )
  const attached = await attachStructuredDetails(db, rows)
  check('batch attach returns rows', attached.length === rows.length)
  const meaningful = attached.filter((r) => hasMeaningfulStructuredDetails(r.structured_details))
  check('batch attach marks meaningful structured rows', meaningful.length >= 3)
} finally {
  for (const id of createdIds) {
    await db.query('DELETE FROM inventory_items WHERE item_id=?', [id])
  }
}

await db.end()

if (failures) {
  console.error(`\n${failures} structured inventory verification check(s) failed.`)
  process.exit(1)
}
console.log('\nAll structured inventory verification checks passed.')
