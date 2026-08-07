import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canCreatePaymentForBooking,
  getFailedBookingPaymentState,
  getInitialBookingPaymentState,
  getPaidBookingPaymentState,
  invoiceBelongsToBooking,
  isPlaceholderInvoiceId,
} from '../services/bookingPaymentLifecycle.js';
import {
  computeEntranceFee,
  computeEntranceFeeForBookingItems,
} from '../services/entranceFeeService.js';
import { calculateExtraPersonFee } from '../services/extraPersonFeeService.js';
import { isGatewayInvoiceReference } from '../services/paymentRecordService.js';

const weekdayRates = [
  { name: 'Adult', day_type: 'weekday', status: 'active', price: 333, age_min: 13, age_max: 59 },
  { name: 'Child', day_type: 'weekday', status: 'active', price: 150, age_min: 2, age_max: 12 },
  { name: 'Senior', day_type: 'weekday', status: 'active', price: 250, age_min: 60, age_max: 120 },
];

test('online bookings start pending and can reuse the booking for payment', () => {
  const state = getInitialBookingPaymentState('GCASH');
  assert.deepEqual(state, {
    bookingStatus: 'Pending',
    paymentStatus: 'Pending',
  });
  assert.equal(canCreatePaymentForBooking({
    booking_status: state.bookingStatus,
    payment_status: state.paymentStatus,
  }), true);
});

test('verified payment marks the booking paid but keeps approval pending', () => {
  assert.deepEqual(getPaidBookingPaymentState(), {
    bookingStatus: 'Pending',
    paymentStatus: 'Paid',
  });
  assert.equal(canCreatePaymentForBooking({
    booking_status: 'Pending',
    payment_status: 'Paid',
  }), false);
});

test('expired and failed payments release inventory', () => {
  assert.deepEqual(getFailedBookingPaymentState('EXPIRED'), {
    bookingStatus: 'Expired',
    paymentStatus: 'Expired',
    releaseInventory: true,
  });
  assert.deepEqual(getFailedBookingPaymentState('FAILED'), {
    bookingStatus: 'Cancelled',
    paymentStatus: 'Failed',
    releaseInventory: true,
  });
});

test('three adults at 333 are charged exactly 999 once', async () => {
  const result = await computeEntranceFee({
    adults: 3,
    children: 0,
    seniors: 0,
    date: '2026-07-24',
    rates: weekdayRates,
  });

  assert.equal(result.success, true);
  assert.equal(result.total, 999);
  assert.equal(result.breakdown.adults.subtotal, 999);
});

test('entrance fees use category rates and exclude infants and events', async () => {
  const connection = {
    query: async () => [weekdayRates],
  };
  const result = await computeEntranceFeeForBookingItems({
    defaultDate: '2026-07-24',
    connection,
    items: [
      { booking_type: 'room', adults: 2, children: 2, seniors: 1, infants: 1 },
      { booking_type: 'event', adults: 10, children: 0, seniors: 0, infants: 0 },
    ],
  });

  assert.equal(result.success, true);
  assert.equal(result.total, (2 * 333) + (2 * 150) + 250);
  assert.equal(result.breakdown.adults.count, 2);
  assert.equal(result.breakdown.children.count, 2);
  assert.equal(result.breakdown.seniors.count, 1);
});

test('extra-person fee is calculated once from capacity and guest categories', () => {
  const result = calculateExtraPersonFee({
    adults: 3,
    children: 1,
    seniors: 0,
    infants: 0,
    capacity: 2,
  });

  assert.equal(result.extraPersonCount, 2);
  assert.equal(result.breakdown.children.subtotal, 500);
  assert.equal(result.breakdown.adults.subtotal, 1000);
  assert.equal(result.total, 1500);
});

test('QR payment request IDs are never sent to the legacy invoice API', () => {
  assert.equal(
    isGatewayInvoiceReference('pr-90392f42-d98a-49ef-a7f3-abcezas123'),
    false,
  );
  assert.equal(isGatewayInvoiceReference('67f1234567890abcdef12345'), true);
});

test('invoice external IDs map back to booking IDs', () => {
  assert.equal(isPlaceholderInvoiceId('{INVOICE_ID}'), true);
  assert.equal(isPlaceholderInvoiceId('67f1234567890abcdef12345'), false);
  assert.equal(invoiceBelongsToBooking('BOOKING-241-1739123456789', 241), true);
  assert.equal(invoiceBelongsToBooking('BOOKING-241-1739123456789', 242), false);
  assert.equal(invoiceBelongsToBooking('241', 241), true);
});

