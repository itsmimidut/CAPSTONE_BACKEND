import db from '../config/db.js';
import {
  FEEDBACK_ELIGIBILITY_CODE,
  FEEDBACK_LIMITS,
  FEEDBACK_MODERATION_STATUS,
  FEEDBACK_PUBLIC_SORT_SQL,
  canTransitionFeedbackStatus,
  getFeedbackEditDeadline,
  isFeedbackEligibleBooking,
  isWithinFeedbackEditWindow,
} from '../constants/feedbackRules.js';
import { logAudit } from '../utils/auditLogger.js';
import { getPublicCustomerName } from '../utils/feedbackDisplay.js';
import {
  createCustomerNotification,
  emitPersistedCustomerNotification,
} from './customerNotificationService.js';

export class FeedbackServiceError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'FeedbackServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const toIso = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const parsePagination = (pageValue, limitValue) => {
  const page = Math.max(1, Number.parseInt(pageValue, 10) || 1);
  const limit = Math.min(
    FEEDBACK_LIMITS.MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(limitValue, 10) || FEEDBACK_LIMITS.DEFAULT_PAGE_SIZE),
  );
  return { page, limit, offset: (page - 1) * limit };
};

export async function findCustomerByUserId(userId, executor = db) {
  const [rows] = await executor.query(
    `SELECT customer_id, user_id
     FROM customers
     WHERE user_id = ?
     LIMIT 1`,
    [userId],
  );
  return rows[0] || null;
}

export async function findBookingById(bookingId, executor = db, lock = false) {
  const [rows] = await executor.query(
    `SELECT
       b.booking_id,
       b.customer_id,
       b.booking_status,
       b.actual_check_out_time,
       b.created_at,
       c.user_id
     FROM bookings b
     LEFT JOIN customers c ON c.customer_id = b.customer_id
     WHERE b.booking_id = ?
     LIMIT 1
     ${lock ? 'FOR UPDATE' : ''}`,
    [bookingId],
  );
  return rows[0] || null;
}

export async function findFeedbackByBookingId(bookingId, executor = db, lock = false) {
  const [rows] = await executor.query(
    `SELECT
       feedback_id, booking_id, customer_id, overall_rating, title, comment,
       is_anonymous, moderation_status, rejection_reason, admin_reply,
       reply_version, replied_at, deleted_at, deleted_by, created_at, updated_at
     FROM booking_feedback
     WHERE booking_id = ?
     LIMIT 1
     ${lock ? 'FOR UPDATE' : ''}`,
    [bookingId],
  );
  return rows[0] || null;
}

async function findFeedbackById(feedbackId, executor = db, lock = false) {
  const [rows] = await executor.query(
    `SELECT *
     FROM booking_feedback
     WHERE feedback_id = ?
     LIMIT 1
     ${lock ? 'FOR UPDATE' : ''}`,
    [feedbackId],
  );
  return rows[0] || null;
}

function assertBookingOwnership(booking, customer) {
  if (!booking) {
    throw new FeedbackServiceError(
      404,
      FEEDBACK_ELIGIBILITY_CODE.BOOKING_NOT_FOUND,
      'Booking is unavailable.',
    );
  }
  if (
    !customer
    || !booking.customer_id
    || Number(booking.customer_id) !== Number(customer.customer_id)
  ) {
    throw new FeedbackServiceError(
      404,
      FEEDBACK_ELIGIBILITY_CODE.BOOKING_NOT_OWNED,
      'Booking is unavailable.',
    );
  }
}

function assertFeedbackOwnership(feedback, customer) {
  if (
    !feedback
    || !customer
    || Number(feedback.customer_id) !== Number(customer.customer_id)
  ) {
    throw new FeedbackServiceError(404, 'FEEDBACK_NOT_FOUND', 'Feedback is unavailable.');
  }
}

