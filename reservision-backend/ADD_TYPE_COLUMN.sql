-- ============================================================
-- ADD MISSING 'type' COLUMN TO pos_transactions
-- ============================================================
-- Current structure is missing the 'type' column
-- This will add it between 'items' and 'payment_method'
-- ============================================================

ALTER TABLE pos_transactions
ADD COLUMN type VARCHAR(50) DEFAULT 'Walk-in' COMMENT 'Transaction type: Walk-in, E-Shop, Delivery' AFTER items;

-- Verify the column was added
DESCRIBE pos_transactions;

-- Show the updated structure
SELECT 'Column added successfully!' as status;
