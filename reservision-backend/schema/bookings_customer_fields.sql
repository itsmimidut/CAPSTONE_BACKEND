-- ============================================================
-- ENHANCED BOOKINGS TABLE WITH CUSTOMER INFO
-- ============================================================
-- Adds customer_id foreign key and guest information fields

ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS customer_id INT AFTER id,
ADD COLUMN IF NOT EXISTS adults INT DEFAULT 2 AFTER customer_id,
ADD COLUMN IF NOT EXISTS children INT DEFAULT 0 AFTER adults,
ADD COLUMN IF NOT EXISTS arrival_time VARCHAR(10) DEFAULT '3 PM' AFTER children,
ADD COLUMN IF NOT EXISTS special_requests TEXT AFTER arrival_time,
ADD FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE;

-- Add index for better query performance
ALTER TABLE bookings
ADD INDEX idx_customer_id (customer_id);
