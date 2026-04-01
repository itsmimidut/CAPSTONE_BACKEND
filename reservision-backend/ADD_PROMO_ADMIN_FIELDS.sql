-- ============================================================
-- ADD_PROMO_ADMIN_FIELDS.sql
-- Run this migration once to support the new admin promo modal.
-- ============================================================

ALTER TABLE promos
  ADD COLUMN IF NOT EXISTS name VARCHAR(120) NULL AFTER promo_id,
  ADD COLUMN IF NOT EXISTS min_subtotal DECIMAL(10, 2) NOT NULL DEFAULT 0 AFTER usageLimit,
  ADD COLUMN IF NOT EXISTS applies_to_category VARCHAR(50) NOT NULL DEFAULT 'all' AFTER min_subtotal,
  ADD COLUMN IF NOT EXISTS item_ids LONGTEXT NULL AFTER applies_to_category,
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER item_ids;

CREATE INDEX IF NOT EXISTS idx_promo_active ON promos (is_active);

UPDATE promos
SET name = COALESCE(NULLIF(name, ''), code),
    applies_to_category = COALESCE(NULLIF(applies_to_category, ''), 'all'),
    is_active = COALESCE(is_active, 1)
WHERE 1 = 1;

SELECT 'PROMO_ADMIN_FIELDS migration applied successfully.' AS status;