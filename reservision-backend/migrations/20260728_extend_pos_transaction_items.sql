-- Phase B: extend the existing POS line table without removing legacy columns.
-- MariaDB 10.4 compatible and safe to rerun.

ALTER TABLE pos_transaction_items
    ADD COLUMN IF NOT EXISTS line_number INT UNSIGNED NULL AFTER transaction_id,
    ADD COLUMN IF NOT EXISTS product_name_snapshot VARCHAR(255) NULL AFTER item_name,
    ADD COLUMN IF NOT EXISTS unit_price_snapshot DECIMAL(10,2) NULL AFTER unit_price,
    ADD COLUMN IF NOT EXISTS modifiers_snapshot JSON NULL AFTER unit_price_snapshot,
    ADD COLUMN IF NOT EXISTS line_total_snapshot DECIMAL(10,2) NULL AFTER line_total,
    ADD COLUMN IF NOT EXISTS image_url_snapshot VARCHAR(1024) NULL AFTER modifiers_snapshot,
    ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL
        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

UPDATE pos_transaction_items
SET product_name_snapshot = item_name
WHERE product_name_snapshot IS NULL;

UPDATE pos_transaction_items
SET unit_price_snapshot = unit_price
WHERE unit_price_snapshot IS NULL;

UPDATE pos_transaction_items
SET line_total_snapshot = line_total
WHERE line_total_snapshot IS NULL;

DROP TEMPORARY TABLE IF EXISTS tmp_pos_item_line_numbers;
CREATE TEMPORARY TABLE tmp_pos_item_line_numbers AS
SELECT
    line_id,
    ROW_NUMBER() OVER (
        PARTITION BY transaction_id
        ORDER BY line_id
    ) AS line_number
FROM pos_transaction_items;

UPDATE pos_transaction_items pti
JOIN tmp_pos_item_line_numbers tmp ON tmp.line_id = pti.line_id
SET pti.line_number = tmp.line_number
WHERE pti.line_number IS NULL;

DROP TEMPORARY TABLE IF EXISTS tmp_pos_item_line_numbers;

ALTER TABLE pos_transaction_items
    MODIFY line_number INT UNSIGNED NOT NULL,
    MODIFY product_name_snapshot VARCHAR(255) NOT NULL,
    MODIFY unit_price_snapshot DECIMAL(10,2) NOT NULL,
    MODIFY quantity INT NOT NULL;

SET @add_line_unique = (
    SELECT IF(
        EXISTS (
            SELECT 1
            FROM information_schema.statistics
            WHERE table_schema = DATABASE()
              AND table_name = 'pos_transaction_items'
              AND index_name = 'uq_pos_transaction_item_line'
        ),
        'SELECT 1',
        'ALTER TABLE pos_transaction_items ADD UNIQUE KEY uq_pos_transaction_item_line (transaction_id, line_number)'
    )
);
PREPARE stmt FROM @add_line_unique;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_line_check = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'pos_transaction_items'
              AND constraint_name = 'chk_pos_item_line_number'
        ),
        'SELECT 1',
        'ALTER TABLE pos_transaction_items ADD CONSTRAINT chk_pos_item_line_number CHECK (line_number > 0)'
    )
);
PREPARE stmt FROM @add_line_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_quantity_check = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'pos_transaction_items'
              AND constraint_name = 'chk_pos_item_quantity'
        ),
        'SELECT 1',
        'ALTER TABLE pos_transaction_items ADD CONSTRAINT chk_pos_item_quantity CHECK (quantity > 0)'
    )
);
PREPARE stmt FROM @add_quantity_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_unit_price_check = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'pos_transaction_items'
              AND constraint_name = 'chk_pos_item_unit_price'
        ),
        'SELECT 1',
        'ALTER TABLE pos_transaction_items ADD CONSTRAINT chk_pos_item_unit_price CHECK (unit_price_snapshot >= 0)'
    )
);
PREPARE stmt FROM @add_unit_price_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_line_total_check = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'pos_transaction_items'
              AND constraint_name = 'chk_pos_item_line_total'
        ),
        'SELECT 1',
        'ALTER TABLE pos_transaction_items ADD CONSTRAINT chk_pos_item_line_total CHECK (line_total_snapshot IS NULL OR line_total_snapshot >= 0)'
    )
);
PREPARE stmt FROM @add_line_total_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
