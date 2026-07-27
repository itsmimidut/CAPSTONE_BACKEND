-- Phase 6: Persist backend-calculated pricing on bookings / booking_items
ALTER TABLE booking_items
  ADD COLUMN IF NOT EXISTS base_price DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seasonal_price DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seasonal_adjustment DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promo_discount DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_subtotal DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pricing_notes JSON NULL;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS pricing_total DECIMAL(10,2) DEFAULT 0;
