-- Phase 6 Pricing — Test Data Seed
-- Run in phpMyAdmin on database: eduardos
-- Safe to re-run (idempotent cleanup + re-insert for test rules)

-- ---------------------------------------------------------------------------
-- 1) Normalize rate_type by category
-- ---------------------------------------------------------------------------
UPDATE inventory_items
SET rate_type = NULL
WHERE category_type = 'room';

UPDATE inventory_items
SET rate_type = 'per_day'
WHERE category_type = 'cottage';

UPDATE inventory_items
SET rate_type = 'per_event'
WHERE category_type = 'event'
  AND (rate_type IS NULL OR rate_type = '');

-- ---------------------------------------------------------------------------
-- 2) Set predictable test prices on EXISTING items
--    (Use these IDs in Postman — do NOT use item 12 for event tests)
-- ---------------------------------------------------------------------------
-- Room test item: Studio Room 1 — ₱2,000/night
UPDATE inventory_items
SET price = 2000.00,
    rate_type = NULL,
    status = 'Available'
WHERE item_id = 2;

-- Cottage test item: COTTAGE — ₱1,500/day
UPDATE inventory_items
SET price = 1500.00,
    rate_type = 'per_day',
    status = 'Available'
WHERE item_id = 8;

-- Event test item: Functional Hall — default mode = per_event ₱3,000
UPDATE inventory_items
SET price = 3000.00,
    rate_type = 'per_event',
    status = 'Available'
WHERE item_id = 16;

-- ---------------------------------------------------------------------------
-- 3) Seasonal rule for event areas (July 2026, +20%)
-- ---------------------------------------------------------------------------
DELETE FROM seasonal_pricing
WHERE season_name = 'PHASE6 Peak Season';

INSERT INTO seasonal_pricing (
  season_name,
  category_type,
  inventory_item_id,
  start_date,
  end_date,
  pricing_type,
  value,
  status,
  priority
) VALUES (
  'PHASE6 Peak Season',
  'event',
  NULL,
  '2026-07-01',
  '2026-07-31',
  'percentage_increase',
  20.00,
  'Active',
  10
);

-- ---------------------------------------------------------------------------
-- 4) Promo for Functional Hall / event areas (10% off, July 2026)
-- ---------------------------------------------------------------------------
DELETE pi FROM promo_items pi
INNER JOIN promos p ON p.promo_id = pi.promo_id
WHERE p.code IN ('PHASE6EVT10', 'PHASE6EXPIRED');

DELETE FROM promos
WHERE code IN ('PHASE6EVT10', 'PHASE6EXPIRED');

INSERT INTO promos (
  name,
  code,
  type,
  value,
  description,
  discount_type,
  discount_value,
  startDate,
  endDate,
  start_date,
  end_date,
  usageLimit,
  usage_limit,
  min_subtotal,
  applies_to_category,
  item_ids,
  is_active
) VALUES (
  'PHASE6 Event 10% Off',
  'PHASE6EVT10',
  'percent',
  10.00,
  'Phase 6 test promo for event areas',
  'percent',
  10.00,
  '2026-07-01',
  '2026-07-31',
  '2026-07-01',
  '2026-07-31',
  999,
  999,
  0.00,
  'events',
  '["16"]',
  1
);

SET @phase6_promo_id = LAST_INSERT_ID();

INSERT INTO promo_items (promo_id, inventory_item_id)
VALUES (@phase6_promo_id, 16);

-- Expired promo (for negative test)
INSERT INTO promos (
  name,
  code,
  type,
  value,
  description,
  discount_type,
  discount_value,
  startDate,
  endDate,
  start_date,
  end_date,
  usageLimit,
  usage_limit,
  min_subtotal,
  applies_to_category,
  item_ids,
  is_active
) VALUES (
  'PHASE6 Expired Promo',
  'PHASE6EXPIRED',
  'percent',
  10.00,
  'Expired promo for Phase 6 negative test',
  'percent',
  10.00,
  '2026-01-01',
  '2026-01-31',
  '2026-01-01',
  '2026-01-31',
  999,
  999,
  0.00,
  'events',
  '["16"]',
  1
);

SET @phase6_expired_promo_id = LAST_INSERT_ID();

INSERT INTO promo_items (promo_id, inventory_item_id)
VALUES (@phase6_expired_promo_id, 16);

-- ---------------------------------------------------------------------------
-- 5) Quick verify
-- ---------------------------------------------------------------------------
SELECT item_id, name, category_type, price, rate_type, status
FROM inventory_items
WHERE item_id IN (2, 8, 12, 16)
ORDER BY item_id;

SELECT id, season_name, category_type, pricing_type, value, start_date, end_date, status
FROM seasonal_pricing
WHERE season_name = 'PHASE6 Peak Season';

SELECT promo_id, name, code, discount_type, discount_value, applies_to_category, start_date, end_date, is_active
FROM promos
WHERE code IN ('PHASE6EVT10', 'PHASE6EXPIRED');

SELECT pi.promo_id, p.code, pi.inventory_item_id
FROM promo_items pi
INNER JOIN promos p ON p.promo_id = pi.promo_id
WHERE p.code IN ('PHASE6EVT10', 'PHASE6EXPIRED');
