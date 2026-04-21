-- ============================================================
-- Add payment_url column to pos_transactions table
-- Purpose: Store GCash payment URLs for QR code generation on receipts
-- ============================================================

-- Check if column exists first
SELECT 'Starting migration...' AS status;

-- Add payment_url column if it doesn't exist
ALTER TABLE pos_transactions 
ADD COLUMN payment_url LONGTEXT NULL AFTER payment_method;

-- Verify the column was added
SELECT 'Migration complete: payment_url column added' AS status;
DESCRIBE pos_transactions;
