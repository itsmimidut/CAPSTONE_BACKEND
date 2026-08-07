import assert from 'node:assert/strict';
import test from 'node:test';
import { sendEshopFeedbackError } from '../controllers/eshopFeedbackController.js';
import { EshopFeedbackServiceError } from '../services/eshopFeedbackService.js';

const response = () => {
    const result = { statusCode: null, body: null };
    return {
        result,
        res: {
            status(code) {
                result.statusCode = code;
                return this;
            },
            json(body) {
                result.body = body;
                return this;
            },
        },
    };
};

for (const status of [403, 404, 409, 422]) {
    test(`service errors retain API status ${status} and stable code`, () => {
        const { res, result } = response();
        sendEshopFeedbackError(res, new EshopFeedbackServiceError(status, `CODE_${status}`, 'Expected'));
        assert.equal(result.statusCode, status);
        assert.equal(result.body.success, false);
        assert.equal(result.body.code, `CODE_${status}`);
    });
}
