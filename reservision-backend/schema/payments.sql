-- ============================================================
-- PAYMENTS TABLE SCHEMA
-- ============================================================
-- Purpose: Track all payment transactions for bookings
-- Supports multiple payment methods (PayMongo, GCash, Maya, Bank Transfer)

CREATE TABLE IF NOT EXISTS payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  customer_id INT NOT NULL,
  
  -- Payment Details
  payment_reference VARCHAR(100) UNIQUE NOT NULL COMMENT 'Unique payment reference (PayMongo ID, etc)',
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
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE,
  
  -- Indexes
  INDEX idx_booking_id (booking_id),
  INDEX idx_customer_id (customer_id),
  INDEX idx_status (status),
  INDEX idx_payment_reference (payment_reference),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
