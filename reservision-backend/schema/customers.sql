-- ============================================================
-- CUSTOMERS TABLE SCHEMA
-- ============================================================
-- Purpose: Store customer/guest information for bookings
-- Includes contact details and billing information

CREATE TABLE IF NOT EXISTS customers (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  full_name VARCHAR(200) GENERATED ALWAYS AS (CONCAT(first_name, ' ', last_name)) STORED,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  profile_image LONGTEXT,
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
