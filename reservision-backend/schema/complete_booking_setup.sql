-- ============================================================
-- COMPLETE BOOKING CONFIRMATION DATABASE SETUP
-- ============================================================
-- Run this entire file in phpMyAdmin to set up all tables

USE eduardos;

-- ============================================================
-- 1. CUSTOMERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  full_name VARCHAR(200) GENERATED ALWAYS AS (CONCAT(first_name, ' ', last_name)) STORED,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  address TEXT,
  city VARCHAR(100),
  country VARCHAR(100) DEFAULT 'Philippines',
  postal_code VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_email (email),
  INDEX idx_phone (phone),
  INDEX idx_full_name (full_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 2. UPDATE BOOKINGS TABLE (Add customer fields)
-- ============================================================
ALTER TABLE bookings
ADD COLUMN IF NOT EXISTS customer_id INT AFTER booking_id,
ADD COLUMN IF NOT EXISTS arrival_time VARCHAR(10) DEFAULT '3 PM' AFTER children;

-- Add foreign key constraint (drop first if exists)
SET @fk_exists = (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS 
                  WHERE TABLE_SCHEMA = 'eduardos' 
                  AND TABLE_NAME = 'bookings' 
                  AND CONSTRAINT_NAME = 'bookings_ibfk_customer');

SET @sql = IF(@fk_exists > 0, 
              'SELECT "Foreign key already exists"', 
              'ALTER TABLE bookings ADD CONSTRAINT bookings_ibfk_customer FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add index for better performance
ALTER TABLE bookings
ADD INDEX IF NOT EXISTS idx_customer_id (customer_id);

-- ============================================================
-- 3. PAYMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  customer_id INT NOT NULL,
  
  -- Payment Details
  payment_reference VARCHAR(100) UNIQUE NOT NULL COMMENT 'Unique payment reference',
  payment_method ENUM('paymaya', 'gcash', 'bank', 'card', 'cash') NOT NULL,
  payment_gateway VARCHAR(50) DEFAULT 'paymongo' COMMENT 'paymongo, xendit, manual',
  
  -- Amount Details
  amount DECIMAL(10,2) NOT NULL COMMENT 'Total payment amount',
  currency VARCHAR(3) DEFAULT 'PHP',
  
  -- Status Tracking
  status ENUM('pending', 'paid', 'failed', 'refunded', 'expired') DEFAULT 'pending',
  
  -- PayMongo/Gateway Specific
  checkout_url TEXT COMMENT 'Payment link URL',
  payment_intent_id VARCHAR(255) COMMENT 'PayMongo payment intent ID',
  
  -- Timestamps
  paid_at TIMESTAMP NULL COMMENT 'When payment was completed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Foreign Keys
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
  
  -- Indexes
  INDEX idx_booking_id (booking_id),
  INDEX idx_customer_id (customer_id),
  INDEX idx_status (status),
  INDEX idx_payment_reference (payment_reference),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- VERIFICATION QUERIES
-- ============================================================
SELECT 'Tables created successfully!' as Status;
SELECT 'Customers table:' as Info, COUNT(*) as Row_Count FROM customers;
SELECT 'Bookings table:' as Info, COUNT(*) as Row_Count FROM bookings;
SELECT 'Payments table:' as Info, COUNT(*) as Row_Count FROM payments;
