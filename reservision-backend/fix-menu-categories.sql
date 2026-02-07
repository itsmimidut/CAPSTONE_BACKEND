-- Fix menu categories to match new category list
-- Run this file to delete old test data

USE reservision;

-- Delete the 5 test items with outdated categories
DELETE FROM menu_items WHERE menu_id IN (1, 2, 3, 4, 5);

-- Reset AUTO_INCREMENT to 1
ALTER TABLE menu_items AUTO_INCREMENT = 1;

-- Verify it's empty
SELECT COUNT(*) as remaining_items FROM menu_items;