function mapFeedbackState(feedback, serverNow = new Date()) {
  const deadline = getFeedbackEditDeadline(feedback.created_at);
  const withinWindow = isWithinFeedbackEditWindow(feedback.created_at, serverNow);
  return {
    feedbackId: feedback.feedback_id,
    moderationStatus: feedback.moderation_status,
    deleted: Boolean(feedback.deleted_at),
    canEdit: !feedback.deleted_at && withinWindow,
    canRestore: Boolean(feedback.deleted_at) && withinWindow,
    editDeadline: deadline?.toISOString() || null,
  };
}

function mapCustomerFeedback(feedback, serverNow = new Date()) {
  const state = mapFeedbackState(feedback, serverNow);
  return {
    feedbackId: feedback.feedback_id,
    bookingId: feedback.booking_id,
    ...(feedback.booking_reference
      ? { bookingReference: feedback.booking_reference }
      : {}),
    overallRating: Number(feedback.overall_rating),
    title: feedback.title,
    comment: feedback.comment,
    isAnonymous: Boolean(feedback.is_anonymous),
    moderationStatus: feedback.moderation_status,
    rejectionReason: feedback.rejection_reason,
    adminReply: feedback.admin_reply,
    repliedAt: toIso(feedback.replied_at),
    deleted: state.deleted,
    createdAt: toIso(feedback.created_at),
    updatedAt: toIso(feedback.updated_at),
    editDeadline: state.editDeadline,
    canEdit: state.canEdit,
    canRestore: state.canRestore,
  };
}

export async function checkFeedbackEligibility({ bookingId, userId, serverNow = new Date() }) {
  const customer = await findCustomerByUserId(userId);
  const booking = await findBookingById(bookingId);
  assertBookingOwnership(booking, customer);

  if (!isFeedbackEligibleBooking(booking)) {
    return {
      eligible: false,
      code: FEEDBACK_ELIGIBILITY_CODE.BOOKING_NOT_COMPLETED,
      message: 'Feedback becomes available after checkout.',
      feedback: null,
    };
  }

  const feedback = await findFeedbackByBookingId(bookingId);
  if (!feedback) {
    return {
      eligible: true,
      code: FEEDBACK_ELIGIBILITY_CODE.ELIGIBLE,
      message: null,
      feedback: null,
    };
  }

  const state = mapFeedbackState(feedback, serverNow);
  if (state.deleted && state.canRestore) {
    return {
      eligible: false,
      code: FEEDBACK_ELIGIBILITY_CODE.FEEDBACK_DELETED_RESTORABLE,
      message: 'Deleted feedback may still be restored.',
      feedback: state,
    };
  }
  if (!state.deleted && state.canEdit) {
    return {
      eligible: false,
      code: FEEDBACK_ELIGIBILITY_CODE.FEEDBACK_EDITABLE,
      message: 'Feedback has already been submitted.',
      feedback: state,
    };
  }
  if (!state.canEdit && !state.canRestore) {
    return {
      eligible: false,
      code: FEEDBACK_ELIGIBILITY_CODE.FEEDBACK_EDIT_WINDOW_EXPIRED,
      message: 'The feedback editing period has expired.',
      feedback: state,
    };
  }
  return {
    eligible: false,
    code: FEEDBACK_ELIGIBILITY_CODE.FEEDBACK_ALREADY_EXISTS,
    message: 'Feedback has already been submitted.',
    feedback: state,
  };
}

