-- ============================================================
-- ADD ROLE CONSTRAINT TO USER TABLE
-- ============================================================
-- This script adds a CHECK constraint to the role field
-- to ensure only valid roles can be inserted:
-- - admin
-- - customer
-- - restaurantstaff
-- - receptionist
--
-- Run this with: mysql -u root -p eduardos < ADD_ROLE_CONSTRAINT.sql
-- Or: Get-Content "ADD_ROLE_CONSTRAINT.sql" | mysql -u root -p eduardos
-- ============================================================

USE eduardos;

-- First, verify all existing roles are valid
SELECT 
    'Checking existing roles...' as status,
    role,
    COUNT(*) as count
FROM user
GROUP BY role
HAVING role NOT IN ('admin', 'customer', 'restaurantstaff', 'receptionist');

-- If the above query returns any rows, run UPDATE_USER_ROLES.sql first!

-- Add CHECK constraint to role field
-- Note: MySQL enforces CHECK constraints starting from version 8.0.16
ALTER TABLE user
ADD CONSTRAINT chk_user_role 
CHECK (role IN ('admin', 'customer', 'restaurantstaff', 'receptionist'));

-- Verify constraint was added
SELECT 
    CONSTRAINT_NAME,
    CHECK_CLAUSE
FROM information_schema.CHECK_CONSTRAINTS
WHERE TABLE_SCHEMA = 'eduardos'
  AND TABLE_NAME = 'user'
  AND CONSTRAINT_NAME = 'chk_user_role';

SELECT 'Role constraint added successfully!' as message;
