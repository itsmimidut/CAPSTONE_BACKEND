/**
 * Phase 5 finalization verifier (non-destructive).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import db from '../config/db.js'
import { getLegacyConversionCounts } from '../services/inventoryLegacyConversionService.js'
import { detectLegacyMixedDescription } from '../services/inventoryDescriptionGuard.js'
import { isBookableInventoryStatus } from '../services/inventoryBookabilityService.js'

let failures = 0
const check = (label, ok, detail = '') => {
  if (ok) console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`)
  else {
    failures += 1
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(here, '../../../CAPSTONE_FRONTEND/reservision')

try {
  console.log('\n=== Conversion readiness ===\n')
  const counts = await getLegacyConversionCounts()
  console.log(`Pending: ${counts.pending}`)
  console.log(`In review: ${counts.in_review}`)
  console.log(`Failed: ${counts.failed}`)
  console.log(`Converted: ${counts.converted}`)
  console.log(`Needs cleanup: ${counts.needs_cleanup}`)

  const [untrackedRows] = await db.query(`
    SELECT COUNT(*) AS total
    FROM inventory_items ii
    LEFT JOIN inventory_legacy_conversions ilc ON ilc.inventory_item_id = ii.item_id
    LEFT JOIN (SELECT inventory_item_id, COUNT(*) AS cnt FROM inventory_item_amenities GROUP BY inventory_item_id) am
      ON am.inventory_item_id = ii.item_id
    LEFT JOIN (SELECT inventory_item_id, COUNT(*) AS cnt FROM accommodation_details GROUP BY inventory_item_id) ad
      ON ad.inventory_item_id = ii.item_id
    LEFT JOIN (SELECT inventory_item_id, COUNT(*) AS cnt FROM accommodation_beds GROUP BY inventory_item_id) ab
      ON ab.inventory_item_id = ii.item_id
    LEFT JOIN (SELECT inventory_item_id, COUNT(*) AS cnt FROM accommodation_extra_guest_policies GROUP BY inventory_item_id) ap
      ON ap.inventory_item_id = ii.item_id
    WHERE ii.category_type IN ('room', 'cottage', 'event')
      AND ilc.id IS NULL
      AND TRIM(COALESCE(ii.description, '')) <> ''
      AND COALESCE(am.cnt, 0) = 0
      AND COALESCE(ad.cnt, 0) = 0
      AND COALESCE(ab.cnt, 0) = 0
      AND COALESCE(ap.cnt, 0) = 0
  `)
  const untracked = Number(untrackedRows?.[0]?.total || 0)
  console.log(`Untracked: ${untracked}`)

  check('Pending = 0', Number(counts.pending || 0) === 0)
  check('In Review = 0', Number(counts.in_review || 0) === 0)
  check('Failed = 0', Number(counts.failed || 0) === 0)
  check('Untracked = 0', untracked === 0)
  check('Needs Cleanup = 0', Number(counts.needs_cleanup || 0) === 0)

  console.log('\n=== Mixed-description detection ===\n')
  check(
    'clean overview not mixed',
    !detectLegacyMixedDescription('A comfortable room suitable for up to 4 guests.').isMixed
  )
  check(
    'ROOM INCLUSIONS is mixed',
    detectLegacyMixedDescription('Nice stay\nROOM INCLUSIONS\nWIFI\nTV\nFridge').isMixed
  )
  check(
    'check-in schedule is mixed',
    detectLegacyMixedDescription('Overview\nCHECK IN TIME: 2:00PM').isMixed
  )
  check(
    'phone contact is mixed',
    detectLegacyMixedDescription('Call us (043) 288-7153 for details').isMixed
  )

  console.log('\n=== Structured completeness (active inventory) ===\n')
  const [items] = await db.query(`
    SELECT
      ii.item_id,
      ii.name,
      ii.category_type,
      ii.description,
      ii.status,
      COALESCE(am.cnt,0) AS amenity_count,
      COALESCE(ad.cnt,0) AS accommodation_count,
      COALESCE(ab.cnt,0) AS bed_count,
      COALESCE(ap.cnt,0) AS policy_count
    FROM inventory_items ii
    LEFT JOIN (SELECT inventory_item_id, COUNT(*) AS cnt FROM inventory_item_amenities GROUP BY inventory_item_id) am
      ON am.inventory_item_id = ii.item_id
    LEFT JOIN (SELECT inventory_item_id, COUNT(*) AS cnt FROM accommodation_details GROUP BY inventory_item_id) ad
      ON ad.inventory_item_id = ii.item_id
    LEFT JOIN (SELECT inventory_item_id, COUNT(*) AS cnt FROM accommodation_beds GROUP BY inventory_item_id) ab
      ON ab.inventory_item_id = ii.item_id
    LEFT JOIN (SELECT inventory_item_id, COUNT(*) AS cnt FROM accommodation_extra_guest_policies GROUP BY inventory_item_id) ap
      ON ap.inventory_item_id = ii.item_id
    WHERE ii.category_type IN ('room', 'cottage', 'event')
  `)

  let mixedActive = 0
  let missingStructure = 0
  for (const row of items) {
    const hasStructured =
      Number(row.amenity_count) > 0
      || Number(row.accommodation_count) > 0
      || Number(row.bed_count) > 0
      || Number(row.policy_count) > 0
    if (!hasStructured) missingStructure += 1
    if (detectLegacyMixedDescription(row.description || '').isMixed) mixedActive += 1
  }
  check('no active mixed descriptions', mixedActive === 0, `count=${mixedActive}`)
  // Soft signal — events may only have venue fields; rooms should have structured after conversion
  console.log(`Items without structured child rows: ${missingStructure} (informational)`)

  // Orphans
  const orphanChecks = [
    ['inventory_item_amenities', 'inventory_item_id'],
    ['accommodation_details', 'inventory_item_id'],
    ['accommodation_beds', 'inventory_item_id'],
    ['accommodation_extra_guest_policies', 'inventory_item_id'],
  ]
  for (const [table, col] of orphanChecks) {
    const [rows] = await db.query(`
      SELECT COUNT(*) AS total
      FROM ${table} t
      LEFT JOIN inventory_items ii ON ii.item_id = t.${col}
      WHERE ii.item_id IS NULL
    `)
    check(`no orphan rows in ${table}`, Number(rows[0]?.total || 0) === 0)
  }

  console.log('\n=== Status lifecycle ===\n')
  const [statusCol] = await db.query("SHOW COLUMNS FROM inventory_items LIKE 'status'")
  const statusType = String(statusCol?.[0]?.Type || '')
  check('ENUM excludes Booked', !statusType.includes('Booked'))
  const [invalid] = await db.query(`
    SELECT COUNT(*) AS total FROM inventory_items
    WHERE status IS NULL OR TRIM(COALESCE(status,'')) = ''
       OR status NOT IN ('Available','Occupied','Under Maintenance')
  `)
  check('no invalid status rows', Number(invalid[0]?.total || 0) === 0)
  check('Occupied not bookable', !isBookableInventoryStatus('Occupied'))
  check('Under Maintenance not bookable', !isBookableInventoryStatus('Under Maintenance'))

  const assignSrc = await fs.readFile(path.join(here, '../services/roomAssignmentService.js'), 'utf8')
  check(
    'no Booked status writer in roomAssignmentService',
    !assignSrc.includes("status = 'Booked'")
      && !assignSrc.includes('status = "Booked"')
      && !assignSrc.includes("['Booked'")
      && !assignSrc.includes('["Booked"')
      && !/SET status\s*=\s*\?\s*[\s\S]{0,40}Booked/.test(assignSrc)
  )

  console.log('\n=== Customer fallback removal (source inspection) ===\n')
  const displaySrc = await fs.readFile(path.join(frontendRoot, 'src/utils/inventoryDisplay.js'), 'utf8')
  check(
    'inventoryDisplay does not parse legacy amenities',
    !displaySrc.includes('parseLegacyRoomAmenities')
  )
  const viewMoreSrc = await fs.readFile(path.join(frontendRoot, 'src/components/ViewMoreModal.vue'), 'utf8')
  check(
    'ViewMoreModal does not call legacy overview parser',
    !viewMoreSrc.includes('getLegacyRoomOverviewHtml')
      && !viewMoreSrc.includes('getLegacyRoomOverviewText')
  )
  const roomModalSrc = await fs.readFile(path.join(frontendRoot, 'src/components/RCE/Modals/RoomModal.vue'), 'utf8')
  check(
    'RoomModal does not call buildLegacyDescriptionHtml',
    !roomModalSrc.includes('buildLegacyDescriptionHtml')
  )
  const ocrModalSrc = await fs.readFile(path.join(frontendRoot, 'src/components/RCE/Modals/OcrReviewModal.vue'), 'utf8')
  check(
    'OcrReviewModal removed include-amenities-in-legacy checkbox',
    !ocrModalSrc.includes('Include selected amenities in legacy description')
  )

  console.log('\n=== Security / enforcement ===\n')
  const roomsCtrl = await fs.readFile(path.join(here, '../controllers/roomsController.js'), 'utf8')
  check('roomsController rejects mixed descriptions', roomsCtrl.includes('MIXED_LEGACY_DESCRIPTION'))
  check('roomsController requires structured_details on create', roomsCtrl.includes('STRUCTURED_DETAILS_REQUIRED'))
  check('roomsController sanitizes via assertCleanOverviewDescription', roomsCtrl.includes('assertCleanOverviewDescription'))

  const routesSrc = await fs.readFile(path.join(here, '../server.js'), 'utf8')
  check(
    'legacy conversion routes remain under /api/admin',
    routesSrc.includes("/api/admin/inventory/legacy-conversions")
  )

  // Conversion backups retained
  const [backupCols] = await db.query(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'inventory_legacy_conversions'
      AND COLUMN_NAME IN ('original_description','original_structured_details','applied_snapshot_json','source_snapshot_json')
  `)
  check('conversion backup columns retained', backupCols.length >= 4, `found=${backupCols.length}`)

  console.log('\n=== Phase 5 final gate ===\n')
  if (failures === 0) {
    console.log('PASS — Phase 5 finalization complete')
  } else {
    console.log('BLOCKED — Phase 5 finalization requirements remain')
  }
} catch (error) {
  failures += 1
  console.error('FAIL  phase5-final crashed —', error.message)
} finally {
  await db.end()
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}

console.log('\nAll Phase 5 final checks passed.')
