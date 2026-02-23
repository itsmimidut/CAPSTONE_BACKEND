-- ============================================================
-- QUICK FIX: Add ALL Missing Columns to pos_transactions
-- ============================================================
-- Error: Unknown column 'type' in 'field list'
-- This adds ALL required columns for E-Shop functionality
-- ============================================================

-- Run this to check current structure
DESCRIBE pos_transactions;

-- Add 'type' column (the missing one causing the error)
ALTER TABLE pos_transactions
ADD COLUMN type VARCHAR(50) DEFAULT 'Walk-in' COMMENT 'Transaction type: Walk-in, E-Shop, Delivery';

-- Add location columns for delivery info
ALTER TABLE pos_transactions
ADD COLUMN location_type VARCHAR(50) NULL COMMENT 'Room, Cottage, or Day Guest',
ADD COLUMN location_number VARCHAR(50) NULL COMMENT 'Room or Cottage number',
ADD COLUMN delivery_notes TEXT NULL COMMENT 'Special delivery instructions',
ADD COLUMN customer_id INT NULL COMMENT 'User ID if logged in';

-- Add index for better query performance
ALTER TABLE pos_transactions
ADD INDEX idx_location_type (location_type);

-- Verify all columns were added successfully
DESCRIBE pos_transactions;

-- Show what the table looks like now
SELECT * FROM pos_transactions LIMIT 5;

-- ============================================================
-- If you get "Duplicate column name" errors, that's OK!
-- It means the column already exists. Just ignore those errors.
-- ============================================================
