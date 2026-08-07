import test from 'node:test';
import assert from 'node:assert/strict';
import { getPublicFeedbackSummary } from '../services/feedbackService.js';
import { createCustomerNotification } from '../services/customerNotificationService.js';

test('public feedback summary maps database values and is independent of pagination', async () => {
  const executor = {
    async query(sql) {
      assert.match(sql, /moderation_status = 'approved'/);
      assert.match(sql, /deleted_at IS NULL/);
      assert.doesNotMatch(sql, /LIMIT|OFFSET/);
      return [[{
        average_rating: '4.62',
        total_reviews: 128,
        five_star: 84,
        four_star: 29,
        three_star: 9,
        two_star: 4,
        one_star: 2,
      }]];
    },
  };

  assert.deepEqual(await getPublicFeedbackSummary(executor), {
    averageRating: 4.62,
    totalReviews: 128,
    ratingDistribution: { 5: 84, 4: 29, 3: 9, 2: 4, 1: 2 },
  });
});

test('empty public feedback summary returns zero values', async () => {
  const executor = { async query() { return [[{}]]; } };
  assert.deepEqual(await getPublicFeedbackSummary(executor), {
    averageRating: 0,
    totalReviews: 0,
    ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
  });
});

test('customer notification helper uses event key and supplied transaction', async () => {
  const calls = [];
  const connection = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (/^\s*INSERT/.test(sql)) return [{ insertId: 91 }];
      return [[{
        id: 91,
        user_id: 2,
        customer_id: 3,
        title: 'Title',
        message: 'Message',
        type: 'feedback_reply',
        link: '/customer/feedback',
        is_read: 0,
        created_at: new Date(),
      }]];
    },
  };
  const id = await createCustomerNotification({
    userId: 2,
    customerId: 3,
    title: 'Title',
    message: 'Message',
    type: 'feedback_reply',
    link: '/customer/feedback',
    eventKey: 'feedback_reply:8:1',
    connection,
  });
  assert.equal(id, 91);
  assert.equal(calls.length, 2);
  assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE/);
  assert.equal(calls[0].values[5], 'feedback_reply:8:1');
});

test('duplicate notification event keys are treated as successful no-ops', async () => {
  const connection = {
    async query() {
      return [{ insertId: 0, affectedRows: 0 }];
    },
  };
  const id = await createCustomerNotification({
    userId: 2,
    customerId: 3,
    title: 'Title',
    message: 'Message',
    eventKey: 'feedback_invitation:booking:22',
    connection,
  });
  assert.equal(id, null);
});
