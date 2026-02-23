-- ============================================================
-- REMOVE FOOD CATEGORY FROM BOOKING ITEMS
-- ============================================================
-- 
-- Purpose: Remove 'Food' from item_type ENUM in booking_items table
-- Run this migration on the eduardos database
-- 
-- Date: February 24, 2026
-- ============================================================

USE eduardos;

-- First, check if there are any existing Food bookings
SELECT COUNT(*) as food_bookings_count 
FROM booking_items 
WHERE item_type = 'Food';

-- If there are Food bookings, you need to decide what to do with them:
-- Option 1: Delete them (use with caution)
-- DELETE FROM booking_items WHERE item_type = 'Food';

-- Option 2: Convert them to another type (e.g., Event)
-- UPDATE booking_items SET item_type = 'Event' WHERE item_type = 'Food';

-- After handling existing Food records, modify the ENUM
ALTER TABLE booking_items 
MODIFY COLUMN item_type ENUM('Room', 'Cottage', 'Event', 'Swimming') NOT NULL;

-- Verify the change
DESCRIBE booking_items;

-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================
-- 
-- The booking_items table no longer supports Food bookings
-- Valid item types are: Room, Cottage, Event, Swimming
-- ============================================================
