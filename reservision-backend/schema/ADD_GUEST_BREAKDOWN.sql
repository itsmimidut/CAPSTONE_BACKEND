-- ============================================================
-- UNIVERSAL GUEST BREAKDOWN SUPPORT
-- ============================================================
-- Adds per age-category guest counts to bookings + booking_items.
-- Only counts per category are stored (not per-person records).
--
-- guest_breakdown_type values: 'exact' | 'estimated' | 'not_provided'
-- ============================================================

-- Booking-level summary totals
ALTER TABLE bookings
  ADD COLUMN total_guests INT DEFAULT 0,
  ADD COLUMN seniors INT DEFAULT 0,
  ADD COLUMN infants INT DEFAULT 0,
  ADD COLUMN guest_breakdown_provided TINYINT(1) DEFAULT 0,
  ADD COLUMN guest_breakdown_type VARCHAR(32) NULL;

-- Per-item breakdown (source of truth for analytics)
ALTER TABLE booking_items
  ADD COLUMN total_guests INT DEFAULT 0,
  ADD COLUMN adults INT DEFAULT 0,
  ADD COLUMN children INT DEFAULT 0,
  ADD COLUMN seniors INT DEFAULT 0,
  ADD COLUMN infants INT DEFAULT 0,
  ADD COLUMN guest_breakdown_provided TINYINT(1) DEFAULT 0,
  ADD COLUMN guest_breakdown_type VARCHAR(32) NULL;

-- Helpful index for age-category analytics queries
CREATE INDEX idx_booking_items_breakdown
  ON booking_items (guest_breakdown_provided, item_type);
