-- ============================================================
-- ADD BOOKING_ID TO SWIMMING_ENROLLMENTS TABLE
-- ============================================================
-- Purpose: Link swimming enrollments to bookings for the 
-- booking-first enrollment flow
-- ============================================================

-- Add booking_id column to swimming_enrollments table
ALTER TABLE swimming_enrollments 
ADD COLUMN IF NOT EXISTS booking_id INT(11) DEFAULT NULL 
  COMMENT 'Links to booking that paid for this enrollment' AFTER enrollment_id;

-- Add index for better query performance
ALTER TABLE swimming_enrollments 
ADD INDEX IF NOT EXISTS idx_swimming_enrollments_booking (booking_id);

-- Add foreign key constraint (optional - use if bookings table exists)
ALTER TABLE swimming_enrollments 
ADD CONSTRAINT fk_swimming_enrollments_booking 
  FOREIGN KEY (booking_id) 
  REFERENCES bookings (booking_id) 
  ON DELETE SET NULL;

-- ============================================================
-- VERIFICATION QUERY
-- ============================================================
-- Run this to verify the column was added successfully:

SELECT 
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_KEY,
    COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'swimming_enrollments'
    AND COLUMN_NAME = 'booking_id';

-- Expected output:
-- COLUMN_NAME | COLUMN_TYPE | IS_NULLABLE | COLUMN_KEY | COLUMN_COMMENT
-- booking_id  | int(11)     | YES         | MUL        | Links to booking that paid for this enrollment
