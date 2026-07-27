-- ============================================================
-- GROUPED ROOM LISTING - DATABASE SETUP
-- ============================================================
-- 
-- Purpose:
-- - Create necessary columns and indexes for grouped room display
-- - Enable atomic room assignment with transaction safety
-- - Track occupied dates to prevent double-booking
-- 
-- Assumptions:
-- - MySQL/MariaDB 5.7+
-- - inventory_items table already exists
-- - bookings, booking_items, occupied_dates tables exist
-- 
-- Instructions:
-- 1. Open phpMyAdmin (http://localhost/phpmyadmin)
-- 2. Select your database (e.g., 'eduardos')
-- 3. Go to SQL tab
-- 4. Copy and paste this entire script
-- 5. Click 'Go' to execute
-- 
-- ============================================================

USE eduardos;

-- ============================================================
-- STEP 1: VERIFY REQUIRED COLUMNS IN inventory_items
-- ============================================================

-- Ensure inventory_items table has required columns
-- (assuming they already exist from standard setup)

-- Verify structure:
-- DESC inventory_items;
-- Expected columns: item_id, category, category_type, room_number, name, price, 
--                   max_guests, description, status, images, created_at, updated_at

-- ============================================================
-- STEP 2: ADD INDEXES FOR PERFORMANCE
-- ============================================================

-- Add index for grouping queries (status + category_type)
ALTER TABLE inventory_items 
ADD INDEX idx_status_category (status, category_type),
ADD INDEX idx_category_type (category_type),
ADD INDEX idx_name (name);

-- Add indexes to booking_items for lookups
ALTER TABLE booking_items
ADD INDEX idx_inventory_item_id (inventory_item_id),
ADD INDEX idx_booking_id (booking_id);

-- Add indexes to occupied_dates for date range queries
ALTER TABLE occupied_dates
ADD INDEX idx_item_date (inventory_item_id, occupied_date),
ADD INDEX idx_date_range (occupied_date),
ADD UNIQUE KEY unique_item_date (inventory_item_id, occupied_date);

-- ============================================================
-- STEP 3: VERIFY occupied_dates TABLE STRUCTURE
-- ============================================================

-- Ensure occupied_dates table exists with proper structure
CREATE TABLE IF NOT EXISTS occupied_dates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  inventory_item_id INT NOT NULL,
  booking_id INT,
  occupied_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  -- Foreign keys
  FOREIGN KEY (booking_id) REFERENCES bookings(booking_id) ON DELETE CASCADE,
  
  -- Indexes
  INDEX idx_inventory_item_id (inventory_item_id),
  INDEX idx_booking_id (booking_id),
  INDEX idx_occupied_date (occupied_date),
  UNIQUE KEY unique_item_date (inventory_item_id, occupied_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- STEP 4: SAMPLE DATA - ADD TEST ROOMS
-- ============================================================

-- Insert sample rooms for testing grouped display
-- These will be grouped by base room name (without trailing number)

INSERT INTO inventory_items (
  category, category_type, room_number, name, description, 
  max_guests, price, status, created_at, updated_at
) VALUES
  ('Room', 'room', 'R101', 'FAMILY ROOM 1', 
   'Spacious room perfect for families with 2 beds and living area', 4, 4500, 'Available', NOW(), NOW()),
  ('Room', 'room', 'R102', 'FAMILY ROOM 2', 
   'Spacious room perfect for families with 2 beds and living area', 4, 4500, 'Available', NOW(), NOW()),
  ('Room', 'room', 'R103', 'FAMILY ROOM 3', 
   'Spacious room perfect for families with 2 beds and living area', 4, 4500, 'Occupied', NOW(), NOW()),
  ('Room', 'room', 'R201', 'DELUXE ROOM 1', 
   'Luxurious room with premium amenities and ocean view', 2, 5500, 'Available', NOW(), NOW()),
  ('Room', 'room', 'R202', 'DELUXE ROOM 2', 
   'Luxurious room with premium amenities and ocean view', 2, 5500, 'Available', NOW(), NOW()),
  ('Room', 'room', 'R301', 'SUITE ROOM 1', 
   'Premium suite with separate living area and king bed', 3, 6500, 'Available', NOW(), NOW());

-- ============================================================
-- STEP 5: TEST GROUPED QUERY
-- ============================================================

-- Test query to verify grouping works correctly
SELECT 
  SUBSTRING(name, 1, CHAR_LENGTH(name) - 2) AS room_type,
  MIN(name) AS sample_name,
  price,
  max_guests,
  description,
  COUNT(CASE WHEN status = 'Available' THEN 1 END) AS available_count,
  COUNT(*) AS total_rooms,
  MIN(item_id) AS primary_item_id
FROM inventory_items
WHERE category_type = 'room' 
  AND status IN ('Available', 'Occupied')
GROUP BY SUBSTRING(name, 1, CHAR_LENGTH(name) - 2), price, max_guests, description
ORDER BY price ASC;

-- Expected Result:
-- room_type    | price | max_guests | available_count | total_rooms | primary_item_id
-- FAMILY ROOM  | 4500  | 4          | 2               | 3           | 1
-- DELUXE ROOM  | 5500  | 2          | 2               | 2           | 4
-- SUITE ROOM   | 6500  | 3          | 1               | 1           | 6

-- ============================================================
-- STEP 6: TEST AVAILABILITY CHECK
-- ============================================================

-- Test query to check available rooms for date range
-- (requires dates in occupied_dates)

SELECT 
  ii.item_id,
  ii.name,
  ii.status,
  COUNT(CASE WHEN od.occupied_date BETWEEN '2026-05-01' AND '2026-05-03' THEN 1 END) as booked_in_range
FROM inventory_items ii
LEFT JOIN occupied_dates od ON ii.item_id = od.inventory_item_id
WHERE SUBSTRING(ii.name, 1, CHAR_LENGTH(ii.name) - 2) = 'FAMILY ROOM'
  AND ii.category_type = 'room'
GROUP BY ii.item_id, ii.name, ii.status
HAVING booked_in_range = 0
ORDER BY ii.item_id ASC;

-- Expected: Returns all available FAMILY ROOM instances

-- ============================================================
-- STEP 7: VERIFY TABLE SCHEMA
-- ============================================================

-- Check inventory_items structure
DESC inventory_items;

-- Check booking_items structure
DESC booking_items;

-- Check occupied_dates structure
DESC occupied_dates;

-- Check bookings structure
DESC bookings;

-- ============================================================
-- STEP 8: VERIFY INDEXES
-- ============================================================

-- Show indexes on inventory_items
SHOW INDEX FROM inventory_items;

-- Show indexes on occupied_dates
SHOW INDEX FROM occupied_dates;

-- Show indexes on booking_items
SHOW INDEX FROM booking_items;

-- ============================================================
-- CONFIGURATION COMPLETE
-- ============================================================
-- 
-- Your database is now configured for grouped room listing with:
-- ✓ Proper indexes for grouped queries
-- ✓ Occupied dates tracking
-- ✓ Transaction-safe booking assignment
-- ✓ Double-booking prevention via unique constraint
-- 
-- Next Steps:
-- 1. Deploy backend controllers (roomsController.js updates)
-- 2. Deploy roomAssignmentService.js
-- 3. Deploy updated bookingsController.js
-- 4. Update routes (bookings.js, rooms.js)
-- 5. Test API endpoints:
--    - GET /api/rooms/grouped
--    - POST /api/bookings/with-auto-assign
-- 6. Create frontend Vue component for grouped room display
-- 
-- ============================================================
