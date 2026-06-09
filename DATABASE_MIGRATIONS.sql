/**
 * DATABASE MIGRATIONS
 * ===================
 * 
 * Run these SQL statements in your MySQL database to add the required columns
 * for entrance fee tracking and check-in/check-out functionality.
 */

-- ============================================================
-- 1. Update bookings table
-- ============================================================

ALTER TABLE bookings ADD COLUMN (
  entrance_fee DECIMAL(10, 2) DEFAULT 0 COMMENT 'Entrance fee charged based on paying guests',
  actual_check_in_time DATETIME NULL COMMENT 'Timestamp when guest actually checked in',
  actual_check_out_time DATETIME NULL COMMENT 'Timestamp when guest actually checked out'
);

-- Index for faster queries
CREATE INDEX idx_bookings_status ON bookings(booking_status);
CREATE INDEX idx_bookings_reference ON bookings(booking_reference);

-- ============================================================
-- 2. Update booking_items table
-- ============================================================

ALTER TABLE booking_items ADD COLUMN (
  guest_breakdown JSON NULL COMMENT 'Guest breakdown object: {adults, children, seniors, infants, payingGuests, totalGuests}',
  paying_guests INT DEFAULT 0 COMMENT 'Number of paying guests (used to calculate entrance fee)',
  entrance_fee DECIMAL(10, 2) DEFAULT 0 COMMENT 'Entrance fee for this item'
);

-- ============================================================
-- 3. Verify columns were added (run to check)
-- ============================================================

-- Check bookings table
DESC bookings;

-- Check booking_items table
DESC booking_items;

-- ============================================================
-- 4. Sample Data Query (for testing)
-- ============================================================

-- Get all bookings with their items and entrance fees
SELECT 
  b.booking_id,
  b.booking_reference,
  b.check_in_date,
  b.check_out_date,
  b.booking_status,
  b.payment_status,
  b.subtotal,
  b.entrance_fee,
  b.total,
  b.actual_check_in_time,
  b.actual_check_out_time,
  bi.item_name,
  bi.guest_breakdown,
  bi.paying_guests,
  bi.entrance_fee as item_entrance_fee
FROM bookings b
LEFT JOIN booking_items bi ON b.booking_id = bi.booking_id
ORDER BY b.created_at DESC
LIMIT 50;

-- ============================================================
-- 5. Optional: Add audit columns (recommended)
-- ============================================================

-- If you want to track who performed check-in/check-out
ALTER TABLE bookings ADD COLUMN (
  checked_in_by INT NULL COMMENT 'User ID of who checked in the guest',
  checked_out_by INT NULL COMMENT 'User ID of who checked out the guest'
);

-- Add foreign key if needed
-- ALTER TABLE bookings ADD CONSTRAINT fk_checked_in_by 
--   FOREIGN KEY (checked_in_by) REFERENCES user(user_id);

-- ============================================================
-- 6. Reset payment_status enum (if needed)
-- ============================================================

-- If payment_status column doesn't have all needed values, update it:
-- ALTER TABLE bookings 
-- MODIFY COLUMN payment_status ENUM('Unpaid', 'Pending', 'Paid', 'Failed', 'Refunded') 
-- DEFAULT 'Unpaid';

-- ============================================================
-- 7. Verify data integrity
-- ============================================================

-- Check for bookings with no entrance fee but have paying guests
SELECT 
  b.booking_id,
  b.booking_reference,
  SUM(bi.paying_guests) as total_paying_guests,
  SUM(bi.entrance_fee) as total_entrance_fee,
  b.entrance_fee as booking_entrance_fee
FROM bookings b
LEFT JOIN booking_items bi ON b.booking_id = bi.booking_id
WHERE b.booking_status IN ('Confirmed', 'Checked-in', 'Completed')
GROUP BY b.booking_id
HAVING total_paying_guests > 0 AND booking_entrance_fee = 0;

-- ============================================================
-- 8. Rollback SQL (if something goes wrong)
-- ============================================================

-- Only run if you need to undo the migration
-- ALTER TABLE bookings DROP COLUMN entrance_fee;
-- ALTER TABLE bookings DROP COLUMN actual_check_in_time;
-- ALTER TABLE bookings DROP COLUMN actual_check_out_time;
-- 
-- ALTER TABLE booking_items DROP COLUMN guest_breakdown;
-- ALTER TABLE booking_items DROP COLUMN paying_guests;
-- ALTER TABLE booking_items DROP COLUMN entrance_fee;
