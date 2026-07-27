/**
 * Non-destructive Phase 4 legacy conversion verification.
 * Uses DB/service flow directly, creates ZZ LEGACY CONVERSION * rows, deletes in finally.
 */
import db from '../config/db.js'
import {
  applyLegacyConversion,
  getLegacyConversionCounts,
  getLegacyConversionDetail,
  reopenLegacyConversion,
  revertLegacyConversion,
  saveLegacyConversionDraft,
  skipLegacyConversion,
} from '../services/inventoryLegacyConversionService.js'
import { attachStructuredDetails } from '../services/inventoryStructuredDetailsService.js'

let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`PASS  ${label}`)
  else {
    failures += 1
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const normalizePolicies = (policies = []) => {
  const sorted = [...policies]
    .map((p) => ({ ...p, min_age: Number(p.min_age) || 0, max_age: p.max_age == null ? null : Number(p.max_age) }))
    .sort((a, b) => a.min_age - b.min_age)
  const kept = []
  for (const policy of sorted) {
    const overlaps = kept.some((row) => {
      const aMax = row.max_age == null ? Number.POSITIVE_INFINITY : row.max_age
      const bMax = policy.max_age == null ? Number.POSITIVE_INFINITY : policy.max_age
      return row.min_age <= bMax && policy.min_age <= aMax
    })
    if (!overlaps) kept.push(policy)
  }
  return kept
}

const createdIds = []

const createItem = async ({ name, category_type, description, room_number, venue = null }) => {
  const [res] = await db.query(
    `INSERT INTO inventory_items
      (category, category_type, room_number, name, description, max_guests, price, status, promo, images, primaryImageIndex, quantity, venue, rate_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Available', 0, '[]', 0, 1, ?, ?)`,
    [
      category_type === 'event' ? 'Event Area' : (category_type === 'cottage' ? 'Cottage' : 'Room'),
      category_type,
      room_number,
      name,
      description,
      4,
      4000,
      venue,
      category_type === 'event' ? 'per_event' : null,
    ]
  )
  createdIds.push(res.insertId)
  return res.insertId
}

const ROOM_LEGACY = `
FAMILY ROOM 3
Good for 4 pax
1 Queen-sized Bed and 1 Single Bed
with Pull Out Bed
Complimentary Breakfast
Pool and Waterpark Access
TV with Cable Channels
Mini-Fridge
CHECK IN TIME: 2:00PM
CHECK OUT TIME: 11:00AM
0-2 yrs old - Free
3-6 yrs old - PHP 500
7 yrs old above - PHP 1,000
All Family Rooms are located at second floor
`

const EVENT_LEGACY = `
MAIN FUNCTION HALL
Rate: PHP 12000 per event
Good for 100 pax
Air-conditioned venue
LED Wall
Located near the resort entrance
`

try {
  const roomId = await createItem({
    name: 'ZZ LEGACY CONVERSION ROOM',
    category_type: 'room',
    room_number: '901',
    description: ROOM_LEGACY,
  })
  const cottageId = await createItem({
    name: 'ZZ LEGACY CONVERSION COTTAGE',
    category_type: 'cottage',
    room_number: '902',
    description: ROOM_LEGACY.replace('FAMILY ROOM 3', 'COTTAGE 2'),
  })
  const eventId = await createItem({
    name: 'ZZ LEGACY CONVERSION EVENT',
    category_type: 'event',
    room_number: 'Grand Hall',
    venue: 'Grand Hall',
    description: EVENT_LEGACY,
  })

  const roomDetail = await getLegacyConversionDetail(roomId)
  check('preview returns proposal for room', Boolean(roomDetail?.proposal))
  check('preview does not auto-create structured rows', !roomDetail.item.has_structured_details)

  const draftResult = await saveLegacyConversionDraft({
    itemId: roomId,
    sourceSnapshotHash: roomDetail.source_snapshot_hash,
    reviewDraft: { note: 'reviewing', selected_fields: { amenities: true } },
    reviewerId: 1,
  })
  check('draft save succeeds', draftResult.success === true)

  const roomApplyPayload = {
    amenities: roomDetail.proposal.amenities.map((a, i) => ({ name: a.name, sort_order: i, source: 'migration' })),
    accommodation: {
      beds: roomDetail.proposal.accommodation.beds.map((b, i) => ({
        bed_type: b.bed_type || b.label,
        quantity: b.quantity || 1,
        notes: b.notes || null,
        sort_order: i,
        source: 'migration',
      })),
      check_in_time: roomDetail.proposal.accommodation.check_in_time,
      check_out_time: roomDetail.proposal.accommodation.check_out_time,
      location: roomDetail.proposal.accommodation.location,
      extra_guest_policies: normalizePolicies(roomDetail.proposal.accommodation.extra_guest_policies).map((p, i) => ({
        min_age: p.min_age,
        max_age: p.max_age,
        amount: p.amount,
        label: p.label,
        sort_order: i,
        source: 'migration',
      })),
    },
  }

  const applyRes = await applyLegacyConversion({
    itemId: roomId,
    sourceSnapshotHash: roomDetail.source_snapshot_hash,
    structuredDetails: roomApplyPayload,
    description: 'A comfortable family room suitable for up to four guests.',
    replaceDescription: true,
    selectedFields: { collection_actions: { amenities: 'replace', beds: 'replace', extra_guest_policies: 'replace' } },
    reviewerId: 1,
  })
  check('apply conversion succeeds', applyRes.success === true)
  check('apply marks structured', applyRes.item?.has_structured_details === true)

  const staleAttempt = await applyLegacyConversion({
    itemId: roomId,
    sourceSnapshotHash: roomDetail.source_snapshot_hash, // old hash
    structuredDetails: { amenities: [] },
    description: 'Stale attempt',
    replaceDescription: false,
    selectedFields: {},
    reviewerId: 1,
  })
  check('stale preview protected with conflict', staleAttempt.stale === true)

  await skipLegacyConversion({ itemId: cottageId, reason: 'Needs new material', reviewerId: 1 })
  const countsAfterSkip = await getLegacyConversionCounts()
  check('skip updates counts', Number(countsAfterSkip.skipped) >= 1)
  await reopenLegacyConversion({ itemId: cottageId })

  const eventDetail = await getLegacyConversionDetail(eventId)
  const eventApply = await applyLegacyConversion({
    itemId: eventId,
    sourceSnapshotHash: eventDetail.source_snapshot_hash,
    structuredDetails: {
      amenities: eventDetail.proposal.amenities.map((a, i) => ({ name: a.name, sort_order: i, source: 'migration' })),
      event: {
        venue: eventDetail.item.venue || eventDetail.item.room_number,
        location: eventDetail.proposal.event.location || null,
      },
    },
    description: 'A function venue suitable for celebrations and gatherings.',
    replaceDescription: true,
    selectedFields: { collection_actions: { amenities: 'replace' } },
    reviewerId: 1,
  })
  check('event conversion succeeds', eventApply.success === true)

  const revertOk = await revertLegacyConversion({ itemId: eventId, reviewerId: 1 })
  check('safe revert succeeds', revertOk.success === true, JSON.stringify(revertOk))

  // Revert conflict: reconvert then manually edit before revert
  const eventDetail2 = await getLegacyConversionDetail(eventId)
  await applyLegacyConversion({
    itemId: eventId,
    sourceSnapshotHash: eventDetail2.source_snapshot_hash,
    structuredDetails: {
      amenities: [{ name: 'Air-conditioned venue', sort_order: 0, source: 'migration' }],
      event: { venue: 'Grand Hall', location: 'Near entrance' },
    },
    description: 'Converted once more',
    replaceDescription: true,
    selectedFields: { collection_actions: { amenities: 'replace' } },
    reviewerId: 1,
  })
  await db.query(`UPDATE inventory_items SET name = CONCAT(name, ' EDITED') WHERE item_id = ?`, [eventId])
  const revertConflict = await revertLegacyConversion({ itemId: eventId, reviewerId: 1 })
  check('revert conflict protected', revertConflict.conflict === true && revertConflict.code === 'CONVERSION_REVERT_CONFLICT')

  const [rows] = await db.query(
    'SELECT * FROM inventory_items WHERE item_id IN (?, ?, ?)',
    [roomId, cottageId, eventId]
  )
  const withStructured = await attachStructuredDetails(db, rows)
  check('customer serializer has structured after conversion', withStructured.some((r) => r.item_id === roomId && r.has_structured_details))
} finally {
  for (const id of createdIds) {
    await db.query('DELETE FROM inventory_items WHERE item_id = ?', [id])
  }
  await db.end()
}

if (failures) {
  console.error(`\n${failures} legacy conversion check(s) failed.`)
  process.exit(1)
}
console.log('\nAll legacy conversion checks passed.')
