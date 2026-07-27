/**
 * Phase 4.1 / Phase 5 readiness audit (non-destructive).
 *
 * Reports conversion queue health + inventory status schema safety.
 * Does NOT convert, skip, delete, or mutate inventory rows.
 */
import db from '../config/db.js'
import { getLegacyConversionCounts } from '../services/inventoryLegacyConversionService.js'
import { normalizeInventoryStatus, isBookableInventoryStatus } from '../services/inventoryBookabilityService.js'

let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures += 1
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

try {
  console.log('\n=== Legacy conversion readiness ===\n')

  const [convTable] = await db.query("SHOW TABLES LIKE 'inventory_legacy_conversions'")
  check('inventory_legacy_conversions table exists', convTable.length > 0)

  const counts = await getLegacyConversionCounts()

  const [untrackedRows] = await db.query(`
    SELECT COUNT(*) AS total
    FROM inventory_items ii
    LEFT JOIN inventory_legacy_conversions ilc ON ilc.inventory_item_id = ii.item_id
    LEFT JOIN (
      SELECT inventory_item_id, COUNT(*) AS cnt FROM inventory_item_amenities GROUP BY inventory_item_id
    ) am ON am.inventory_item_id = ii.item_id
    LEFT JOIN (
      SELECT inventory_item_id, COUNT(*) AS cnt FROM accommodation_details GROUP BY inventory_item_id
    ) ad ON ad.inventory_item_id = ii.item_id
    LEFT JOIN (
      SELECT inventory_item_id, COUNT(*) AS cnt FROM accommodation_beds GROUP BY inventory_item_id
    ) ab ON ab.inventory_item_id = ii.item_id
    LEFT JOIN (
      SELECT inventory_item_id, COUNT(*) AS cnt FROM accommodation_extra_guest_policies GROUP BY inventory_item_id
    ) ap ON ap.inventory_item_id = ii.item_id
    WHERE ii.category_type IN ('room', 'cottage', 'event')
      AND ilc.id IS NULL
      AND TRIM(COALESCE(ii.description, '')) <> ''
      AND COALESCE(am.cnt, 0) = 0
      AND COALESCE(ad.cnt, 0) = 0
      AND COALESCE(ab.cnt, 0) = 0
      AND COALESCE(ap.cnt, 0) = 0
  `)
  const untrackedLegacy = Number(untrackedRows?.[0]?.total || 0)

  const [skippedWithoutReason] = await db.query(`
    SELECT COUNT(*) AS total
    FROM inventory_legacy_conversions
    WHERE conversion_status = 'skipped'
      AND (notes IS NULL OR TRIM(notes) = '')
  `)
  const skippedMissingReason = Number(skippedWithoutReason?.[0]?.total || 0)

  console.log(`Pending: ${counts.pending}`)
  console.log(`In review: ${counts.in_review}`)
  console.log(`Failed: ${counts.failed}`)
  console.log(`Converted: ${counts.converted}`)
  console.log(`Skipped: ${counts.skipped}`)
  console.log(`Reverted: ${counts.reverted}`)
  console.log(`Needs cleanup: ${counts.needs_cleanup}`)
  console.log(`Untracked legacy items: ${untrackedLegacy}`)

  const requiredReview =
    Number(counts.pending || 0)
    + Number(counts.in_review || 0)
    + Number(counts.failed || 0)

  check('no pending conversions', Number(counts.pending || 0) === 0)
  check('no in_review conversions', Number(counts.in_review || 0) === 0)
  check('no failed conversions', Number(counts.failed || 0) === 0)
  check('no untracked legacy items', untrackedLegacy === 0)
  check('no needs_cleanup mixed descriptions', Number(counts.needs_cleanup || 0) === 0)
  check(
    'skipped records documented when present',
    Number(counts.skipped || 0) === 0 || skippedMissingReason === 0,
    Number(counts.skipped || 0) > 0
      ? `${skippedMissingReason} skipped without notes`
      : 'none skipped'
  )

  console.log('\n=== Inventory status schema ===\n')

  const [statusCol] = await db.query("SHOW COLUMNS FROM inventory_items LIKE 'status'")
  const statusType = String(statusCol?.[0]?.Type || '')
  console.log(`Live status column: ${statusType || '(missing)'}`)
  check(
    'status ENUM matches expected values',
    statusType.includes('Available')
      && statusType.includes('Occupied')
      && statusType.includes('Under Maintenance')
      && !statusType.includes('Booked')
  )

  const [statusDist] = await db.query(
    'SELECT status, COUNT(*) AS total FROM inventory_items GROUP BY status ORDER BY total DESC'
  )
  for (const row of statusDist) {
    const label = row.status == null || row.status === '' ? '(empty/NULL)' : String(row.status)
    console.log(`  ${label}: ${row.total}`)
  }

  const [invalidRows] = await db.query(`
    SELECT COUNT(*) AS total
    FROM inventory_items
    WHERE status IS NULL
       OR TRIM(COALESCE(status, '')) = ''
       OR status NOT IN ('Available', 'Occupied', 'Under Maintenance')
  `)
  const invalidStatusCount = Number(invalidRows?.[0]?.total || 0)
  check('no invalid/empty inventory status rows', invalidStatusCount === 0, `count=${invalidStatusCount}`)

  const [sqlModeRows] = await db.query('SELECT @@SESSION.sql_mode AS sql_mode')
  const sqlMode = String(sqlModeRows?.[0]?.sql_mode || '')
  const strict = /STRICT_TRANS_TABLES|STRICT_ALL_TABLES/i.test(sqlMode)
  console.log(`Session sql_mode: ${sqlMode || '(empty)'}`)
  console.log(`Strict ENUM enforcement: ${strict ? 'ON' : 'OFF (invalid ENUM may coerce to empty)'}`)

  check('normalize Available', normalizeInventoryStatus('Available') === 'available')
  check('bookable only Available', isBookableInventoryStatus('Available') && !isBookableInventoryStatus('Occupied'))
  check('Booked is not bookable', !isBookableInventoryStatus('Booked'))
  check('empty status is not bookable', !isBookableInventoryStatus(''))

  // Confirm auto-assign source no longer writes Booked
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const here = path.dirname(fileURLToPath(import.meta.url))
  const assignSrc = await fs.readFile(path.join(here, '../services/roomAssignmentService.js'), 'utf8')
  check(
    'roomAssignmentService has no Booked status write',
    !assignSrc.includes("['Booked'")
      && !assignSrc.includes('["Booked"')
      && !assignSrc.includes("status = 'Booked'")
      && !assignSrc.includes('status = "Booked"')
  )
  check(
    'grouped rooms query no longer includes Booked',
    !assignSrc.includes("IN ('Available', 'Booked')")
  )
  check(
    'autoAssignRoom documents date-based occupancy',
    assignSrc.includes('occupied_dates') && assignSrc.includes('Keep physical status Available')
  )

  console.log('\n=== Phase 5 cleanup gate ===\n')
  const needsCleanup = Number(counts.needs_cleanup || 0)
  if (
    requiredReview === 0
    && untrackedLegacy === 0
    && needsCleanup === 0
    && invalidStatusCount === 0
    && failures === 0
  ) {
    console.log('PASS — Legacy cleanup complete')
  } else {
    console.log(
      needsCleanup > 0
        ? `BLOCKED — ${needsCleanup} converted records still contain mixed legacy descriptions`
        : `BLOCKED — ${requiredReview} record(s) still require conversion review`
          + (untrackedLegacy ? `; ${untrackedLegacy} untracked legacy item(s)` : '')
          + (invalidStatusCount ? `; ${invalidStatusCount} invalid status row(s)` : '')
    )
    failures += 1
  }
} catch (error) {
  failures += 1
  console.error('FAIL  readiness audit crashed —', error.message)
} finally {
  await db.end()
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}

console.log('\nAll Phase 5 readiness checks passed.')
