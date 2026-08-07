import assert from 'node:assert/strict';
import test from 'node:test';
import {
    validateCreateEshopFeedback,
    validateEshopFeedbackId,
    validateUpdateEshopFeedback,
} from '../validators/eshopFeedbackValidator.js';

const run = (middleware, { body = {}, params = {} } = {}) => {
    const req = { body, params };
    const response = { statusCode: 200, payload: null };
    const res = {
        status(code) {
            response.statusCode = code;
            return this;
        },
        json(payload) {
            response.payload = payload;
            return this;
        },
    };
    let nextCalled = false;
    middleware(req, res, () => { nextCalled = true; });
    return { req, response, nextCalled };
};

test('accepts and trims a valid create payload', () => {
    const result = run(validateCreateEshopFeedback, {
        body: {
            transactionItemId: 10,
            overallRating: 5,
            title: ' Great ',
            comment: ' Very good product. ',
            isAnonymous: true,
        },
    });
    assert.equal(result.nextCalled, true);
    assert.equal(result.req.validatedEshopFeedback.title, 'Great');
    assert.equal(result.req.validatedEshopFeedback.comment, 'Very good product.');
});

test('rejects invalid rating, missing comment, and non-boolean anonymous flag with 422', () => {
    const result = run(validateCreateEshopFeedback, {
        body: { transactionItemId: 10, overallRating: 6, comment: '', isAnonymous: 1 },
    });
    assert.equal(result.response.statusCode, 422);
    assert.equal(result.response.payload.code, 'VALIDATION_ERROR');
    assert.deepEqual(
        result.response.payload.errors.map((error) => error.field),
        ['overallRating', 'comment', 'isAnonymous'],
    );
});

test('rejects ownership, moderation, reply, and timestamp fields', () => {
    const result = run(validateCreateEshopFeedback, {
        body: {
            transactionItemId: 10,
            overallRating: 4,
            comment: 'A legitimate comment',
            customerId: 99,
            moderationStatus: 'approved',
            adminReply: 'hidden',
            createdAt: '2026-01-01',
            replyVersion: 2,
            deletedAt: null,
        },
    });
    assert.equal(result.response.statusCode, 422);
    const rejected = result.response.payload.errors.map((error) => error.field);
    for (const field of ['customerId', 'moderationStatus', 'adminReply', 'createdAt', 'replyVersion', 'deletedAt']) {
        assert.ok(rejected.includes(field));
    }
});

test('update cannot reassign transaction item and validates feedback id', () => {
    const result = run(validateUpdateEshopFeedback, {
        params: { feedbackId: '7' },
        body: {
            overallRating: 4,
            comment: 'A legitimate update',
            transactionItemId: 99,
        },
    });
    assert.equal(result.response.statusCode, 422);
    assert.equal(result.response.payload.errors[0].field, 'transactionItemId');

    const invalidId = run(validateEshopFeedbackId, { params: { feedbackId: 'zero' } });
    assert.equal(invalidId.response.statusCode, 422);
});
