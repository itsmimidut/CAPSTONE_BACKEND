import db from '../config/db.js';
import {
    createFeedback,
    deleteFeedback,
    getEligibility,
    restoreFeedback,
    updateFeedback,
} from '../services/eshopFeedbackService.js';

let feedbackId = null;

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

try {
    const [candidates] = await db.query(
        `SELECT pti.line_id, c.user_id
         FROM pos_transaction_items pti
         JOIN pos_transactions pt ON pt.id = pti.transaction_id
         JOIN customers c ON c.customer_id = pt.customer_id
         LEFT JOIN eshop_item_feedback f ON f.transaction_item_id = pti.line_id
         WHERE LOWER(TRIM(pt.type)) = 'e-shop'
           AND LOWER(TRIM(pt.fulfillment_status)) IN ('delivered', 'picked_up')
           AND pt.voided_at IS NULL
           AND f.feedback_id IS NULL
           AND EXISTS (
               SELECT 1 FROM pos_fulfillment_history pfh
               WHERE pfh.transaction_id = pt.id
                 AND LOWER(TRIM(pfh.to_status)) IN ('delivered', 'picked_up')
           )
         ORDER BY pt.id DESC, pti.line_number
         LIMIT 1`,
    );
    assert(candidates.length === 1, 'A fulfilled E-Shop line without feedback is required for verification.');
    const candidate = candidates[0];

    const eligibility = await getEligibility({
        transactionItemId: candidate.line_id,
        userId: candidate.user_id,
    });
    assert(eligibility.code === 'ELIGIBLE', `Expected ELIGIBLE, received ${eligibility.code}.`);
    const [otherCustomers] = await db.query(
        'SELECT user_id FROM customers WHERE user_id IS NOT NULL AND user_id <> ? LIMIT 1',
        [candidate.user_id],
    );
    if (otherCustomers.length) {
        const ownershipAttempt = await getEligibility({
            transactionItemId: candidate.line_id,
            userId: otherCustomers[0].user_id,
        }).then(() => null, (error) => error);
        assert(ownershipAttempt?.status === 403 && ownershipAttempt?.code === 'NOT_OWNER',
            'A different customer must receive NOT_OWNER.');
    }

    const input = {
        transactionItemId: candidate.line_id,
        overallRating: 5,
        title: 'Phase C verification',
        comment: 'Temporary feedback used by the automated Phase C verification.',
        isAnonymous: false,
    };
    const attempts = await Promise.allSettled([
        createFeedback({ userId: candidate.user_id, input }),
        createFeedback({ userId: candidate.user_id, input }),
    ]);
    const created = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
    assert(created.length === 1, `Concurrency check expected one successful create, received ${created.length}.`);
    assert(rejected.length === 1 && rejected[0].reason?.code === 'FEEDBACK_EXISTS',
        'Concurrent duplicate must fail with FEEDBACK_EXISTS.');
    feedbackId = created[0].value.feedbackId;

    const [[before]] = await db.query(
        'SELECT created_at FROM eshop_item_feedback WHERE feedback_id = ?',
        [feedbackId],
    );
    await updateFeedback({
        feedbackId,
        userId: candidate.user_id,
        input: { ...input, overallRating: 4, title: 'Updated verification' },
    });
    await deleteFeedback({ feedbackId, userId: candidate.user_id });
    const [[deleted]] = await db.query(
        'SELECT deleted_at FROM eshop_item_feedback WHERE feedback_id = ?',
        [feedbackId],
    );
    assert(Boolean(deleted.deleted_at), 'Delete must set deleted_at.');

    await restoreFeedback({ feedbackId, userId: candidate.user_id });
    const [[after]] = await db.query(
        `SELECT created_at, deleted_at, deleted_by, moderation_status
         FROM eshop_item_feedback WHERE feedback_id = ?`,
        [feedbackId],
    );
    assert(new Date(before.created_at).getTime() === new Date(after.created_at).getTime(),
        'Update/delete/restore must preserve created_at.');
    assert(after.deleted_at === null && after.deleted_by === null, 'Restore must clear deletion fields.');
    assert(after.moderation_status === 'pending', 'Restore must reset moderation to pending.');

    const [auditRows] = await db.query(
        `SELECT action FROM audit_logs
         WHERE entity_type = 'ESHOP_ITEM_FEEDBACK' AND entity_id = ?`,
        [feedbackId],
    );
    for (const action of [
        'ESHOP_FEEDBACK_CREATED',
        'ESHOP_FEEDBACK_UPDATED',
        'ESHOP_FEEDBACK_DELETED',
        'ESHOP_FEEDBACK_RESTORED',
    ]) {
        assert(auditRows.some((row) => row.action === action), `Missing audit event ${action}.`);
    }

    console.log('PASS: live eligibility uses terminal fulfillment history');
    console.log('PASS: customer ownership is derived server-side');
    console.log('PASS: concurrent creation allows exactly one review per purchased line');
    console.log('PASS: update, soft delete, and restore preserve the original created_at');
    console.log('PASS: all four E-Shop feedback audit events were recorded');
} finally {
    if (feedbackId) {
        await db.query(
            `DELETE FROM audit_logs
             WHERE entity_type = 'ESHOP_ITEM_FEEDBACK' AND entity_id = ?`,
            [feedbackId],
        );
        await db.query('DELETE FROM eshop_item_feedback WHERE feedback_id = ?', [feedbackId]);
    }
    await db.end();
}
