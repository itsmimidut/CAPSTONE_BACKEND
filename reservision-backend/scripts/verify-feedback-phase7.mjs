import db from '../config/db.js';

const checks = [
  ['duplicate booking feedback', `
    SELECT booking_id, COUNT(*) AS total
    FROM booking_feedback
    GROUP BY booking_id
    HAVING COUNT(*) > 1
  `],
  ['invalid ratings', `
    SELECT feedback_id, overall_rating
    FROM booking_feedback
    WHERE overall_rating < 1 OR overall_rating > 5
  `],
  ['inconsistent deleted fields', `
    SELECT feedback_id
    FROM booking_feedback
    WHERE deleted_at IS NULL AND deleted_by IS NOT NULL
  `],
  ['inconsistent pending moderation fields', `
    SELECT feedback_id
    FROM booking_feedback
    WHERE moderation_status = 'pending'
      AND (
        moderated_by IS NOT NULL
        OR moderated_at IS NOT NULL
        OR rejection_reason IS NOT NULL
      )
  `],
  ['duplicate notification event keys', `
    SELECT event_key, COUNT(*) AS total
    FROM customer_notifications
    WHERE event_key IS NOT NULL
    GROUP BY event_key
    HAVING COUNT(*) > 1
  `],
];

let failed = false;

try {
  for (const [name, sql] of checks) {
    const [rows] = await db.query(sql);
    const passed = rows.length === 0;
    failed ||= !passed;
    console.log(`${passed ? 'PASS' : 'FAIL'}: ${name} (${rows.length} row(s))`);
    if (!passed) console.log(JSON.stringify(rows, null, 2));
  }
} catch (error) {
  failed = true;
  console.error(`ERROR: ${error.message}`);
} finally {
  await db.end();
}

process.exitCode = failed ? 1 : 0;
