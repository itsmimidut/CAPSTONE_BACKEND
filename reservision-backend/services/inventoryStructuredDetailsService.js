/**
 * Phase 3 structured inventory details — load, serialize, and transactional persist.
 */

import sanitizeHtml from 'sanitize-html'
import {
  hasOwn,
  parseStructuredDetailsInput,
  validateStructuredDetails,
} from './inventoryStructuredDetailsValidator.js'

export const STRUCTURED_DETAILS_VERSION = 1

const DESCRIPTION_SANITIZE_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'ul', 'ol', 'li'],
  allowedAttributes: {},
  allowedSchemes: [],
  disallowedTagsMode: 'discard',
}

export function sanitizeInventoryDescription(htmlOrText) {
  if (htmlOrText == null) return ''
  const raw = String(htmlOrText)
  if (!raw.includes('<')) {
    return sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} }).trim()
  }
  return sanitizeHtml(raw, DESCRIPTION_SANITIZE_OPTIONS).trim()
}

export function emptyStructuredDetails(categoryType = 'room') {
  const type = String(categoryType || 'room').toLowerCase()
  if (type === 'event') {
    return {
      version: STRUCTURED_DETAILS_VERSION,
      amenities: [],
      accommodation: null,
      event: { venue: null, location: null },
    }
  }
  return {
    version: STRUCTURED_DETAILS_VERSION,
    amenities: [],
    accommodation: {
      check_in_time: null,
      check_out_time: null,
      location: null,
      max_extra_guests: null,
      beds: [],
      extra_guest_policies: [],
    },
    event: null,
  }
}

export function hasMeaningfulStructuredDetails(details) {
  if (!details || typeof details !== 'object') return false
  if (Array.isArray(details.amenities) && details.amenities.length > 0) return true
  const acc = details.accommodation
  if (acc && typeof acc === 'object') {
    if (acc.check_in_time || acc.check_out_time || acc.location) return true
    if (acc.max_extra_guests != null) return true
    if (Array.isArray(acc.beds) && acc.beds.length > 0) return true
    if (Array.isArray(acc.extra_guest_policies) && acc.extra_guest_policies.length > 0) return true
  }
  const event = details.event
  if (event && typeof event === 'object') {
    if (event.venue || event.location) return true
  }
  return false
}

const formatTime = (value) => {
  if (!value) return null
  const text = String(value)
  return text.length >= 5 ? text.slice(0, 5) : text
}

const buildEmptyGroup = (categoryType) => emptyStructuredDetails(categoryType)

/**
 * Batch-load structured details for many inventory item IDs (no N+1).
 * @param {import('mysql2/promise').Pool|import('mysql2/promise').PoolConnection} conn
 * @param {Array<{item_id:number, category_type:string, venue?:string, room_number?:string}>} items
 */
export async function loadStructuredDetailsByItems(conn, items = []) {
  const map = new Map()
  if (!items.length) return map

  items.forEach((item) => {
    const id = Number(item.item_id)
    const details = buildEmptyGroup(item.category_type)
    if (String(item.category_type).toLowerCase() === 'event') {
      const venue = item.venue || item.room_number || null
      details.event = { venue, location: venue }
    }
    map.set(id, details)
  })

  const ids = items.map((i) => Number(i.item_id)).filter(Number.isFinite)
  if (!ids.length) return map

  const placeholders = ids.map(() => '?').join(',')

  try {
    const [amenityRows] = await conn.query(
      `SELECT id, inventory_item_id, name, sort_order
       FROM inventory_item_amenities
       WHERE inventory_item_id IN (${placeholders})
       ORDER BY sort_order ASC, id ASC`,
      ids
    )
    amenityRows.forEach((row) => {
      const details = map.get(Number(row.inventory_item_id))
      if (!details) return
      details.amenities.push({
        id: row.id,
        name: row.name,
        sort_order: row.sort_order,
      })
    })

    const [accRows] = await conn.query(
      `SELECT inventory_item_id, check_in_time, check_out_time, location, max_extra_guests
       FROM accommodation_details
       WHERE inventory_item_id IN (${placeholders})`,
      ids
    )
    accRows.forEach((row) => {
      const details = map.get(Number(row.inventory_item_id))
      if (!details || details.accommodation == null) return
      details.accommodation.check_in_time = formatTime(row.check_in_time)
      details.accommodation.check_out_time = formatTime(row.check_out_time)
      details.accommodation.location = row.location
      details.accommodation.max_extra_guests = row.max_extra_guests
    })

    const [bedRows] = await conn.query(
      `SELECT id, inventory_item_id, bed_type, quantity, notes, sort_order
       FROM accommodation_beds
       WHERE inventory_item_id IN (${placeholders})
       ORDER BY sort_order ASC, id ASC`,
      ids
    )
    bedRows.forEach((row) => {
      const details = map.get(Number(row.inventory_item_id))
      if (!details?.accommodation) return
      details.accommodation.beds.push({
        id: row.id,
        bed_type: row.bed_type,
        quantity: row.quantity,
        notes: row.notes,
        sort_order: row.sort_order,
      })
    })

    const [policyRows] = await conn.query(
      `SELECT id, inventory_item_id, min_age, max_age, amount, label, sort_order
       FROM accommodation_extra_guest_policies
       WHERE inventory_item_id IN (${placeholders})
       ORDER BY sort_order ASC, id ASC`,
      ids
    )
    policyRows.forEach((row) => {
      const details = map.get(Number(row.inventory_item_id))
      if (!details?.accommodation) return
      details.accommodation.extra_guest_policies.push({
        id: row.id,
        min_age: row.min_age,
        max_age: row.max_age,
        amount: Number(row.amount),
        label: row.label,
        sort_order: row.sort_order,
      })
    })
  } catch (error) {
    // Tables may not exist yet on older DBs — return empty structured shells.
    if (error?.code === 'ER_NO_SUCH_TABLE') {
      console.warn('[structured-details] Tables missing; returning empty structured_details shells.')
      return map
    }
    throw error
  }

  return map
}

