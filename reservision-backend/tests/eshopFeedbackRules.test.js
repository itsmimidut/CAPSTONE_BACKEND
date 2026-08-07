import assert from 'node:assert/strict';
import test from 'node:test';
import {
    ESHOP_FEEDBACK_CODE,
    getEshopFeedbackEditDeadline,
    getEshopFeedbackSubmissionDeadline,
    isWithinEshopFeedbackEditWindow,
    isWithinEshopFeedbackSubmissionWindow,
} from '../constants/eshopFeedbackRules.js';
import {
    evaluateEshopFeedbackEligibility,
    isReviewablePurchase,
} from '../services/eshopFeedbackService.js';

const fulfilledPurchase = {
    type: 'E-Shop',
    fulfillment_status: 'delivered',
    transaction_status: 'ACTIVE',
    voided_at: null,
    fulfilled_at: '2026-07-01T00:00:00.000Z',
};

test('only completed, non-voided E-Shop purchases are reviewable', () => {
    assert.equal(isReviewablePurchase(fulfilledPurchase), true);
    assert.equal(isReviewablePurchase({ ...fulfilledPurchase, type: 'Walk-in' }), false);
    assert.equal(isReviewablePurchase({ ...fulfilledPurchase, fulfillment_status: 'preparing' }), false);
    assert.equal(isReviewablePurchase({ ...fulfilledPurchase, voided_at: '2026-07-02' }), false);
    assert.equal(isReviewablePurchase({ ...fulfilledPurchase, fulfilled_at: null }), false);
});

test('submission window is exactly 30 days from fulfillment history', () => {
    const deadline = getEshopFeedbackSubmissionDeadline(fulfilledPurchase.fulfilled_at);
    assert.equal(deadline.toISOString(), '2026-07-31T00:00:00.000Z');
    assert.equal(isWithinEshopFeedbackSubmissionWindow(
        fulfilledPurchase.fulfilled_at,
        new Date('2026-07-31T00:00:00.000Z'),
    ), true);
    assert.equal(isWithinEshopFeedbackSubmissionWindow(
        fulfilledPurchase.fulfilled_at,
        new Date('2026-07-31T00:00:00.001Z'),
    ), false);
});

test('eligibility exposes stable codes for valid, expired, duplicate, and restorable feedback', () => {
    assert.equal(evaluateEshopFeedbackEligibility({
        purchase: fulfilledPurchase,
        now: new Date('2026-07-15T00:00:00Z'),
    }).code, ESHOP_FEEDBACK_CODE.ELIGIBLE);

    assert.equal(evaluateEshopFeedbackEligibility({
        purchase: fulfilledPurchase,
        now: new Date('2026-08-01T00:00:00Z'),
    }).code, ESHOP_FEEDBACK_CODE.SUBMISSION_WINDOW_EXPIRED);

    const feedback = {
        feedback_id: 1,
        moderation_status: 'pending',
        created_at: '2026-07-14T00:00:00Z',
        deleted_at: null,
    };
    assert.equal(evaluateEshopFeedbackEligibility({
        purchase: fulfilledPurchase,
        feedback,
        now: new Date('2026-07-15T00:00:00Z'),
    }).code, ESHOP_FEEDBACK_CODE.FEEDBACK_EDITABLE);
    assert.equal(evaluateEshopFeedbackEligibility({
        purchase: fulfilledPurchase,
        feedback: { ...feedback, deleted_at: '2026-07-15T00:00:00Z' },
        now: new Date('2026-07-15T00:00:00Z'),
    }).code, ESHOP_FEEDBACK_CODE.FEEDBACK_DELETED_RESTORABLE);
});

test('edit, delete, and restore share the original seven-day deadline', () => {
    const created = '2026-07-01T10:00:00Z';
    assert.equal(getEshopFeedbackEditDeadline(created).toISOString(), '2026-07-08T10:00:00.000Z');
    assert.equal(isWithinEshopFeedbackEditWindow(created, new Date('2026-07-08T10:00:00Z')), true);
    assert.equal(isWithinEshopFeedbackEditWindow(created, new Date('2026-07-08T10:00:00.001Z')), false);
});
