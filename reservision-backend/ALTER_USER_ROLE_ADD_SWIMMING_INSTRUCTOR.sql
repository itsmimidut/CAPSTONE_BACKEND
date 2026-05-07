-- ============================================================
-- ALTER USER ROLE ENUM TO ADD SWIMMING_INSTRUCTOR
-- ============================================================
-- This migration updates the existing user.role column
-- to include swimming_instructor and refreshes the role constraint.
-- Run this with: mysql -u root -p eduardos < ALTER_USER_ROLE_ADD_SWIMMING_INSTRUCTOR.sql
-- ============================================================

USE eduardos;

-- Update the role enum definition to include swimming_instructor
ALTER TABLE `user`
MODIFY COLUMN `role` ENUM('admin','customer','receptionist','restaurantstaff','swimming_instructor')
DEFAULT 'customer';

-- Replace the role check constraint, if present
ALTER TABLE `user`
DROP CHECK chk_user_role;

ALTER TABLE `user`
ADD CONSTRAINT chk_user_role
CHECK (role IN ('admin','customer','restaurantstaff','receptionist','swimming_instructor'));

-- Verify the updated role definition
SELECT 
    'Role values updated' AS message,
    COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'eduardos'
  AND TABLE_NAME = 'user'
  AND COLUMN_NAME = 'role';

SELECT 
    CONSTRAINT_NAME,
    CHECK_CLAUSE
FROM information_schema.CHECK_CONSTRAINTS
WHERE TABLE_SCHEMA = 'eduardos'
  AND TABLE_NAME = 'user'
  AND CONSTRAINT_NAME = 'chk_user_role';
