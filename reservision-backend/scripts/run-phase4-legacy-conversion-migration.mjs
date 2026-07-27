/**
 * Apply PHASE4_LEGACY_CONVERSION_TRACKING.sql against local DB.
 * Usage: node scripts/run-phase4-legacy-conversion-migration.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { db } from '../config/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sqlPath = path.join(__dirname, '..', 'schema', 'PHASE4_LEGACY_CONVERSION_TRACKING.sql')
const sql = fs.readFileSync(sqlPath, 'utf8')

const statements = sql
  .split(/;\s*\r?\n/)
  .map((chunk) => chunk
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim())
  .filter((s) => s.length > 10)

try {
  for (const statement of statements) {
    await db.query(statement)
    console.log('OK:', statement.slice(0, 72).replace(/\s+/g, ' '), '...')
  }
  const [tables] = await db.query("SHOW TABLES LIKE 'inventory_legacy_conversions'")
  console.log('Verified tables:', tables)
  console.log('Phase 4 legacy conversion tracking migration complete.')
} catch (error) {
  console.error('Migration failed:', error.code, error.message)
  process.exitCode = 1
} finally {
  await db.end()
}