export async function createFeedback({
  userId,
  input,
  req = null,
  auditLogger = logAudit,
  serverNow = new Date(),
}) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const customer = await findCustomerByUserId(userId, connection);
    if (!customer) {
      throw new FeedbackServiceError(
        403,
        'CUSTOMER_PROFILE_NOT_FOUND',
        'A customer profile is required.',
      );
    }

    // Locking the booking serializes concurrent creation attempts for one booking.
    const booking = await findBookingById(input.bookingId, connection, true);
    assertBookingOwnership(booking, customer);
    if (!isFeedbackEligibleBooking(booking)) {
      throw new FeedbackServiceError(
        403,
        FEEDBACK_ELIGIBILITY_CODE.BOOKING_NOT_COMPLETED,
        'Feedback can only be submitted after checkout.',
      );
    }

    const existing = await findFeedbackByBookingId(input.bookingId, connection, true);
    if (existing && !existing.deleted_at) {
      throw new FeedbackServiceError(
        409,
        FEEDBACK_ELIGIBILITY_CODE.FEEDBACK_ALREADY_EXISTS,
        'Feedback has already been submitted.',
      );
    }

    let feedbackId;
    let restored = false;
    if (existing?.deleted_at) {
      if (!isWithinFeedbackEditWindow(existing.created_at, serverNow)) {
        throw new FeedbackServiceError(
          403,
          FEEDBACK_ELIGIBILITY_CODE.FEEDBACK_EDIT_WINDOW_EXPIRED,
          'The feedback restoration period has expired.',
        );
      }
      await connection.query(
        `UPDATE booking_feedback
         SET overall_rating = ?, title = ?, comment = ?, is_anonymous = ?,
             moderation_status = 'pending', rejection_reason = NULL,
             moderated_by = NULL, moderated_at = NULL,
             admin_reply = NULL, replied_by = NULL, replied_at = NULL,
             deleted_at = NULL, deleted_by = NULL, updated_at = NOW()
         WHERE feedback_id = ?`,
        [
          input.overallRating,
          input.title,
          input.comment,
          input.isAnonymous ? 1 : 0,
          existing.feedback_id,
        ],
      );
      feedbackId = existing.feedback_id;
      restored = true;
    } else {
      const [result] = await connection.query(
        `INSERT INTO booking_feedback (
           booking_id, customer_id, overall_rating, title, comment,
           is_anonymous, moderation_status
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [
          input.bookingId,
          customer.customer_id,
          input.overallRating,
          input.title,
          input.comment,
          input.isAnonymous ? 1 : 0,
        ],
      );
      feedbackId = result.insertId;
    }

    await auditLogger({
      userId,
      action: restored ? 'FEEDBACK_RESTORED' : 'FEEDBACK_CREATED',
      entityType: 'BOOKING_FEEDBACK',
      entityId: feedbackId,
      oldValue: restored
        ? { deleted: true, moderationStatus: existing.moderation_status }
        : null,
      newValue: {
        bookingId: input.bookingId,
        moderationStatus: FEEDBACK_MODERATION_STATUS.PENDING,
        deleted: false,
      },
      req,
      connection,
    });

    await connection.commit();
    return {
      feedbackId,
      restored,
      moderationStatus: FEEDBACK_MODERATION_STATUS.PENDING,
    };
  } catch (error) {
    await connection.rollback();
    if (error?.code === 'ER_DUP_ENTRY') {
      throw new FeedbackServiceError(
        409,
        FEEDBACK_ELIGIBILITY_CODE.FEEDBACK_ALREADY_EXISTS,
        'Feedback has already been submitted.',
      );
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateFeedback({
  feedbackId,
  userId,
  input,
  req = null,
  auditLogger = logAudit,
  serverNow = new Date(),
}) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const customer = await findCustomerByUserId(userId, connection);
    const existing = await findFeedbackById(feedbackId, connection, true);
    assertFeedbackOwnership(existing, customer);
    if (existing.deleted_at) {
      throw new FeedbackServiceError(
        409,
        'FEEDBACK_DELETED',
        'Deleted feedback must be restored before editing.',
      );
    }
    if (!isWithinFeedbackEditWindow(existing.created_at, serverNow)) {
      throw new FeedbackServiceError(
        403,
        FEEDBACK_ELIGIBILITY_CODE.FEEDBACK_EDIT_WINDOW_EXPIRED,
        'The feedback editing period has expired.',
      );
    }

    await connection.query(
      `UPDATE booking_feedback
       SET overall_rating = ?, title = ?, comment = ?, is_anonymous = ?,
           moderation_status = 'pending', rejection_reason = NULL,
           moderated_by = NULL, moderated_at = NULL,
           admin_reply = NULL, replied_by = NULL, replied_at = NULL,
           updated_at = NOW()
       WHERE feedback_id = ?`,
      [
        input.overallRating,
        input.title,
        input.comment,
        input.isAnonymous ? 1 : 0,
        feedbackId,
      ],
    );

    await auditLogger({
      userId,
      action: 'FEEDBACK_UPDATED',
      entityType: 'BOOKING_FEEDBACK',
      entityId: feedbackId,
      oldValue: {
        overallRating: existing.overall_rating,
        isAnonymous: Boolean(existing.is_anonymous),
        moderationStatus: existing.moderation_status,
      },
      newValue: {
        overallRating: input.overallRating,
        isAnonymous: input.isAnonymous,
        moderationStatus: FEEDBACK_MODERATION_STATUS.PENDING,
      },
      req,
      connection,
    });

    await connection.commit();
    return {
      feedbackId,
      moderationStatus: FEEDBACK_MODERATION_STATUS.PENDING,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function deleteFeedback({
  feedbackId,
  userId,
  req = null,
  auditLogger = logAudit,
  serverNow = new Date(),
}) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const customer = await findCustomerByUserId(userId, connection);
    const existing = await findFeedbackById(feedbackId, connection, true);
    assertFeedbackOwnership(existing, customer);
    if (existing.deleted_at) {
      await connection.commit();
      return { feedbackId, alreadyDeleted: true };
    }
    if (!isWithinFeedbackEditWindow(existing.created_at, serverNow)) {
      throw new FeedbackServiceError(
        403,
        FEEDBACK_ELIGIBILITY_CODE.FEEDBACK_EDIT_WINDOW_EXPIRED,
        'The feedback deletion period has expired.',
      );
    }

    await connection.query(
      `UPDATE booking_feedback
       SET deleted_at = NOW(), deleted_by = ?, updated_at = NOW()
       WHERE feedback_id = ?`,
      [userId, feedbackId],
    );
    await auditLogger({
      userId,
      action: 'FEEDBACK_DELETED',
      entityType: 'BOOKING_FEEDBACK',
      entityId: feedbackId,
      oldValue: { deleted: false },
      newValue: { deleted: true },
      req,
      connection,
    });
    await connection.commit();
    return { feedbackId, alreadyDeleted: false };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getFeedbackByBooking({ bookingId, userId, serverNow = new Date() }) {
  const customer = await findCustomerByUserId(userId);
  const booking = await findBookingById(bookingId);
  assertBookingOwnership(booking, customer);
  const feedback = await findFeedbackByBookingId(bookingId);
  if (!feedback) {
    throw new FeedbackServiceError(
      404,
      'FEEDBACK_NOT_FOUND',
      'Feedback has not been submitted.',
    );
  }
  return mapCustomerFeedback(feedback, serverNow);
}

export async function getCustomerFeedbackHistory({
  userId,
  page: pageValue,
  limit: limitValue,
  serverNow = new Date(),
}) {
  const customer = await findCustomerByUserId(userId);
  if (!customer) {
    throw new FeedbackServiceError(
      403,
      'CUSTOMER_PROFILE_NOT_FOUND',
      'A customer profile is required.',
    );
  }
  const { page, limit, offset } = parsePagination(pageValue, limitValue);
  const [rows] = await db.query(
    `SELECT
       f.feedback_id, f.booking_id, b.booking_reference, f.overall_rating,
       f.title, f.comment, f.is_anonymous, f.moderation_status,
       f.rejection_reason, f.admin_reply, f.replied_at, f.deleted_at,
       f.created_at, f.updated_at
     FROM booking_feedback f
     JOIN bookings b ON b.booking_id = f.booking_id
     WHERE f.customer_id = ?
     ORDER BY f.created_at DESC
     LIMIT ? OFFSET ?`,
    [customer.customer_id, limit, offset],
  );
  const [countRows] = await db.query(
    'SELECT COUNT(*) AS total FROM booking_feedback WHERE customer_id = ?',
    [customer.customer_id],
  );
  const total = Number(countRows[0]?.total || 0);
  return {
    feedback: rows.map((row) => mapCustomerFeedback(row, serverNow)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

const publicSummaryFromRow = (row = {}) => ({
  averageRating: Number(row.average_rating || 0),
  totalReviews: Number(row.total_reviews || 0),
  ratingDistribution: {
    5: Number(row.five_star || 0),
    4: Number(row.four_star || 0),
    3: Number(row.three_star || 0),
    2: Number(row.two_star || 0),
    1: Number(row.one_star || 0),
  },
});

export async function getPublicFeedbackSummary(executor = db) {
  const [rows] = await executor.query(
    `SELECT ROUND(AVG(overall_rating), 2) AS average_rating,
            COUNT(*) AS total_reviews,
            SUM(overall_rating = 5) AS five_star,
            SUM(overall_rating = 4) AS four_star,
            SUM(overall_rating = 3) AS three_star,
            SUM(overall_rating = 2) AS two_star,
            SUM(overall_rating = 1) AS one_star
     FROM booking_feedback
     WHERE moderation_status = 'approved' AND deleted_at IS NULL`,
  );
  return publicSummaryFromRow(rows[0]);
}

export async function getPublicFeedback({ page, limit, rating, sort }) {
  const offset = (page - 1) * limit;
  const orderBy = FEEDBACK_PUBLIC_SORT_SQL[sort] || FEEDBACK_PUBLIC_SORT_SQL.newest;
  const where = ["f.moderation_status = 'approved'", 'f.deleted_at IS NULL'];
  const params = [];
  if (rating) {
    where.push('f.overall_rating = ?');
    params.push(rating);
  }
  const [rows] = await db.query(
    `SELECT f.feedback_id, f.overall_rating, f.title, f.comment,
            f.is_anonymous, f.admin_reply, f.replied_at, f.created_at,
            CONCAT_WS(' ', u.first_name, u.last_name) AS customer_name
     FROM booking_feedback f
     JOIN customers c ON c.customer_id = f.customer_id
     JOIN user u ON u.user_id = c.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  const [[countRow], summary] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS total
       FROM booking_feedback f
       WHERE ${where.join(' AND ')}`,
      params,
    ).then(([countRows]) => countRows),
    getPublicFeedbackSummary(),
  ]);
  const totalItems = Number(countRow?.total || 0);
  return {
    reviews: rows.map((row) => ({
      feedbackId: row.feedback_id,
      customerName: getPublicCustomerName({
        isAnonymous: row.is_anonymous,
        customerName: row.customer_name,
      }),
      verifiedStay: true,
      overallRating: Number(row.overall_rating),
      title: row.title,
      comment: row.comment,
      adminReply: row.admin_reply,
      repliedAt: toIso(row.replied_at),
      createdAt: toIso(row.created_at),
    })),
    summary,
    pagination: {
      page,
      limit,
      totalPages: Math.ceil(totalItems / limit),
      totalItems,
    },
  };
}

const buildAdminFilters = ({ status, rating, dateFrom, dateTo, search }) => {
  const where = [];
  const params = [];
  if (status === 'deleted') where.push('f.deleted_at IS NOT NULL');
  else if (status && status !== 'all') {
    where.push('f.moderation_status = ?');
    where.push('f.deleted_at IS NULL');
    params.push(status);
  }
  if (rating) {
    where.push('f.overall_rating = ?');
    params.push(rating);
  }
  if (dateFrom) {
    where.push('f.created_at >= ?');
    params.push(`${dateFrom} 00:00:00`);
  }
  if (dateTo) {
    where.push('f.created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    params.push(`${dateTo} 00:00:00`);
  }
  if (search) {
    where.push(`(
      f.title LIKE ? OR f.comment LIKE ? OR b.booking_reference LIKE ?
      OR u.first_name LIKE ? OR u.last_name LIKE ?
    )`);
    const term = `%${search}%`;
    params.push(term, term, term, term, term);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
};

const mapAdminFeedback = (row) => ({
  feedbackId: row.feedback_id,
  bookingId: row.booking_id,
  bookingReference: row.booking_reference,
  customerId: row.customer_id,
  customerName: String(`${row.first_name || ''} ${row.last_name || ''}`).trim(),
  overallRating: Number(row.overall_rating),
  title: row.title,
  comment: row.comment,
  isAnonymous: Boolean(row.is_anonymous),
  moderationStatus: row.moderation_status,
  rejectionReason: row.rejection_reason,
  adminReply: row.admin_reply,
  replyVersion: Number(row.reply_version || 0),
  deleted: Boolean(row.deleted_at),
  bookingStatus: row.booking_status,
  actualCheckOutTime: toIso(row.actual_check_out_time),
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
});

const ADMIN_SELECT = `SELECT f.*, b.booking_reference, b.booking_status,
  b.actual_check_out_time, u.first_name, u.last_name
  FROM booking_feedback f
  JOIN bookings b ON b.booking_id = f.booking_id
  JOIN customers c ON c.customer_id = f.customer_id
  JOIN user u ON u.user_id = c.user_id`;

export async function getAdminFeedback(filters) {
  const { page, limit, sort } = filters;
  const offset = (page - 1) * limit;
  const where = buildAdminFilters(filters);
  const orderBy = FEEDBACK_PUBLIC_SORT_SQL[sort] || FEEDBACK_PUBLIC_SORT_SQL.newest;
  const [rows] = await db.query(
    `${ADMIN_SELECT} ${where.sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...where.params, limit, offset],
  );
  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total
     FROM booking_feedback f
     JOIN bookings b ON b.booking_id = f.booking_id
     JOIN customers c ON c.customer_id = f.customer_id
     JOIN user u ON u.user_id = c.user_id
     ${where.sql}`,
    where.params,
  );
  const totalItems = Number(countRows[0]?.total || 0);
  return {
    feedback: rows.map(mapAdminFeedback),
    pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
  };
}

export async function getAdminFeedbackById({ feedbackId }, executor = db) {
  const [rows] = await executor.query(
    `${ADMIN_SELECT} WHERE f.feedback_id = ? LIMIT 1`,
    [feedbackId],
  );
  if (!rows[0]) throw new FeedbackServiceError(404, 'FEEDBACK_NOT_FOUND', 'Feedback is unavailable.');
  return mapAdminFeedback(rows[0]);
}

export async function moderateFeedback({
  feedbackId,
  adminUserId,
  status,
  reason,
  req = null,
  auditLogger = logAudit,
}) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const existing = await findFeedbackById(feedbackId, connection, true);
    if (!existing) throw new FeedbackServiceError(404, 'FEEDBACK_NOT_FOUND', 'Feedback is unavailable.');
    if (existing.deleted_at) throw new FeedbackServiceError(409, 'FEEDBACK_DELETED', 'Deleted feedback cannot be moderated.');
    if (!canTransitionFeedbackStatus(existing.moderation_status, status)) {
      throw new FeedbackServiceError(409, 'INVALID_FEEDBACK_TRANSITION', 'That moderation transition is not allowed.');
    }
    const returningToPending = status === FEEDBACK_MODERATION_STATUS.PENDING;
    await connection.query(
      `UPDATE booking_feedback
       SET moderation_status = ?, rejection_reason = ?,
           moderated_by = ?, moderated_at = ${returningToPending ? 'NULL' : 'NOW()'},
           updated_at = NOW()
       WHERE feedback_id = ?`,
      [status, status === 'rejected' ? reason : null, returningToPending ? null : adminUserId, feedbackId],
    );
    const action = {
      approved: 'FEEDBACK_APPROVED',
      rejected: 'FEEDBACK_REJECTED',
      hidden: 'FEEDBACK_HIDDEN',
      pending: 'FEEDBACK_RESET_PENDING',
    }[status];
    await auditLogger({
      userId: adminUserId,
      action,
      entityType: 'BOOKING_FEEDBACK',
      entityId: feedbackId,
      oldValue: { moderationStatus: existing.moderation_status },
      newValue: {
        moderationStatus: status,
        hasRejectionReason: status === 'rejected' && Boolean(reason),
      },
      req,
      connection,
    });
    await connection.commit();
    return { feedbackId, moderationStatus: status };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function replyToFeedback({
  feedbackId,
  adminUserId,
  reply,
  req = null,
  auditLogger = logAudit,
  notificationCreator = createCustomerNotification,
  notificationEmitter = emitPersistedCustomerNotification,
}) {
  const connection = await db.getConnection();
  let notificationId = null;
  try {
    await connection.beginTransaction();
    const existing = await findFeedbackById(feedbackId, connection, true);
    if (!existing) throw new FeedbackServiceError(404, 'FEEDBACK_NOT_FOUND', 'Feedback is unavailable.');
    if (existing.deleted_at) throw new FeedbackServiceError(409, 'FEEDBACK_DELETED', 'Deleted feedback cannot receive a reply.');
    if (existing.admin_reply === reply) {
      await connection.commit();
      return {
        feedbackId,
        replyVersion: Number(existing.reply_version || 0),
        moderationStatus: existing.moderation_status,
        unchanged: true,
      };
    }
    const [customerRows] = await connection.query(
      'SELECT customer_id, user_id FROM customers WHERE customer_id = ? LIMIT 1',
      [existing.customer_id],
    );
    await connection.query(
      `UPDATE booking_feedback
       SET admin_reply = ?, replied_by = ?, replied_at = NOW(),
           reply_version = reply_version + 1, updated_at = NOW()
       WHERE feedback_id = ?`,
      [reply, adminUserId, feedbackId],
    );
    const newVersion = Number(existing.reply_version || 0) + 1;
    await auditLogger({
      userId: adminUserId,
      action: 'FEEDBACK_REPLIED',
      entityType: 'BOOKING_FEEDBACK',
      entityId: feedbackId,
      oldValue: { previousReplyVersion: Number(existing.reply_version || 0) },
      newValue: { newReplyVersion: newVersion },
      req,
      connection,
    });
    const customer = customerRows[0];
    if (customer?.user_id) {
      notificationId = await notificationCreator({
        userId: customer.user_id,
        customerId: customer.customer_id,
        title: 'Management replied to your feedback',
        message: 'The resort has replied to your review.',
        type: 'feedback_reply',
        link: '/customer/feedback',
        eventKey: `feedback_reply:${feedbackId}:${newVersion}`,
        connection,
      });
    }
    await connection.commit();
    if (notificationId) {
      try {
        await notificationEmitter(notificationId);
      } catch (error) {
        console.warn('Feedback reply realtime notification failed:', error.message);
      }
    }
    return { feedbackId, replyVersion: newVersion, moderationStatus: existing.moderation_status };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function restoreFeedbackAsAdmin({
  feedbackId,
  adminUserId,
  req = null,
  auditLogger = logAudit,
  serverNow = new Date(),
}) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const existing = await findFeedbackById(feedbackId, connection, true);
    if (!existing) throw new FeedbackServiceError(404, 'FEEDBACK_NOT_FOUND', 'Feedback is unavailable.');
    if (!existing.deleted_at) throw new FeedbackServiceError(409, 'FEEDBACK_NOT_DELETED', 'Only deleted feedback can be restored.');
    await connection.query(
      `UPDATE booking_feedback
       SET deleted_at = NULL, deleted_by = NULL, moderation_status = 'pending',
           rejection_reason = NULL, moderated_by = NULL, moderated_at = NULL,
           updated_at = NOW()
       WHERE feedback_id = ?`,
      [feedbackId],
    );
    await auditLogger({
      userId: adminUserId,
      action: 'FEEDBACK_RESTORED',
      entityType: 'BOOKING_FEEDBACK',
      entityId: feedbackId,
      oldValue: { deleted: true, moderationStatus: existing.moderation_status },
      newValue: {
        deleted: false,
        moderationStatus: FEEDBACK_MODERATION_STATUS.PENDING,
        restoredByAdmin: true,
        editWindowExpired: !isWithinFeedbackEditWindow(existing.created_at, serverNow),
      },
      req,
      connection,
    });
    await connection.commit();
    return { feedbackId, moderationStatus: FEEDBACK_MODERATION_STATUS.PENDING, restored: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
