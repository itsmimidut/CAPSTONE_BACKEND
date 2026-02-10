-- ============================================================
-- LINK USER TABLE AND CUSTOMERS TABLE
-- ============================================================
-- This migration creates a proper relationship between user and customers tables.
-- - user table: handles authentication (email, password, role)
-- - customers table: stores customer-specific profile data
-- - Linked via: customers.user_id → user.user_id (foreign key)
--
-- Run this in your MySQL database:
-- mysql -u root -p reservision < ADD_CUSTOMER_FIELDS_TO_USER_TABLE.sql
--
-- Or copy and paste into MySQL Workbench/phpMyAdmin
-- ============================================================

USE eduardos;

-- First, ensure user table has the required fields
ALTER TABLE user
ADD COLUMN IF NOT EXISTS first_name VARCHAR(255) AFTER user_id,
ADD COLUMN IF NOT EXISTS last_name VARCHAR(255) AFTER first_name,
ADD COLUMN IF NOT EXISTS phone VARCHAR(20) AFTER email;

-- Update customers table structure to remove duplicate fields
-- and keep only customer-specific profile data
ALTER TABLE customers
MODIFY COLUMN first_name VARCHAR(100) NULL,
MODIFY COLUMN last_name VARCHAR(100) NULL,
MODIFY COLUMN phone VARCHAR(20) NULL;

-- Optionally, you can drop these duplicate columns if you want clean separation
-- (uncomment the lines below if you want to completely remove duplicates)
-- ALTER TABLE customers
-- DROP COLUMN first_name,
-- DROP COLUMN last_name,
-- DROP COLUMN phone;

-- Create customers table if not exists (for new installations)
CREATE TABLE IF NOT EXISTS customers (
  customer_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  address VARCHAR(255),
  city VARCHAR(100),
  country VARCHAR(100) DEFAULT 'Philippines',
  postal_code VARCHAR(20),
  profile_image TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Foreign key to link with user table
  CONSTRAINT fk_customer_user FOREIGN KEY (user_id) REFERENCES user(user_id) ON DELETE CASCADE,
  
  -- Indexes for better query performance
  INDEX idx_customer_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add indexes to user table if not exists
CREATE INDEX IF NOT EXISTS idx_user_role ON user(role);
CREATE INDEX IF NOT EXISTS idx_user_email ON user(email);

-- Verify the changes
DESCRIBE customers;
DESCRIBE user;

-- ============================================================
-- NOTES:
-- ============================================================
-- Database Structure:
-- 
-- user table (authentication):
--   - user_id (PK)
--   - email
--   - password (hashed)
--   - role ('customer', 'admin', etc.)
--   - created_at
--
-- customers table (profile data):
--   - customer_id (PK)
--   - user_id (FK → user.user_id) UNIQUE
--   - first_name, last_name
--   - phone, address, city, country, postal_code
--   - profile_image
--   - created_at, updated_at
--
-- Relationship: One-to-One (1 user = 1 customer profile)
-- ON DELETE CASCADE: When user is deleted, customer profile is also deleted
-- ============================================================
