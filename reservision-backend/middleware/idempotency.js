import db from '../config/db.js';

/**
 * Reserve a webhook event id before processing.
 * Returns true when the event was already processed (duplicate).
 */
export const isDuplicateWebhookEvent = async (eventId) => {
  if (!eventId) {
    return false;
  }

  const [rows] = await db.query(
    'SELECT id FROM webhook_events WHERE event_id = ? LIMIT 1',
    [eventId],
  );

  return rows.length > 0;
};

/**
 * Atomically claim an event id. Returns true if this caller won the claim.
 */
export const claimWebhookEvent = async (eventId, eventType) => {
  if (!eventId) {
    return true;
  }

  const [result] = await db.query(
    'INSERT IGNORE INTO webhook_events (event_id, event_type) VALUES (?, ?)',
    [eventId, eventType || 'unknown'],
  );

  return result.affectedRows > 0;
};

/**
 * Mark a webhook event as processed after successful handling.
 * Prefer claimWebhookEvent (insert-before-process) for race safety.
 */
export const recordWebhookEvent = async (eventId, eventType) => {
  if (!eventId) {
    return;
  }

  await db.query(
    'INSERT IGNORE INTO webhook_events (event_id, event_type) VALUES (?, ?)',
    [eventId, eventType || 'unknown'],
  );
};
