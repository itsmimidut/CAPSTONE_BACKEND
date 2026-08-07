import db from '../config/db.js';

const serializeValue = (value) => {
  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return null;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ value: String(value) });
  }
};

const getRequestMeta = (req) => ({
  ip_address: req?.ip || req?.socket?.remoteAddress || null,
  user_agent: req?.headers?.['user-agent'] || null,
});

/**
 * Append-only audit log entry for financial and administrative actions.
 */
export const logAudit = async ({
  userId = 0,
  action,
  entityType,
  entityId = 0,
  oldValue = null,
  newValue = null,
  req = null,
  connection = db,
}) => {
  if (!action || !entityType) {
    return;
  }

  const meta = getRequestMeta(req);

  await connection.query(
    `INSERT INTO audit_logs (
      user_id,
      action,
      entity_type,
      entity_id,
      old_value,
      new_value,
      ip_address,
      user_agent
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId || 0,
      action,
      entityType,
      entityId || 0,
      oldValue === null ? null : serializeValue(oldValue),
      newValue === null ? null : serializeValue(newValue),
      meta.ip_address,
      meta.user_agent,
    ],
  );
};

export const AUDIT_ACTIONS = {
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  BOOKING_APPROVED: 'BOOKING_APPROVED',
  BOOKING_REJECTED: 'BOOKING_REJECTED',
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  REFUND_APPROVED: 'REFUND_APPROVED',
  REFUND_REJECTED: 'REFUND_REJECTED',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
  FEEDBACK_CREATED: 'FEEDBACK_CREATED',
  FEEDBACK_RESTORED: 'FEEDBACK_RESTORED',
  FEEDBACK_UPDATED: 'FEEDBACK_UPDATED',
  FEEDBACK_DELETED: 'FEEDBACK_DELETED',
  FEEDBACK_APPROVED: 'FEEDBACK_APPROVED',
  FEEDBACK_REJECTED: 'FEEDBACK_REJECTED',
  FEEDBACK_HIDDEN: 'FEEDBACK_HIDDEN',
  FEEDBACK_RESET_PENDING: 'FEEDBACK_RESET_PENDING',
  FEEDBACK_REPLIED: 'FEEDBACK_REPLIED',
  ESHOP_FEEDBACK_CREATED: 'ESHOP_FEEDBACK_CREATED',
  ESHOP_FEEDBACK_UPDATED: 'ESHOP_FEEDBACK_UPDATED',
  ESHOP_FEEDBACK_DELETED: 'ESHOP_FEEDBACK_DELETED',
  ESHOP_FEEDBACK_RESTORED: 'ESHOP_FEEDBACK_RESTORED',
  ESHOP_FEEDBACK_APPROVED: 'ESHOP_FEEDBACK_APPROVED',
  ESHOP_FEEDBACK_REJECTED: 'ESHOP_FEEDBACK_REJECTED',
  ESHOP_FEEDBACK_HIDDEN: 'ESHOP_FEEDBACK_HIDDEN',
  ESHOP_FEEDBACK_RESET_PENDING: 'ESHOP_FEEDBACK_RESET_PENDING',
  ESHOP_FEEDBACK_REPLIED: 'ESHOP_FEEDBACK_REPLIED',
  ESHOP_FEEDBACK_ADMIN_RESTORED: 'ESHOP_FEEDBACK_ADMIN_RESTORED',
};
