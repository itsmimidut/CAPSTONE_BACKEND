-- ============================================================
-- UPDATE USER ROLES MIGRATION
-- ============================================================
-- This script updates user roles to match the database schema:
-- - admin
-- - customer
-- - restaurantstaff
-- - receptionist
--
-- Run this with: mysql -u root -p eduardos < UPDATE_USER_ROLES.sql
-- Or: Get-Content "UPDATE_USER_ROLES.sql" | mysql -u root -p eduardos
-- ============================================================

USE eduardos;

-- Show current role distribution before update
SELECT 'BEFORE UPDATE:' as status, role, COUNT(*) as count 
FROM user 
GROUP BY role;

-- Update any roles that might be in different formats
-- Note: Only update if roles don't match expected values

-- Update Admin variations (if any exist)
UPDATE user 
SET role = 'admin' 
WHERE role IN ('Admin', 'ADMIN', 'administrator', 'Administrator');

-- Update Customer variations (if any exist)
UPDATE user 
SET role = 'customer' 
WHERE role IN ('Customer', 'CUSTOMER', 'user', 'User');

-- Update Restaurant Staff variations (if any exist)
UPDATE user 
SET role = 'restaurantstaff' 
WHERE role IN ('RestaurantStaff', 'restaurant_staff', 'Restaurant Staff', 'Staff', 'staff', 'restaurant');

-- Update Receptionist variations (if any exist)
UPDATE user 
SET role = 'receptionist' 
WHERE role IN ('Receptionist', 'RECEPTIONIST', 'reception', 'Reception', 'frontdesk', 'Front Desk');

-- Show role distribution after update
SELECT 'AFTER UPDATE:' as status, role, COUNT(*) as count 
FROM user 
GROUP BY role;

-- Add constraint to ensure only valid roles can be inserted in the future
-- (Optional - will fail if any invalid roles still exist)
-- ALTER TABLE user 
-- ADD CONSTRAINT chk_user_role 
-- CHECK (role IN ('admin', 'customer', 'restaurantstaff', 'receptionist'));

-- Show summary
SELECT 
    'Migration completed!' as message,
    COUNT(*) as total_users,
    SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admins,
    SUM(CASE WHEN role = 'customer' THEN 1 ELSE 0 END) as customers,
    SUM(CASE WHEN role = 'restaurantstaff' THEN 1 ELSE 0 END) as restaurant_staff,
    SUM(CASE WHEN role = 'receptionist' THEN 1 ELSE 0 END) as receptionists,
    SUM(CASE WHEN role NOT IN ('admin', 'customer', 'restaurantstaff', 'receptionist') THEN 1 ELSE 0 END) as invalid_roles
FROM user;
