-- Fix for menu_items AUTO_INCREMENT issue
-- Run this if you encounter "Duplicate entry '0' for key 'PRIMARY'" error

-- First, check current auto_increment value
SELECT AUTO_INCREMENT 
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'reservision_db' 
AND TABLE_NAME = 'menu_items';

-- Reset auto_increment to next available ID
SET @next_id = (SELECT COALESCE(MAX(menu_id), 0) + 1 FROM menu_items);
SET @alter_sql = CONCAT('ALTER TABLE menu_items AUTO_INCREMENT = ', @next_id);
PREPARE stmt FROM @alter_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Verify the fix
SELECT AUTO_INCREMENT 
FROM information_schema.TABLES 
WHERE TABLE_SCHEMA = 'reservision_db' 
AND TABLE_NAME = 'menu_items';

-- Alternative simple command (if the above doesn't work):
-- ALTER TABLE menu_items AUTO_INCREMENT = 1;
