-- ============================================================
-- Add cash/change fields and normalized line-item table for POS
-- ============================================================
-- Safe to run multiple times.

SET @db = DATABASE();

-- Add cash_received column if missing
SET @stmt = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @db
        AND TABLE_NAME = 'pos_transactions'
        AND COLUMN_NAME = 'cash_received'
    ),
    'SELECT 1',
    'ALTER TABLE pos_transactions ADD COLUMN cash_received DECIMAL(10,2) NULL AFTER total_amount'
  )
);
PREPARE s FROM @stmt;
EXECUTE s;
DEALLOCATE PREPARE s;

-- Add change_amount column if missing
SET @stmt = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @db
        AND TABLE_NAME = 'pos_transactions'
        AND COLUMN_NAME = 'change_amount'
    ),
    'SELECT 1',
    'ALTER TABLE pos_transactions ADD COLUMN change_amount DECIMAL(10,2) NULL AFTER cash_received'
  )
);
PREPARE s FROM @stmt;
EXECUTE s;
DEALLOCATE PREPARE s;

-- Create normalized line-item table (one row per sold item)
CREATE TABLE IF NOT EXISTS pos_transaction_items (
  line_id INT AUTO_INCREMENT PRIMARY KEY,
  transaction_id INT NOT NULL,
  receipt_no VARCHAR(50) NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  line_total DECIMAL(10,2) NOT NULL,
  booking_reference VARCHAR(120) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_transaction_id (transaction_id),
  INDEX idx_receipt_no (receipt_no),
  CONSTRAINT fk_pos_items_transaction
    FOREIGN KEY (transaction_id) REFERENCES pos_transactions(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Optional backfill from existing JSON items if MySQL 8+ (JSON_TABLE supported)
-- Uncomment if needed:
-- INSERT INTO pos_transaction_items (transaction_id, receipt_no, item_name, quantity, unit_price, line_total, booking_reference)
-- SELECT
--   pt.id,
--   pt.receipt_no,
--   jt.name,
--   COALESCE(jt.quantity, jt.qty, 1) AS quantity,
--   COALESCE(jt.unitPrice, jt.price, 0) AS unit_price,
--   COALESCE(jt.lineTotal, jt.price, 0) AS line_total,
--   jt.bookingReference
-- FROM pos_transactions pt
-- JOIN JSON_TABLE(
--   pt.items,
--   '$[*]' COLUMNS (
--     name VARCHAR(255) PATH '$.name',
--     quantity INT PATH '$.quantity' NULL ON EMPTY,
--     qty INT PATH '$.qty' NULL ON EMPTY,
--     price DECIMAL(10,2) PATH '$.price' NULL ON EMPTY,
--     unitPrice DECIMAL(10,2) PATH '$.unitPrice' NULL ON EMPTY,
--     lineTotal DECIMAL(10,2) PATH '$.lineTotal' NULL ON EMPTY,
--     bookingReference VARCHAR(120) PATH '$.bookingReference' NULL ON EMPTY
--   )
-- ) jt;

SELECT 'POS schema update complete' AS status;