export async function attachStructuredDetails(conn, rows = []) {
  if (!rows.length) return rows
  const map = await loadStructuredDetailsByItems(conn, rows)
  return rows.map((row) => {
    const details = map.get(Number(row.item_id)) || emptyStructuredDetails(row.category_type)
    return {
      ...row,
      structured_details: details,
      has_structured_details: hasMeaningfulStructuredDetails(details),
    }
  })
}

async function replaceAmenities(conn, itemId, amenities) {
  await conn.query('DELETE FROM inventory_item_amenities WHERE inventory_item_id = ?', [itemId])
  for (const amenity of amenities) {
    await conn.query(
      `INSERT INTO inventory_item_amenities
        (inventory_item_id, name, normalized_name, sort_order, source)
       VALUES (?, ?, ?, ?, ?)`,
      [itemId, amenity.name, amenity.normalized_name, amenity.sort_order, amenity.source]
    )
  }
}

async function replaceBeds(conn, itemId, beds) {
  await conn.query('DELETE FROM accommodation_beds WHERE inventory_item_id = ?', [itemId])
  for (const bed of beds) {
    await conn.query(
      `INSERT INTO accommodation_beds
        (inventory_item_id, bed_type, quantity, notes, sort_order, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [itemId, bed.bed_type, bed.quantity, bed.notes, bed.sort_order, bed.source]
    )
  }
}

async function replacePolicies(conn, itemId, policies) {
  await conn.query('DELETE FROM accommodation_extra_guest_policies WHERE inventory_item_id = ?', [itemId])
  for (const policy of policies) {
    await conn.query(
      `INSERT INTO accommodation_extra_guest_policies
        (inventory_item_id, min_age, max_age, amount, label, sort_order, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        itemId,
        policy.min_age,
        policy.max_age,
        policy.amount,
        policy.label,
        policy.sort_order,
        policy.source,
      ]
    )
  }
}

async function upsertAccommodationHeader(conn, itemId, patch, existing) {
  const next = {
    check_in_time: existing?.check_in_time ?? null,
    check_out_time: existing?.check_out_time ?? null,
    location: existing?.location ?? null,
    max_extra_guests: existing?.max_extra_guests ?? null,
  }
  if (patch._partial.check_in_time) next.check_in_time = patch.check_in_time
  if (patch._partial.check_out_time) next.check_out_time = patch.check_out_time
  if (patch._partial.location) next.location = patch.location
  if (patch._partial.max_extra_guests) next.max_extra_guests = patch.max_extra_guests

  await conn.query(
    `INSERT INTO accommodation_details
      (inventory_item_id, check_in_time, check_out_time, location, max_extra_guests)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       check_in_time = VALUES(check_in_time),
       check_out_time = VALUES(check_out_time),
       location = VALUES(location),
       max_extra_guests = VALUES(max_extra_guests)`,
    [itemId, next.check_in_time, next.check_out_time, next.location, next.max_extra_guests]
  )
}

async function clearAccommodation(conn, itemId) {
  await conn.query('DELETE FROM accommodation_extra_guest_policies WHERE inventory_item_id = ?', [itemId])
  await conn.query('DELETE FROM accommodation_beds WHERE inventory_item_id = ?', [itemId])
  await conn.query('DELETE FROM accommodation_details WHERE inventory_item_id = ?', [itemId])
}

/**
 * Persist structured details inside an existing transaction connection.
 * Respects omitted vs empty semantics.
 *
 * @returns {{ venueSync: string|null|undefined }} venueSync when event venue should update parent row
 */
export async function persistStructuredDetails(conn, itemId, categoryType, structuredInput) {
  const parsed = parseStructuredDetailsInput(structuredInput)
  if (!parsed.present) {
    return { venueSync: undefined }
  }

  const validated = validateStructuredDetails(parsed.value, categoryType)
  if (!validated.ok) {
    const err = new Error(validated.message)
    err.status = validated.status
    err.errors = validated.errors
    throw err
  }

  const data = validated.value
  let venueSync

  if (data.amenities !== undefined) {
    await replaceAmenities(conn, itemId, data.amenities)
  }

  if (data.accommodation !== undefined) {
    if (data.accommodation === null) {
      await clearAccommodation(conn, itemId)
    } else {
      const [[existing]] = await conn.query(
        `SELECT check_in_time, check_out_time, location, max_extra_guests
         FROM accommodation_details WHERE inventory_item_id = ?`,
        [itemId]
      )
      const headerTouched =
        data.accommodation._partial.check_in_time
        || data.accommodation._partial.check_out_time
        || data.accommodation._partial.location
        || data.accommodation._partial.max_extra_guests
        || data.accommodation._partial.beds
        || data.accommodation._partial.extra_guest_policies

      if (headerTouched || existing) {
        await upsertAccommodationHeader(conn, itemId, data.accommodation, existing || {})
      }

      if (data.accommodation._partial.beds) {
        await replaceBeds(conn, itemId, data.accommodation.beds || [])
      }
      if (data.accommodation._partial.extra_guest_policies) {
        await replacePolicies(conn, itemId, data.accommodation.extra_guest_policies || [])
      }
    }
  }

  if (data.event !== undefined && data.event !== null) {
    if (data.event._partial.venue) venueSync = data.event.venue
    else if (data.event._partial.location) venueSync = data.event.location
  }

  return { venueSync }
}

export { parseStructuredDetailsInput, validateStructuredDetails, hasOwn }
