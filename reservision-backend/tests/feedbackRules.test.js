import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEEDBACK_EDIT_WINDOW_DAYS,
  getFeedbackEditDeadline,
  isFeedbackEligibleBooking,
  isWithinFeedbackEditWindow,
  normalizeBookingStatus,
  canTransitionFeedbackStatus,
} from '../constants/feedbackRules.js';

test('normalizes booking status aliases', () => {
  assert.equal(normalizeBookingStatus(' Checked-Out '), 'checked_out');
  assert.equal(normalizeBookingStatus('CHECKED OUT'), 'checked_out');
  assert.equal(normalizeBookingStatus('completed'), 'completed');
});

test('only approved moderation transitions are allowed', () => {
  for (const [from, to] of [
    ['pending', 'approved'],
    ['pending', 'rejected'],
    ['approved', 'hidden'],
    ['rejected', 'pending'],
    ['hidden', 'approved'],
  ]) {
    assert.equal(canTransitionFeedbackStatus(from, to), true);
  }
  for (const [from, to] of [
    ['approved', 'rejected'],
    ['hidden', 'rejected'],
    ['rejected', 'approved'],
    ['pending', 'hidden'],
    ['pending', 'pending'],
  ]) {
    assert.equal(canTransitionFeedbackStatus(from, to), false);
  }
});

test('completed bookings are eligible without checkout timestamp', () => {
  assert.equal(isFeedbackEligibleBooking({ booking_status: 'completed' }), true);
});

test('checked-out bookings require actual checkout timestamp', () => {
  assert.equal(isFeedbackEligibleBooking({ booking_status: 'checked_out' }), false);
  assert.equal(
    isFeedbackEligibleBooking({
      booking_status: 'checked-out',
      actual_check_out_time: '2026-07-27T04:00:00.000Z',
    }),
    true,
  );
});

test('unfinished bookings are not eligible', () => {
  for (const status of ['pending', 'confirmed', 'checked_in', 'cancelled', null]) {
    assert.equal(isFeedbackEligibleBooking({ booking_status: status }), false);
  }
});

test('feedback deadline is exactly seven days after creation', () => {
  const createdAt = '2026-07-20T08:30:00.000Z';
  assert.equal(FEEDBACK_EDIT_WINDOW_DAYS, 7);
  assert.equal(getFeedbackEditDeadline(createdAt).toISOString(), '2026-07-27T08:30:00.000Z');
});

test('edit window includes its deadline and expires immediately after it', () => {
  const createdAt = '2026-07-20T08:30:00.000Z';
  assert.equal(isWithinFeedbackEditWindow(createdAt, new Date('2026-07-27T08:30:00.000Z')), true);
  assert.equal(isWithinFeedbackEditWindow(createdAt, new Date('2026-07-27T08:30:00.001Z')), false);
  assert.equal(isWithinFeedbackEditWindow('invalid-date'), false);
});
