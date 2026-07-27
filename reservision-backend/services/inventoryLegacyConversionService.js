import crypto from 'crypto'
import sanitizeHtml from 'sanitize-html'
import db from '../config/db.js'
import {
  attachStructuredDetails,
  hasMeaningfulStructuredDetails,
  persistStructuredDetails,
  sanitizeInventoryDescription,
} from './inventoryStructuredDetailsService.js'
import { detectLegacyMixedDescription } from './inventoryDescriptionGuard.js'

export const LEGACY_CONVERSION_PARSER_VERSION = 'phase4-v1'

const LIST_ALLOWED_STATUS = new Set(['pending', 'in_review', 'converted', 'skipped', 'failed', 'reverted'])
const LIST_ALLOWED_CATEGORY = new Set(['room', 'cottage', 'event'])

const stripHtmlToText = (value) => sanitizeHtml(String(value || ''), { allowedTags: [], allowedAttributes: {} })
  .replace(/\r\n/g, '\n')
  .replace(/\r/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .join('\n')

const safePreview = (value, max = 220) => stripHtmlToText(value).slice(0, max)

const stableStringify = (value) => {
  if (value == null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

const sha256 = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex')

const parseNumber = (line) => {
  const cleaned = String(line || '').replace(/[^\d.]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

const isAmenityHeading = (line) => /^(room inclusions?|complete amenities|amenities|inclusions)$/i.test(line)
const isIgnoredHeading = (line) => /^(for more information|please contact|extra person|extra guest)/i.test(line)
const looksLikeContact = (line) => /(?:\+63|09\d{2}|\(\d{3}\)\s*\d{3,4}[- ]?\d{3,4})/.test(line)
const looksLikeCheckIn = (line) => /(check[\s-]?in|check in time)/i.test(line)
const looksLikeCheckOut = (line) => /(check[\s-]?out|check out time)/i.test(line)
const looksLikePolicy = (line) => /\b(?:yrs?|years?|old)\b/i.test(line) && /(php|₱|free|\d{2,})/i.test(line)
const looksLikeBed = (line) => /\b(queen|king|single|double|bunk|sofa|pull[- ]?out|bed)s?\b/i.test(line)
const looksLikeCapacity = (line) => /(good for|capacity|maximum|up to|suitable for)\s*\d+/i.test(line)
const looksLikeLocation = (line) => /(floor|located|beside|near|adjacent|wing|hall)/i.test(line)
const looksLikePrice = (line) => /(php|₱|per (night|hour|day)|room rate|rate)/i.test(line) && /\d/.test(line)
const looksLikeRateType = (line) => /(per\s*hour|hourly)/i.test(line) ? 'per_hour'
  : (/(per\s*day|daily)/i.test(line) ? 'per_day' : (/(per\s*event|event rate)/i.test(line) ? 'per_event' : null))

const parseTime = (line) => {
  const m = line.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i)
  if (!m) return null
  let hour = Number(m[1] || 0)
  const minute = Number(m[2] || 0)
  const ampm = String(m[3] || '').toUpperCase()
  if (ampm === 'PM' && hour < 12) hour += 12
  if (ampm === 'AM' && hour === 12) hour = 0
  if (!ampm && (hour > 23 || minute > 59)) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

const parsePolicy = (line) => {
  const age = line.match(/(\d+)\s*[-–]\s*(\d+)|(\d+)\s*(?:\+|above|and above)/i)
  const amountM = line.match(/(?:php|₱)\s*([\d,]+(?:\.\d{1,2})?)|(\d+)\s*(?:pesos?)/i)
  const free = /\bfree\b/i.test(line)
  if (!age && !amountM && !free) return null
  let minAge = null
  let maxAge = null
  if (age) {
    if (age[1] != null) {
      minAge = Number(age[1])
      maxAge = Number(age[2])
    } else {
      minAge = Number(age[3])
      maxAge = null
    }
  }
  const amount = free ? 0 : Number(String(amountM?.[1] || amountM?.[2] || '').replace(/,/g, ''))
  return {
    min_age: Number.isFinite(minAge) ? minAge : 0,
    max_age: Number.isFinite(maxAge) ? maxAge : null,
    amount: Number.isFinite(amount) ? amount : 0,
    label: line.trim(),
    confidence: (age && (amountM || free)) ? 'high' : 'medium',
  }
}

const sanitizeOverview = (line) => {
  const txt = stripHtmlToText(line)
  if (!txt) return ''
  if (looksLikeContact(txt) || looksLikePrice(txt) || looksLikePolicy(txt) || looksLikeCheckIn(txt) || looksLikeCheckOut(txt)) return ''
  return txt
}

const parseLegacyDescriptionProposal = ({ categoryType, description, item }) => {
  const text = stripHtmlToText(description)
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)

  const proposed = {
    short_overview: '',
    amenities: [],
    accommodation: {
      beds: [],
      check_in_time: null,
      check_out_time: null,
      location: null,
      max_extra_guests: null,
      extra_guest_policies: [],
    },
    event: {
      venue: null,
      location: null,
      capacity: null,
      price: null,
      rate_type: null,
    },
    ignored_lines: [],
    unclassified_lines: [],
    confidence: {
      short_overview: 'low',
      amenities: 'low',
      beds: 'low',
      check_in_time: 'low',
      check_out_time: 'low',
      location: 'low',
      extra_guest_policies: 'low',
      event: 'low',
    },
  }

  const amenitySet = new Set()
  const addAmenity = (raw, confidence = 'medium') => {
    const name = raw.replace(/^[•*\-]\s*/, '').trim()
    if (!name) return
    const key = name.toLowerCase()
    if (amenitySet.has(key)) return
    amenitySet.add(key)
    proposed.amenities.push({ name, confidence })
  }

  let overviewCandidate = ''
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i]
    if (isAmenityHeading(line) || isIgnoredHeading(line)) {
      proposed.ignored_lines.push(line)
      continue
    }
    if (looksLikeContact(line)) {
      proposed.ignored_lines.push(line)
      continue
    }

    if ((/with pull out bed/i.test(lines[i + 1] || '')) && looksLikeBed(line)) {
      line = `${line} ${lines[i + 1]}`.replace(/\s+/g, ' ').trim()
      i += 1
    }

    if (looksLikeCheckIn(line)) {
      proposed.accommodation.check_in_time = parseTime(line)
      proposed.confidence.check_in_time = proposed.accommodation.check_in_time ? 'high' : 'low'
      continue
    }
    if (looksLikeCheckOut(line)) {
      proposed.accommodation.check_out_time = parseTime(line)
      proposed.confidence.check_out_time = proposed.accommodation.check_out_time ? 'high' : 'low'
      continue
    }
    if (looksLikePolicy(line)) {
      const policy = parsePolicy(line)
      if (policy) proposed.accommodation.extra_guest_policies.push(policy)
      else proposed.unclassified_lines.push(line)
      continue
    }
    if (looksLikeBed(line)) {
      proposed.accommodation.beds.push({
        label: line,
        bed_type: line,
        quantity: 1,
        notes: null,
        confidence: /(\d+|queen|king|single|double)/i.test(line) ? 'high' : 'medium',
      })
      continue
    }
    if (looksLikeLocation(line)) {
      if (!proposed.accommodation.location) {
        proposed.accommodation.location = line.replace(/^note:\s*/i, '')
      }
      if (!proposed.event.location) proposed.event.location = line.replace(/^note:\s*/i, '')
      continue
    }
    if (looksLikeCapacity(line)) {
      const m = line.match(/(\d+)/)
      const cap = m ? Number(m[1]) : null
      if (Number.isFinite(cap)) proposed.event.capacity = cap
      continue
    }
    if (looksLikePrice(line) && !/extra|entrance|person/i.test(line)) {
      const amount = parseNumber(line)
      if (Number.isFinite(amount) && amount > 0) proposed.event.price = amount
      const rt = looksLikeRateType(line)
      if (rt) proposed.event.rate_type = rt
      continue
    }

    const amenityLike = /^(?:[•*\-]\s*)?([A-Za-z].{2,80})$/.test(line)
    if (amenityLike && !/\b(room|cottage|event)\b/i.test(line) && !/^\d+$/.test(line)) {
      if (/(pool|wifi|wi-fi|fridge|shower|toiletries|towel|breakfast|tv|air|generator|access|bathroom|billiards|volleyball|basketball|parking)/i.test(line)) {
        addAmenity(line, 'high')
        continue
      }
    }

    if (!overviewCandidate) {
      const safe = sanitizeOverview(line)
      if (safe && safe.length > 20) overviewCandidate = safe
    }
    proposed.unclassified_lines.push(line)
  }

  if (!overviewCandidate) {
    if (categoryType === 'event') {
      const cap = proposed.event.capacity || item?.max_guests || item?.capacity
      overviewCandidate = cap
        ? `A function venue suitable for gatherings of up to ${cap} guests.`
        : `A function venue suitable for gatherings and celebrations.`
    } else {
      const cap = item?.max_guests || item?.capacity || proposed.event.capacity
      overviewCandidate = cap
        ? `A comfortable ${categoryType} suitable for up to ${cap} guests.`
        : `A comfortable ${categoryType} for resort guests.`
    }
  }

  proposed.short_overview = overviewCandidate
  proposed.confidence.short_overview = overviewCandidate ? 'medium' : 'low'
  proposed.confidence.amenities = proposed.amenities.length ? 'medium' : 'low'
  proposed.confidence.beds = proposed.accommodation.beds.length ? 'medium' : 'low'
  proposed.confidence.location = proposed.accommodation.location ? 'medium' : 'low'
  proposed.confidence.extra_guest_policies = proposed.accommodation.extra_guest_policies.length ? 'medium' : 'low'
  if (categoryType === 'event') {
    proposed.event.venue = item?.venue || item?.room_number || null
    proposed.confidence.event = (proposed.event.capacity || proposed.event.price || proposed.event.location) ? 'medium' : 'low'
  }

  return proposed
}

const toIsoDateTime = (value) => {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toISOString()
}

const buildSnapshot = (item) => ({
  item_id: item.item_id,
  category_type: item.category_type,
  name: item.name || '',
  description: item.description || '',
  max_guests: item.max_guests ?? null,
  capacity: item.capacity ?? item.max_guests ?? null,
  price: item.price ?? null,
  venue: item.venue || null,
  rate_type: item.rate_type || null,
  updated_at: toIsoDateTime(item.updated_at),
  structured_details: item.structured_details || null,
})

const collectionAction = (selectedFields, key, fallback = 'keep') => {
  const map = selectedFields?.collection_actions || {}
  const value = String(map?.[key] || fallback).toLowerCase()
  if (['keep', 'merge', 'replace', 'clear'].includes(value)) return value
  return fallback
}

const mergeByName = (current, proposed) => {
  const by = new Map()
  for (const row of current || []) {
    const name = String(row?.name || '').trim()
    if (!name) continue
    by.set(name.toLowerCase(), { ...row })
  }
  for (const row of proposed || []) {
    const name = String(row?.name || '').trim()
    if (!name) continue
    by.set(name.toLowerCase(), { ...row })
  }
  return [...by.values()].map((row, i) => ({ ...row, sort_order: i }))
}

const mergeByBed = (current, proposed) => {
  const arr = [...(current || [])]
  for (const row of proposed || []) {
    const key = `${String(row.bed_type || '').toLowerCase()}|${Number(row.quantity) || 1}|${String(row.notes || '').toLowerCase()}`
    const exists = arr.some((it) => `${String(it.bed_type || '').toLowerCase()}|${Number(it.quantity) || 1}|${String(it.notes || '').toLowerCase()}` === key)
    if (!exists) arr.push(row)
  }
  return arr.map((row, i) => ({ ...row, sort_order: i }))
}

const mergePolicies = (current, proposed) => {
  const arr = [...(current || [])]
  for (const row of proposed || []) {
    const key = `${row.min_age}-${row.max_age == null ? 'x' : row.max_age}-${row.amount}`
    const exists = arr.some((it) => `${it.min_age}-${it.max_age == null ? 'x' : it.max_age}-${it.amount}` === key)
    if (!exists) arr.push(row)
  }
  return arr.map((row, i) => ({ ...row, sort_order: i }))
}

const toSanitizedTracking = (row) => ({
  id: row.id,
  inventory_item_id: row.inventory_item_id,
  conversion_status: row.conversion_status,
  parser_version: row.parser_version,
  source_snapshot_hash: row.source_snapshot_hash,
  description_replaced: Boolean(row.description_replaced),
  reviewed_by: row.reviewed_by,
  reviewed_at: row.reviewed_at,
  converted_at: row.converted_at,
  skipped_at: row.skipped_at,
  reverted_at: row.reverted_at,
  notes: row.notes || '',
  last_error: row.last_error || null,
  created_at: row.created_at,
  updated_at: row.updated_at,
})

export const ensureLegacyConversionSchema = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_legacy_conversions (
        id INT NOT NULL AUTO_INCREMENT,
        inventory_item_id INT NOT NULL,
        conversion_status ENUM('pending','in_review','converted','skipped','failed','reverted') NOT NULL DEFAULT 'pending',
        parser_version VARCHAR(50) NULL,
        source_snapshot_hash CHAR(64) NULL,
        source_snapshot_json JSON NULL,
        original_description LONGTEXT NULL,
        original_structured_details JSON NULL,
        review_draft_json JSON NULL,
        applied_snapshot_json JSON NULL,
        description_replaced TINYINT(1) NOT NULL DEFAULT 0,
        reviewed_by INT NULL,
        reviewed_at DATETIME NULL,
        converted_at DATETIME NULL,
        skipped_at DATETIME NULL,
        reverted_at DATETIME NULL,
        notes TEXT NULL,
        last_error TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_inventory_legacy_conversion_item (inventory_item_id),
        KEY idx_legacy_conversion_status (conversion_status),
        KEY idx_legacy_conversion_status_item (conversion_status, inventory_item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)
  } catch (error) {
    console.warn('[DB] Could not ensure inventory_legacy_conversions table:', error.message)
  }
}

export async function getItemWithStructured(conn, itemId) {
  const [rows] = await conn.query('SELECT * FROM inventory_items WHERE item_id = ?', [itemId])
  if (!rows.length) return null
  const [full] = await attachStructuredDetails(conn, rows)
  return full
}

export async function ensureTrackingRow(conn, itemId, status = 'pending') {
  await conn.query(
    `INSERT INTO inventory_legacy_conversions (inventory_item_id, conversion_status)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE inventory_item_id = inventory_item_id`,
    [itemId, status]
  )
  const [rows] = await conn.query('SELECT * FROM inventory_legacy_conversions WHERE inventory_item_id = ?', [itemId])
  return rows[0] || null
}

export async function listLegacyConversions({
  status = 'pending',
  category = '',
  search = '',
  page = 1,
  limit = 20,
} = {}) {
  const currentPage = Math.max(1, Number(page) || 1)
  const perPage = Math.min(100, Math.max(1, Number(limit) || 20))
  const offset = (currentPage - 1) * perPage

  const where = ['1=1']
  const params = []

  if (status && status !== 'all') {
    const value = String(status).toLowerCase()
    if (LIST_ALLOWED_STATUS.has(value)) {
      where.push('COALESCE(ilc.conversion_status, ?) = ?')
      params.push('pending', value)
    }
  }

  if (category && category !== 'all') {
    const value = String(category).toLowerCase()
    if (LIST_ALLOWED_CATEGORY.has(value)) {
      where.push('ii.category_type = ?')
      params.push(value)
    }
  }

  if (search) {
    where.push('(ii.name LIKE ? OR ii.room_number LIKE ? OR ii.item_id = ?)')
    params.push(`%${search}%`, `%${search}%`, Number(search) || -1)
  }

  const sql = `
    SELECT
      ii.item_id,
      ii.name,
      ii.category_type,
      ii.description,
      ii.updated_at,
      ilc.conversion_status,
      ilc.reviewed_at,
      ilc.converted_at,
      ilc.updated_at AS tracking_updated_at,
      COALESCE(am.cnt,0) AS amenity_count,
      COALESCE(ad.cnt,0) AS accommodation_count,
      COALESCE(ab.cnt,0) AS bed_count,
      COALESCE(ap.cnt,0) AS policy_count
    FROM inventory_items ii
    LEFT JOIN inventory_legacy_conversions ilc ON ilc.inventory_item_id = ii.item_id
    LEFT JOIN (
      SELECT inventory_item_id, COUNT(*) AS cnt
      FROM inventory_item_amenities
      GROUP BY inventory_item_id
    ) am ON am.inventory_item_id = ii.item_id
    LEFT JOIN (
      SELECT inventory_item_id, COUNT(*) AS cnt
      FROM accommodation_details
      GROUP BY inventory_item_id
    ) ad ON ad.inventory_item_id = ii.item_id
    LEFT JOIN (
      SELECT inventory_item_id, COUNT(*) AS cnt
      FROM accommodation_beds
      GROUP BY inventory_item_id
    ) ab ON ab.inventory_item_id = ii.item_id
    LEFT JOIN (
      SELECT inventory_item_id, COUNT(*) AS cnt
      FROM accommodation_extra_guest_policies
      GROUP BY inventory_item_id
    ) ap ON ap.inventory_item_id = ii.item_id
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(ilc.updated_at, ii.updated_at, ii.created_at) DESC, ii.item_id DESC
    LIMIT ? OFFSET ?
  `

  const [rows] = await db.query(sql, [...params, perPage, offset])
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total
     FROM inventory_items ii
     LEFT JOIN inventory_legacy_conversions ilc ON ilc.inventory_item_id = ii.item_id
     WHERE ${where.join(' AND ')}`,
    params
  )

  const items = rows.map((row) => {
    const hasStructured = Number(row.amenity_count) > 0 || Number(row.accommodation_count) > 0 || Number(row.bed_count) > 0 || Number(row.policy_count) > 0
    const descText = stripHtmlToText(row.description || '')
    const hasLegacyContent = descText.length > 0
    const mixed = detectLegacyMixedDescription(row.description || '')
    let state = 'empty'
    if (!hasStructured && hasLegacyContent) state = 'legacy'
    else if (hasStructured && mixed.isMixed) state = 'needs_cleanup'
    else if (hasStructured) state = 'structured'

    return {
      item_id: row.item_id,
      name: row.name,
      category_type: row.category_type,
      conversion_status: row.conversion_status || 'pending',
      has_structured_details: hasStructured,
      has_legacy_content: hasLegacyContent,
      current_state: state,
      description_preview: safePreview(row.description),
      updated_at: row.updated_at,
      reviewed_at: row.reviewed_at,
      converted_at: row.converted_at,
    }
  }).filter((item) => item.current_state !== 'empty')

  return {
    page: currentPage,
    limit: perPage,
    total: Number(countRows?.[0]?.total || 0),
    items,
  }
}

export async function getLegacyConversionCounts() {
  const [rows] = await db.query(`
    SELECT
      ii.item_id,
      ii.description,
      COALESCE(ilc.conversion_status, 'pending') AS conversion_status,
      COALESCE(am.cnt,0) AS amenity_count,
      COALESCE(ad.cnt,0) AS accommodation_count,
      COALESCE(ab.cnt,0) AS bed_count,
      COALESCE(ap.cnt,0) AS policy_count
    FROM inventory_items ii
    LEFT JOIN inventory_legacy_conversions ilc ON ilc.inventory_item_id = ii.item_id
    LEFT JOIN (SELECT inventory_item_id, COUNT(*) AS cnt FROM inventory_item_amenities GROUP BY inventory_item_id) am ON am.inventory_item_id = ii.item_id
    LEFT JOIN (SELECT inventory_item_id, COUNT(*) AS cnt FROM accommodation_details GROUP BY inventory_item_id) ad ON ad.inventory_item_id = ii.item_id
    LEFT JOIN (SELECT inventory_item_id, COUNT(*) AS cnt FROM accommodation_beds GROUP BY inventory_item_id) ab ON ab.inventory_item_id = ii.item_id
    LEFT JOIN (SELECT inventory_item_id, COUNT(*) AS cnt FROM accommodation_extra_guest_policies GROUP BY inventory_item_id) ap ON ap.inventory_item_id = ii.item_id
  `)

  const counts = {
    pending: 0,
    in_review: 0,
    converted: 0,
    skipped: 0,
    failed: 0,
    reverted: 0,
    needs_cleanup: 0,
  }

  rows.forEach((row) => {
    const hasStructured = Number(row.amenity_count) > 0 || Number(row.accommodation_count) > 0 || Number(row.bed_count) > 0 || Number(row.policy_count) > 0
    const hasLegacy = stripHtmlToText(row.description || '').length > 0
    const mixed = detectLegacyMixedDescription(row.description || '')
    // Phase 5: needs_cleanup means structured + mixed legacy sections still in description.
    // A short clean overview with structured details is considered complete.
    if (hasStructured && mixed.isMixed) counts.needs_cleanup += 1
    if (hasLegacy || hasStructured) {
      const status = LIST_ALLOWED_STATUS.has(String(row.conversion_status)) ? row.conversion_status : 'pending'
      counts[status] += 1
    }
  })

  return counts
}

export async function getLegacyConversionDetail(itemId) {
  const conn = await db.getConnection()
  try {
    const item = await getItemWithStructured(conn, Number(itemId))
    if (!item) return null
    const snapshot = buildSnapshot(item)
    const sourceSnapshotHash = sha256(stableStringify(snapshot))

    const tracking = await ensureTrackingRow(conn, Number(itemId), 'pending')
    const proposal = parseLegacyDescriptionProposal({
      categoryType: String(item.category_type || 'room').toLowerCase(),
      description: item.description || '',
      item,
    })

    return {
      item,
      source_snapshot_hash: sourceSnapshotHash,
      source_snapshot_json: snapshot,
      plain_text: stripHtmlToText(item.description || ''),
      conversion: tracking ? {
        ...toSanitizedTracking(tracking),
        review_draft_json: tracking.review_draft_json || null,
      } : null,
      proposal,
    }
  } finally {
    conn.release()
  }
}

export async function saveLegacyConversionDraft({
  itemId,
  sourceSnapshotHash,
  reviewDraft,
  parserVersion = LEGACY_CONVERSION_PARSER_VERSION,
  reviewerId = null,
}) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const item = await getItemWithStructured(conn, Number(itemId))
    if (!item) {
      await conn.rollback()
      return { notFound: true }
    }
    const snapshot = buildSnapshot(item)
    const hash = sha256(stableStringify(snapshot))
    if (sourceSnapshotHash && String(sourceSnapshotHash) !== hash) {
      await conn.rollback()
      return { stale: true }
    }

    await ensureTrackingRow(conn, Number(itemId), 'in_review')
    await conn.query(
      `UPDATE inventory_legacy_conversions
       SET conversion_status='in_review',
           parser_version=?,
           source_snapshot_hash=?,
           source_snapshot_json=?,
           review_draft_json=?,
           reviewed_by=?,
           reviewed_at=NOW(),
           notes=?
       WHERE inventory_item_id=?`,
      [
        parserVersion,
        hash,
        JSON.stringify(snapshot),
        JSON.stringify(reviewDraft || {}),
        reviewerId || null,
        String(reviewDraft?.notes || '').slice(0, 2000) || null,
        Number(itemId),
      ]
    )
    await conn.commit()
    return { success: true, source_snapshot_hash: hash }
  } catch (error) {
    try { await conn.rollback() } catch {}
    throw error
  } finally {
    conn.release()
  }
}

export async function applyLegacyConversion({
  itemId,
  sourceSnapshotHash,
  structuredDetails,
  description,
  replaceDescription,
  selectedFields = {},
  notes = '',
  reviewerId = null,
}) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [lockRows] = await conn.query('SELECT item_id FROM inventory_items WHERE item_id = ? FOR UPDATE', [Number(itemId)])
    if (!lockRows.length) {
      await conn.rollback()
      return { notFound: true }
    }

    const item = await getItemWithStructured(conn, Number(itemId))
    const sourceSnapshot = buildSnapshot(item)
    const actualHash = sha256(stableStringify(sourceSnapshot))
    if (String(sourceSnapshotHash || '') !== actualHash) {
      await conn.rollback()
      return { stale: true, actualHash }
    }

    const tracking = await ensureTrackingRow(conn, Number(itemId), 'in_review')
    const originalDescription = tracking?.original_description ?? item.description ?? ''
    const originalStructured = tracking?.original_structured_details
      ? (typeof tracking.original_structured_details === 'string'
        ? JSON.parse(tracking.original_structured_details)
        : tracking.original_structured_details)
      : (item.structured_details || null)

    const currentStructured = item.structured_details || {}
    const payload = structuredDetails && typeof structuredDetails === 'object'
      ? JSON.parse(JSON.stringify(structuredDetails))
      : {}

    const amenityAction = collectionAction(selectedFields, 'amenities', 'keep')
    const bedAction = collectionAction(selectedFields, 'beds', 'keep')
    const policyAction = collectionAction(selectedFields, 'extra_guest_policies', 'keep')

    if (amenityAction === 'keep') delete payload.amenities
    else if (amenityAction === 'clear') payload.amenities = []
    else if (amenityAction === 'merge') payload.amenities = mergeByName(currentStructured.amenities || [], payload.amenities || [])

    if (!payload.accommodation && item.category_type !== 'event') payload.accommodation = {}
    if (item.category_type !== 'event') {
      if (bedAction === 'keep') delete payload.accommodation?.beds
      else if (bedAction === 'clear') payload.accommodation.beds = []
      else if (bedAction === 'merge') payload.accommodation.beds = mergeByBed(currentStructured?.accommodation?.beds || [], payload.accommodation?.beds || [])

      if (policyAction === 'keep') delete payload.accommodation?.extra_guest_policies
      else if (policyAction === 'clear') payload.accommodation.extra_guest_policies = []
      else if (policyAction === 'merge') payload.accommodation.extra_guest_policies = mergePolicies(
        currentStructured?.accommodation?.extra_guest_policies || [],
        payload.accommodation?.extra_guest_policies || []
      )
    }

    const shouldPersistStructured = Object.keys(payload || {}).length > 0
    if (shouldPersistStructured) {
      await persistStructuredDetails(conn, Number(itemId), item.category_type, payload)
    }

    let descriptionReplaced = 0
    if (replaceDescription) {
      const cleaned = sanitizeInventoryDescription(description || '')
      const mixed = detectLegacyMixedDescription(cleaned)
      if (mixed.isMixed) {
        await conn.rollback()
        return {
          rejected: true,
          code: 'MIXED_LEGACY_DESCRIPTION',
          message: 'Converted overview still contains mixed legacy sections. Provide a short overview only.',
        }
      }
      await conn.query('UPDATE inventory_items SET description=? WHERE item_id=?', [cleaned, Number(itemId)])
      descriptionReplaced = 1
    }

    const updatedItem = await getItemWithStructured(conn, Number(itemId))
    const appliedSnapshot = buildSnapshot(updatedItem)
    const meaningfulStructured = hasMeaningfulStructuredDetails(updatedItem.structured_details)
    const changedDescription = replaceDescription && String(updatedItem.description || '').trim().length > 0
    if (!meaningfulStructured && !changedDescription) {
      await conn.rollback()
      return { rejected: true, message: 'No meaningful conversion changes were applied.' }
    }

    await conn.query(
      `UPDATE inventory_legacy_conversions
       SET conversion_status='converted',
           parser_version=?,
           source_snapshot_hash=?,
           source_snapshot_json=?,
           original_description=?,
           original_structured_details=?,
           review_draft_json=?,
           applied_snapshot_json=?,
           description_replaced=?,
           reviewed_by=?,
           reviewed_at=NOW(),
           converted_at=NOW(),
           notes=?,
           last_error=NULL
       WHERE inventory_item_id=?`,
      [
        LEGACY_CONVERSION_PARSER_VERSION,
        actualHash,
        JSON.stringify(sourceSnapshot),
        originalDescription,
        JSON.stringify(originalStructured),
        JSON.stringify({ selected_fields: selectedFields, input: payload }),
        JSON.stringify(appliedSnapshot),
        descriptionReplaced,
        reviewerId || null,
        String(notes || '').slice(0, 2000) || null,
        Number(itemId),
      ]
    )

    await conn.commit()
    return { success: true, item: updatedItem }
  } catch (error) {
    try {
      await conn.query(
        `UPDATE inventory_legacy_conversions
         SET conversion_status='failed', last_error=?
         WHERE inventory_item_id=?`,
        [String(error?.message || 'Unknown conversion error').slice(0, 4000), Number(itemId)]
      )
      await conn.commit()
    } catch {}
    throw error
  } finally {
    conn.release()
  }
}

export async function skipLegacyConversion({ itemId, reason = '', reviewerId = null }) {
  await ensureLegacyConversionSchema()
  await db.query(
    `INSERT INTO inventory_legacy_conversions (inventory_item_id, conversion_status, notes, reviewed_by, skipped_at)
     VALUES (?, 'skipped', ?, ?, NOW())
     ON DUPLICATE KEY UPDATE conversion_status='skipped', notes=VALUES(notes), reviewed_by=VALUES(reviewed_by), skipped_at=NOW(), updated_at=NOW()`,
    [Number(itemId), String(reason || '').slice(0, 2000) || null, reviewerId || null]
  )
  return { success: true }
}

export async function reopenLegacyConversion({ itemId }) {
  await db.query(
    `UPDATE inventory_legacy_conversions
     SET conversion_status='pending', skipped_at=NULL, last_error=NULL, updated_at=NOW()
     WHERE inventory_item_id=?`,
    [Number(itemId)]
  )
  return { success: true }
}

export async function revertLegacyConversion({ itemId, reviewerId = null }) {
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.query('SELECT * FROM inventory_legacy_conversions WHERE inventory_item_id=? FOR UPDATE', [Number(itemId)])
    if (!rows.length) {
      await conn.rollback()
      return { notFound: true }
    }
    const tracking = rows[0]
    if (tracking.conversion_status !== 'converted') {
      await conn.rollback()
      return { conflict: true, code: 'CONVERSION_REVERT_CONFLICT', message: 'Only converted records can be reverted.' }
    }

    const item = await getItemWithStructured(conn, Number(itemId))
    const currentSnapshot = buildSnapshot(item)
    const currentHash = sha256(stableStringify(currentSnapshot))
    const appliedSnapshot = tracking.applied_snapshot_json
      ? (typeof tracking.applied_snapshot_json === 'string'
        ? JSON.parse(tracking.applied_snapshot_json)
        : tracking.applied_snapshot_json)
      : null
    const appliedHash = appliedSnapshot ? sha256(stableStringify(appliedSnapshot)) : null
    if (!appliedHash || appliedHash !== currentHash) {
      await conn.rollback()
      return {
        conflict: true,
        code: 'CONVERSION_REVERT_CONFLICT',
        message: 'This item was edited after conversion and cannot be reverted automatically.',
      }
    }

    const restoreDescription = tracking.original_description ?? item.description ?? ''
    const restoreStructured = tracking.original_structured_details
      ? (typeof tracking.original_structured_details === 'string'
        ? JSON.parse(tracking.original_structured_details)
        : tracking.original_structured_details)
      : null

    await conn.query('UPDATE inventory_items SET description=? WHERE item_id=?', [restoreDescription, Number(itemId)])
    await persistStructuredDetails(conn, Number(itemId), item.category_type, restoreStructured || {})

    await conn.query(
      `UPDATE inventory_legacy_conversions
       SET conversion_status='reverted',
           reverted_at=NOW(),
           reviewed_by=?,
           reviewed_at=NOW(),
           updated_at=NOW()
       WHERE inventory_item_id=?`,
      [reviewerId || null, Number(itemId)]
    )

    await conn.commit()
    return { success: true }
  } catch (error) {
    try { await conn.rollback() } catch {}
    throw error
  } finally {
    conn.release()
  }
}
