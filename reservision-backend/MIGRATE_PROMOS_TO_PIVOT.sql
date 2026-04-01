-- ============================================================
-- MIGRATE_PROMOS_TO_PIVOT.sql
-- Adds canonical promo columns and a promo_items pivot table.
-- Backfills old promos.item_ids JSON arrays into promo_items.
-- ============================================================

ALTER TABLE promos
  ADD COLUMN IF NOT EXISTS name VARCHAR(120) NULL AFTER promo_id,
  ADD COLUMN IF NOT EXISTS description LONGTEXT NULL AFTER code,
  ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20) NULL AFTER description,
  ADD COLUMN IF NOT EXISTS discount_value DECIMAL(10, 2) NULL AFTER discount_type,
  ADD COLUMN IF NOT EXISTS applies_to_category VARCHAR(50) NOT NULL DEFAULT 'all' AFTER discount_value,
  ADD COLUMN IF NOT EXISTS min_subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER applies_to_category,
  ADD COLUMN IF NOT EXISTS start_date DATE NULL AFTER min_subtotal,
  ADD COLUMN IF NOT EXISTS end_date DATE NULL AFTER start_date,
  ADD COLUMN IF NOT EXISTS usage_limit INT NULL AFTER end_date,
  ADD COLUMN IF NOT EXISTS times_used INT NOT NULL DEFAULT 0 AFTER usage_limit,
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER times_used;

UPDATE promos
SET
  name = COALESCE(NULLIF(name, ''), code),
  description = COALESCE(description, ''),
  discount_type = COALESCE(NULLIF(discount_type, ''), NULLIF(type, ''), 'percent'),
  discount_value = COALESCE(discount_value, value, 0),
  applies_to_category = COALESCE(NULLIF(applies_to_category, ''), 'all'),
  min_subtotal = COALESCE(min_subtotal, 0),
  start_date = COALESCE(start_date, startDate),
  end_date = COALESCE(end_date, endDate),
  usage_limit = COALESCE(usage_limit, usageLimit),
  times_used = COALESCE(times_used, 0),
  is_active = COALESCE(is_active, 1)
WHERE 1 = 1;

CREATE TABLE IF NOT EXISTS promo_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  promo_id INT NOT NULL,
  inventory_item_id INT NOT NULL,
  UNIQUE KEY uq_promo_item (promo_id, inventory_item_id),
  INDEX idx_promo_items_item (inventory_item_id),
  CONSTRAINT fk_promo_items_promo FOREIGN KEY (promo_id) REFERENCES promos(promo_id) ON DELETE CASCADE,
  CONSTRAINT fk_promo_items_inventory FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(item_id) ON DELETE CASCADE
);

-- MariaDB-compatible JSON array expansion for legacy promos.item_ids
INSERT INTO promo_items (promo_id, inventory_item_id)
SELECT
  p.promo_id,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(p.item_ids, CONCAT('$[', seq.n, ']'))) AS UNSIGNED) AS inventory_item_id
FROM promos p
JOIN (
  SELECT ones.n + tens.n * 10 AS n
  FROM (
    SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
    UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
  ) AS ones
  CROSS JOIN (
    SELECT 0 AS n UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
    UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9
  ) AS tens
) AS seq
  ON seq.n < JSON_LENGTH(p.item_ids)
WHERE p.item_ids IS NOT NULL
  AND TRIM(p.item_ids) <> ''
  AND JSON_VALID(p.item_ids) = 1
  AND CAST(JSON_UNQUOTE(JSON_EXTRACT(p.item_ids, CONCAT('$[', seq.n, ']'))) AS UNSIGNED) > 0
ON DUPLICATE KEY UPDATE inventory_item_id = VALUES(inventory_item_id);

CREATE INDEX IF NOT EXISTS idx_promos_code_active ON promos (code, is_active);
CREATE INDEX IF NOT EXISTS idx_promos_date_window ON promos (start_date, end_date);

SELECT 'Promo pivot migration applied successfully.' AS status;