-- Phase 2 predictive analytics dataset.
-- This table is intentionally separate from bookings_daily and bookings_forecast.
-- It stores validated daily arrival demand only; model training is handled later.

CREATE TABLE IF NOT EXISTS booking_demand_daily (
  demand_date DATE NOT NULL,
  bookings INT UNSIGNED NOT NULL DEFAULT 0,
  guests INT UNSIGNED NOT NULL DEFAULT 0,
  adults INT UNSIGNED NOT NULL DEFAULT 0,
  children INT UNSIGNED NOT NULL DEFAULT 0,
  seniors INT UNSIGNED NOT NULL DEFAULT 0,
  infants INT UNSIGNED NOT NULL DEFAULT 0,
  unknown_guests INT UNSIGNED NOT NULL DEFAULT 0,
  known_guests INT UNSIGNED NOT NULL DEFAULT 0,
  guest_mix_coverage_pct DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  actual_arrival_bookings INT UNSIGNED NOT NULL DEFAULT 0,
  confirmed_fallback_bookings INT UNSIGNED NOT NULL DEFAULT 0,
  generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (demand_date),
  CONSTRAINT chk_booking_demand_guest_total
    CHECK (
      adults + children + seniors + infants + unknown_guests = guests
    ),
  CONSTRAINT chk_booking_demand_known_total
    CHECK (
      adults + children + seniors + infants = known_guests
    ),
  CONSTRAINT chk_booking_demand_coverage
    CHECK (
      guest_mix_coverage_pct >= 0 AND guest_mix_coverage_pct <= 100
    )
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
