-- Payment-aware reservation lifecycle.
-- Run once before deploying the payment retry/expiry changes.

ALTER TABLE bookings
  ADD COLUMN checkout_token VARCHAR(64) NULL AFTER booking_reference,
  ADD UNIQUE KEY uq_bookings_checkout_token (checkout_token),
  MODIFY COLUMN booking_status ENUM(
    'Pending',
    'Confirmed',
    'Approved',
    'Paid',
    'Checked-In',
    'Checked-in',
    'Checked-Out',
    'Cancelled',
    'Canceled',
    'Rejected',
    'Expired',
    'Completed',
    'Voided',
    'Refunded',
    'Partially Refunded'
  ) NOT NULL DEFAULT 'Pending',
  MODIFY COLUMN payment_status ENUM(
    'Unpaid',
    'Pending',
    'Partially Paid',
    'Paid',
    'Failed',
    'Expired',
    'Refunded',
    'Partially Refunded'
  ) NOT NULL DEFAULT 'Unpaid';

