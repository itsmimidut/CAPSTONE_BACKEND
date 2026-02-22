-- ============================================================
-- Add booking_reference column to swimming_enrollments table
-- ============================================================
-- This allows tracking which enrollments belong to which booking
-- and prevents exceeding the paid participant capacity

USE eduardos;

-- Add booking_reference column
ALTER TABLE swimming_enrollments
ADD COLUMN IF NOT EXISTS booking_reference VARCHAR(20) AFTER enrollment_id;

-- Add index for faster lookups
ALTER TABLE swimming_enrollments
ADD INDEX IF NOT EXISTS idx_booking_reference (booking_reference);

-- Verify the change
DESCRIBE swimming_enrollments;

-- Show example query
SELECT 
    booking_reference,
    COUNT(*) as enrollment_count,
    GROUP_CONCAT(CONCAT(first_name, ' ', last_name) SEPARATOR ', ') as enrolled_students
FROM swimming_enrollments
WHERE booking_reference IS NOT NULL
GROUP BY booking_reference;
