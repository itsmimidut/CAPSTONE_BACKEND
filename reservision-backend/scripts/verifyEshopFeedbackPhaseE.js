import db from '../config/db.js';
import {
    createFeedback,
    deleteFeedback,
    getAdminFeedback,
    getPublicFeedback,
    moderateFeedback,
    replyToFeedback,
    restoreFeedbackAsAdmin,
} from '../services/eshopFeedbackService.js';

let feedbackId = null;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

try {
    const [lines] = await db.query(
        `SELECT pti.line_id, c.user_id
         FROM pos_transaction_items pti
         JOIN pos_transactions pt ON pt.id = pti.transaction_id
         JOIN customers c ON c.customer_id = pt.customer_id
         LEFT JOIN eshop_item_feedback f ON f.transaction_item_id = pti.line_id
         WHERE pt.type = 'E-Shop'
           AND pt.fulfillment_status IN ('delivered', 'picked_up')
           AND pti.menu_id IS NOT NULL
           AND f.feedback_id IS NULL
         ORDER BY pt.id DESC LIMIT 1`,
    );
    const [admins] = await db.query(
        `SELECT user_id FROM user
         WHERE LOWER(REPLACE(TRIM(role), ' ', '')) = 'admin'
         ORDER BY user_id LIMIT 1`,
    );
    assert(lines.length && admins.length, 'A fulfilled catalog line and an admin user are required.');
    const line = lines[0];
    const adminUserId = admins[0].user_id;
    const created = await createFeedback({
        userId: line.user_id,
        input: {
            transactionItemId: line.line_id,
            overallRating: 5,
            title: 'Phase E public review',
            comment: 'Temporary approved product review for Phase E verification.',
            isAnonymous: false,
        },
    });
    feedbackId = created.feedbackId;
    const [[feedbackRow]] = await db.query(
        'SELECT menu_id, created_at, moderation_status FROM eshop_item_feedback WHERE feedback_id = ?',
        [feedbackId],
    );

    const beforeApproval = await getPublicFeedback({
        menuItemId: feedbackRow.menu_id, page: 1, limit: 1, rating: 5, sort: 'newest',
    });
    assert(!beforeApproval.reviews.some((review) => review.feedbackId === feedbackId),
        'Pending feedback must not be public.');

    await moderateFeedback({ feedbackId, adminUserId, status: 'approved' });
    const publicResult = await getPublicFeedback({
        menuItemId: feedbackRow.menu_id, page: 1, limit: 1, rating: 5, sort: 'highest',
    });
    const publicReview = publicResult.reviews.find((review) => review.feedbackId === feedbackId);
    assert(publicReview?.verifiedPurchase === true, 'Approved feedback must be a verified public review.');
    assert(!['transactionId', 'transactionItemId', 'customerId', 'rejectionReason']
        .some((field) => Object.hasOwn(publicReview, field)), 'Public response exposed a private field.');
    assert(/\.$/.test(publicReview.customerName) || publicReview.customerName === 'Anonymous Guest',
        'Public customer name must be masked.');
    assert(publicResult.summary.totalReviews >= 1, 'Independent product summary must count approved reviews.');

    const replyOne = await replyToFeedback({
        feedbackId, adminUserId, reply: 'Thank you for reviewing this product.',
    });
    const replyRetry = await replyToFeedback({
        feedbackId, adminUserId, reply: '  Thank you for reviewing this product.  ',
    });
    assert(replyOne.replyVersion === 1 && replyRetry.idempotent === true && replyRetry.replyVersion === 1,
        'Identical reply retry must not increment reply version.');
    const [[notificationCount]] = await db.query(
        `SELECT COUNT(*) AS total FROM customer_notifications
         WHERE event_key = ?`,
        [`product_feedback_reply:${feedbackId}:1`],
    );
    assert(Number(notificationCount.total) === 1, 'Reply must create exactly one idempotent notification.');
    const [[afterReply]] = await db.query(
        'SELECT moderation_status FROM eshop_item_feedback WHERE feedback_id = ?',
        [feedbackId],
    );
    assert(afterReply.moderation_status === 'approved', 'Reply must not change moderation status.');

    const adminResult = await getAdminFeedback({
        page: 1, limit: 10, status: 'approved', rating: 5, menuItemId: feedbackRow.menu_id,
        dateFrom: null, dateTo: null, search: 'Phase E', sort: 'newest',
    });
    assert(adminResult.feedback.some((item) => item.feedbackId === feedbackId),
        'Admin filtered list must include the product review.');

    await deleteFeedback({ feedbackId, userId: line.user_id });
    await restoreFeedbackAsAdmin({ feedbackId, adminUserId });
    const [[restored]] = await db.query(
        'SELECT created_at, deleted_at, moderation_status FROM eshop_item_feedback WHERE feedback_id = ?',
        [feedbackId],
    );
    assert(new Date(restored.created_at).getTime() === new Date(feedbackRow.created_at).getTime(),
        'Admin restore must preserve created_at.');
    assert(restored.deleted_at === null && restored.moderation_status === 'pending',
        'Admin restore must clear deletion and reset moderation.');

    console.log('PASS: pending/deleted filtering, safe public fields, masked names, rating filter, and summary');
    console.log('PASS: admin filters, moderation transition, reply idempotency, and reply notification');
    console.log('PASS: admin restoration preserves created_at and resets moderation');
} finally {
    if (feedbackId) {
        await db.query('DELETE FROM customer_notifications WHERE event_key LIKE ?', [`product_feedback_reply:${feedbackId}:%`]);
        await db.query(
            `DELETE FROM audit_logs WHERE entity_type = 'ESHOP_ITEM_FEEDBACK' AND entity_id = ?`,
            [feedbackId],
        );
        await db.query('DELETE FROM eshop_item_feedback WHERE feedback_id = ?', [feedbackId]);
    }
    await db.end();
}
