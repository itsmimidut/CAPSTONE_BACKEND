import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBookingId,
  validateCreateFeedback,
  validateFeedbackId,
  validateAdminFeedbackQuery,
  validateAdminReply,
  validateModeration,
  validatePublicFeedbackQuery,
  validateUpdateFeedback,
} from '../validators/feedbackValidator.js';

const runMiddleware = (middleware, req) => {
  let nextCalled = false;
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  middleware(req, response, () => {
    nextCalled = true;
  });
  return { response, nextCalled };
};

const validCreateBody = () => ({
  bookingId: 12,
  overallRating: 5,
  title: 'Great stay',
  comment: 'The service was excellent.',
  isAnonymous: false,
});

test('create validator accepts and trims a valid payload', () => {
  const req = {
    body: { ...validCreateBody(), title: '  Great stay  ', comment: '  Excellent service!  ' },
  };
  const result = runMiddleware(validateCreateFeedback, req);
  assert.equal(result.nextCalled, true);
  assert.deepEqual(req.validatedFeedback, {
    bookingId: 12,
    overallRating: 5,
    title: 'Great stay',
    comment: 'Excellent service!',
    isAnonymous: false,
  });
});

test('create validator rejects unknown fields', () => {
  const req = { body: { ...validCreateBody(), moderationStatus: 'approved' } };
  const { response, nextCalled } = runMiddleware(validateCreateFeedback, req);
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 400);
  assert.equal(response.body.code, 'VALIDATION_ERROR');
  assert.match(response.body.errors[0].message, /not allowed/i);
});

test('update validator rejects bookingId to prevent reassignment', () => {
  const req = {
    params: { feedbackId: '9' },
    body: { ...validCreateBody() },
  };
  const { response, nextCalled } = runMiddleware(validateUpdateFeedback, req);
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 400);
  assert.ok(response.body.errors.some((error) => error.field === 'bookingId'));
});

test('rating must be an integer from one through five', () => {
  for (const overallRating of [0, 6, 3.5, 'bad']) {
    const req = { body: { ...validCreateBody(), overallRating } };
    const { response } = runMiddleware(validateCreateFeedback, req);
    assert.equal(response.statusCode, 400);
    assert.ok(response.body.errors.some((error) => error.field === 'overallRating'));
  }
});

test('comment length is enforced after trimming', () => {
  for (const comment of [' short ', 'x'.repeat(2001)]) {
    const req = { body: { ...validCreateBody(), comment } };
    const { response } = runMiddleware(validateCreateFeedback, req);
    assert.equal(response.statusCode, 400);
    assert.ok(response.body.errors.some((error) => error.field === 'comment'));
  }
});

test('title length and boolean type are validated', () => {
  const req = {
    body: {
      ...validCreateBody(),
      title: 'x'.repeat(151),
      isAnonymous: 1,
    },
  };
  const { response } = runMiddleware(validateCreateFeedback, req);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(
    new Set(response.body.errors.map((error) => error.field)),
    new Set(['title', 'isAnonymous']),
  );
});

test('identifier validators accept only positive integers', () => {
  const validBookingReq = { params: { bookingId: '42' } };
  assert.equal(runMiddleware(validateBookingId, validBookingReq).nextCalled, true);
  assert.equal(validBookingReq.validatedBookingId, 42);

  const invalidFeedbackReq = { params: { feedbackId: '0' } };
  const { response, nextCalled } = runMiddleware(validateFeedbackId, invalidFeedbackReq);
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 400);
});

test('public query validator applies safe defaults and accepts supported filters', () => {
  const req = { query: { page: '2', limit: '25', rating: '5', sort: 'highest' } };
  const result = runMiddleware(validatePublicFeedbackQuery, req);
  assert.equal(result.nextCalled, true);
  assert.deepEqual(req.validatedFeedbackQuery, {
    page: 2,
    limit: 25,
    rating: 5,
    sort: 'highest',
  });
});

test('public query validator rejects invalid limits, ratings, and sorts', () => {
  const req = { query: { limit: '51', rating: '0', sort: 'DROP TABLE' } };
  const { response, nextCalled } = runMiddleware(validatePublicFeedbackQuery, req);
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(
    new Set(response.body.errors.map((error) => error.field)),
    new Set(['limit', 'rating', 'sort']),
  );
});

test('admin query validator checks status and date range', () => {
  const req = {
    query: { status: 'deleted', dateFrom: '2026-07-28', dateTo: '2026-07-27' },
  };
  const { response } = runMiddleware(validateAdminFeedbackQuery, req);
  assert.equal(response.statusCode, 400);
  assert.ok(response.body.errors.some((error) => error.field === 'dateTo'));
});

test('rejected moderation requires a reason', () => {
  const req = { params: { feedbackId: '4' }, body: { status: 'rejected' } };
  const { response, nextCalled } = runMiddleware(validateModeration, req);
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 400);
  assert.ok(response.body.errors.some((error) => error.field === 'reason'));
});

test('valid moderation payload is normalized', () => {
  const req = {
    params: { feedbackId: '4' },
    body: { status: 'REJECTED', reason: '  Contains contact details.  ' },
  };
  const result = runMiddleware(validateModeration, req);
  assert.equal(result.nextCalled, true);
  assert.deepEqual(req.validatedModeration, {
    feedbackId: 4,
    status: 'rejected',
    reason: 'Contains contact details.',
  });
});

test('admin reply is trimmed and length constrained', () => {
  const validReq = { params: { feedbackId: '4' }, body: { reply: '  Thank you.  ' } };
  assert.equal(runMiddleware(validateAdminReply, validReq).nextCalled, true);
  assert.equal(validReq.validatedAdminReply.reply, 'Thank you.');

  const invalidReq = { params: { feedbackId: '4' }, body: { reply: ' ' } };
  assert.equal(runMiddleware(validateAdminReply, invalidReq).response.statusCode, 400);
});
