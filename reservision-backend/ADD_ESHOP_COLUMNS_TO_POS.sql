-- ============================================================
-- Add E-Shop/Delivery columns to pos_transactions table
-- ============================================================
-- Purpose: Support online orders with delivery location info
-- Date: February 23, 2026
-- ============================================================

ALTER TABLE pos_transactions
ADD COLUMN location_type VARCHAR(50) NULL COMMENT 'Room, Cottage, or Day Guest',
ADD COLUMN location_number VARCHAR(50) NULL COMMENT 'Room or Cottage number',
ADD COLUMN delivery_notes TEXT NULL COMMENT 'Special delivery instructions',
ADD COLUMN customer_id INT NULL COMMENT 'Reference to user table if logged in',
ADD INDEX idx_location_type (location_type);

-- Update type column to support E-Shop orders
-- Existing values: 'Walk-in'
-- New values: 'E-Shop', 'Delivery'

-- Example of E-Shop order data:
-- {
--   "type": "E-Shop",
--   "location_type": "Room",
--   "location_number": "101",
--   "delivery_notes": "Please knock gently",
--   "items": "[{\"name\":\"Beef Mami\",\"qty\":2,\"price\":185}]",
--   "total_amount": 370.00,
--   "payment_method": "Cash on Delivery"
-- }
