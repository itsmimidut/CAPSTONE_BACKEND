-- ============================================================
-- ADD SWIMMING CATEGORY TO BOOKING ITEMS
-- ============================================================
-- 
-- Purpose: Add 'Swimming' as a new item type to booking_items table
-- Run this migration on the eduardos database
-- 
-- Date: February 24, 2026
-- ============================================================

USE eduardos;

-- Modify the item_type ENUM to include 'Swimming'
ALTER TABLE booking_items 
MODIFY COLUMN item_type ENUM('Room', 'Cottage', 'Event', 'Swimming') NOT NULL;

-- Verify the change
DESCRIBE booking_items;

-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================
-- 
-- The booking_items table now supports Swimming bookings
-- You can now create bookings with item_type = 'Swimming'
-- Valid item types are: Room, Cottage, Event, Swimming
-- ============================================================
