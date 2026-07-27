import db from '../config/db.js';
import { WEBHOOK_PROCESSING_STATUS } from '../utils/paymentStatuses.js';

/**
 * Begin webhook processing with retry-safe state machine.
 * Returns { action: 'process' | 'skip_completed' | 'skip_in_progress' }
 */
export const beginWebhookEvent = async (eventId, eventType) => {
  if (!eventId) {
    return { action: 'process', eventId: null };
  }

  const [existing] = await db.query(
    `SELECT id, processing_status
     FROM webhook_events
     WHERE event_id = ?
     LIMIT 1`,
    [eventId],
  );

  if (!existing.length) {
    await db.query(
      `INSERT INTO webhook_events (event_id, event_type, processing_status)
       VALUES (?, ?, ?)`,
      [eventId, eventType || 'unknown', WEBHOOK_PROCESSING_STATUS.PENDING],
    );
    await db.query(
      `UPDATE webhook_events
       SET processing_status = ?, processed_at = NULL, error_message = NULL
       WHERE event_id = ?`,
      [WEBHOOK_PROCESSING_STATUS.PROCESSING, eventId],
    );
    return { action: 'process', eventId };
  }

  const status = existing[0].processing_status;

  if (status === WEBHOOK_PROCESSING_STATUS.COMPLETED) {
    return { action: 'skip_completed', eventId };
  }

  if (status === WEBHOOK_PROCESSING_STATUS.PROCESSING) {
    return { action: 'skip_in_progress', eventId };
  }

  await db.query(
    `UPDATE webhook_events
     SET processing_status = ?, processed_at = NULL, error_message = NULL, event_type = ?
     WHERE event_id = ?`,
    [WEBHOOK_PROCESSING_STATUS.PROCESSING, eventType || 'unknown', eventId],
  );

  return { action: 'process', eventId };
};

export const completeWebhookEvent = async (eventId) => {
  if (!eventId) {
    return;
  }

  await db.query(
    `UPDATE webhook_events
     SET processing_status = ?, processed_at = NOW(), error_message = NULL
     WHERE event_id = ?`,
    [WEBHOOK_PROCESSING_STATUS.COMPLETED, eventId],
  );
};

export const failWebhookEvent = async (eventId, errorMessage) => {
  if (!eventId) {
    return;
  }

  await db.query(
    `UPDATE webhook_events
     SET processing_status = ?, error_message = ?, processed_at = NOW()
     WHERE event_id = ?`,
    [WEBHOOK_PROCESSING_STATUS.FAILED, String(errorMessage || 'unknown').slice(0, 2000), eventId],
  );
};
