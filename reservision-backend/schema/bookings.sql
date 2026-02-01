-- ============================================================
-- BOOKINGS/RESERVATIONS SYSTEM TABLES
-- ============================================================
-- Purpose: Handle customer bookings for rooms, cottages, events, and food
-- Author: Reservision Backend Team
-- Date: February 1, 2026
-- ============================================================

-- Create bookings table
CREATE TABLE IF NOT EXISTS bookings (
  booking_id INT AUTO_INCREMENT PRIMARY KEY,
  
  -- Booking Reference
  booking_reference VARCHAR(20) UNIQUE NOT NULL,
  
  -- Customer Information
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  address TEXT NOT NULL,
  city VARCHAR(100) NOT NULL,
  country VARCHAR(100) DEFAULT 'Philippines',
  postal_code VARCHAR(20),
  
  -- Booking Details
  check_in_date DATE,
  check_out_date DATE,
  nights INT DEFAULT 0,
  adults INT DEFAULT 2,
  children INT DEFAULT 0,
  
  -- Special Requests
  special_requests TEXT,
  
  -- Financial Information
  subtotal DECIMAL(10, 2) NOT NULL,
  discount DECIMAL(10, 2) DEFAULT 0,
  tax DECIMAL(10, 2) DEFAULT 0,
  total DECIMAL(10, 2) NOT NULL,
  promo_code VARCHAR(50),
  
  -- Booking Status
  booking_status ENUM('Pending', 'Confirmed', 'Checked-In', 'Checked-Out', 'Cancelled') DEFAULT 'Pending',
  payment_status ENUM('Unpaid', 'Partially Paid', 'Paid', 'Refunded') DEFAULT 'Unpaid',
  payment_method ENUM('Cash', 'Credit Card', 'Debit Card', 'Bank Transfer', 'GCash', 'PayMaya') DEFAULT 'Cash',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  -- Indexes for better query performance
  INDEX idx_booking_reference (booking_reference),
  INDEX idx_email (email),
  INDEX idx_booking_status (booking_status),
  INDEX idx_check_in_date (check_in_date),
  INDEX idx_check_out_date (check_out_date),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create booking_items table (items within each booking)
CREATE TABLE IF NOT EXISTS booking_items (
  item_id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  
  -- Item Details
  item_type ENUM('Room', 'Cottage', 'Food', 'Event') NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  item_description TEXT,
  
  -- Reference to actual inventory item (if applicable)
  inventory_item_id INT,
  
  -- Pricing
  unit_price DECIMAL(10, 2) NOT NULL,
  quantity INT DEFAULT 1,
  nights INT DEFAULT 0,
  total_price DECIMAL(10, 2) NOT NULL,
  
  -- Additional details
  guests INT,
  per_night BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Foreign Keys
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(item_id) ON DELETE SET NULL,
  
  -- Indexes
  INDEX idx_booking_id (booking_id),
  INDEX idx_item_type (item_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create occupied_dates table (track occupied dates for rooms/cottages)
CREATE TABLE IF NOT EXISTS occupied_dates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  inventory_item_id INT NOT NULL,
  booking_id INT NOT NULL,
  occupied_date DATE NOT NULL,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Foreign Keys
  FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(item_id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
  
  -- Indexes
  INDEX idx_inventory_item_id (inventory_item_id),
  INDEX idx_booking_id (booking_id),
  INDEX idx_occupied_date (occupied_date),
  
  -- Ensure no double booking for same item on same date
  UNIQUE KEY unique_item_date (inventory_item_id, occupied_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create booking_logs table (audit trail)
CREATE TABLE IF NOT EXISTS booking_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  
  -- Log Details
  action VARCHAR(100) NOT NULL,
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  description TEXT,
  performed_by VARCHAR(100),
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Foreign Keys
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
  
  -- Indexes
  INDEX idx_booking_id (booking_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SAMPLE DATA FOR TESTING
-- ============================================================

-- Insert sample booking
INSERT INTO bookings (
  booking_reference,
  first_name,
  last_name,
  email,
  phone,
  address,
  city,
  postal_code,
  check_in_date,
  check_out_date,
  nights,
  adults,
  children,
  special_requests,
  subtotal,
  total,
  booking_status,
  payment_status
) VALUES (
  'BK20260201001',
  'Juan',
  'Dela Cruz',
  'juan.delacruz@email.com',
  '+639171234567',
  '123 Main Street, Barangay 1',
  'Manila',
  '1000',
  '2026-02-15',
  '2026-02-17',
  2,
  2,
  1,
  'Late check-in requested',
  7000.00,
  7000.00,
  'Confirmed',
  'Paid'
);

-- Insert booking items for the sample booking
INSERT INTO booking_items (
  booking_id,
  item_type,
  item_name,
  item_description,
  inventory_item_id,
  unit_price,
  quantity,
  nights,
  total_price,
  guests,
  per_night
) VALUES (
  1,
  'Room',
  'Deluxe Ocean View',
  'Luxurious room with stunning ocean views',
  1,
  3500.00,
  1,
  2,
  7000.00,
  2,
  TRUE
);

-- Insert occupied dates for the sample booking
INSERT INTO occupied_dates (inventory_item_id, booking_id, occupied_date) VALUES
(1, 1, '2026-02-15'),
(1, 1, '2026-02-16'),
(1, 1, '2026-02-17');

-- Insert booking log
INSERT INTO booking_logs (booking_id, action, new_status, description, performed_by) VALUES
(1, 'Created', 'Pending', 'Booking created by customer', 'System'),
(1, 'Status Updated', 'Confirmed', 'Payment received and booking confirmed', 'Admin');
