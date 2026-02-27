-- Add quantity column to inventory_items table for room/cottage/event tracking
-- This column stores the number of units available for each inventory item

ALTER TABLE inventory_items ADD COLUMN quantity INT DEFAULT 1 NOT NULL;

-- Verify the column was added
-- SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT 
-- FROM INFORMATION_SCHEMA.COLUMNS 
-- WHERE TABLE_NAME = 'inventory_items' AND COLUMN_NAME = 'quantity';
