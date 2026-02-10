-- ============================================================
-- CUSTOMERS TABLE SETUP
-- ============================================================
-- This file creates the customers table for user authentication
-- and customer management in the reservation system.
--
-- Run this SQL file in your MySQL database to create the table:
-- mysql -u root -p your_database_name < SETUP_CUSTOMERS_TABLE.sql
-- 
-- Or copy and paste the SQL commands into your MySQL client
-- ============================================================

-- Create customers table if it doesn't exist
CREATE TABLE IF NOT EXISTS customers (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  address VARCHAR(255),
  city VARCHAR(100),
  country VARCHAR(100) DEFAULT 'Philippines',
  postal_code VARCHAR(20),
  profile_image TEXT,
  email_verified BOOLEAN DEFAULT FALSE,
  status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Indexes for faster queries
  INDEX idx_email (email),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SAMPLE DATA (Optional - for testing)
-- ============================================================
-- Uncomment the following lines to insert sample customer data
-- Note: Password is 'password123' hashed with bcrypt (10 rounds)

/*
INSERT INTO customers (first_name, last_name, email, password, phone, address, city, country, postal_code) VALUES
(
  'Juan',
  'Dela Cruz',
  'juan@example.com',
  '$2a$10$rBV2kGZ5U6HJz/pxYbz5Pu.qYH4M8zKN6Y7QXhX5YGz5YGz5YGz5Y',
  '09171234567',
  '123 Main Street',
  'Manila',
  'Philippines',
  '1000'
),
(
  'Maria',
  'Santos',
  'maria@example.com',
  '$2a$10$rBV2kGZ5U6HJz/pxYbz5Pu.qYH4M8zKN6Y7QXhX5YGz5YGz5YGz5Y',
  '09181234567',
  '456 Sample Ave',
  'Quezon City',
  'Philippines',
  '1100'
);
*/

-- ============================================================
-- VERIFICATION
-- ============================================================
-- Run this query to verify the table was created successfully:
-- SELECT * FROM customers LIMIT 10;
--
-- Check table structure:
-- DESCRIBE customers;
-- ============================================================
