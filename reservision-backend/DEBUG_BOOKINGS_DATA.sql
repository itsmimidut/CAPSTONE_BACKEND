-- ============================================================
-- DEBUG BOOKINGS DATA - Find why charts show no data
-- ============================================================
-- 
-- Run these queries to diagnose the booking chart data issue
-- 
-- Date: February 24, 2026
-- ============================================================

USE eduardos;

-- ============================================================
-- STEP 1: Check table structure
-- ============================================================
DESCRIBE booking_items;
-- Look at the item_type ENUM values - should be: Room, Cottage, Event, Swimming


-- ============================================================
-- STEP 2: Count total bookings
-- ============================================================
SELECT COUNT(*) as total_bookings FROM bookings;


-- ============================================================
-- STEP 3: Check booking statuses
-- ============================================================
SELECT 
    booking_status,
    COUNT(*) as count
FROM bookings
GROUP BY booking_status;


-- ============================================================
-- STEP 4: Check what item_types exist in your data
-- ============================================================
SELECT 
    item_type,
    COUNT(*) as count
FROM booking_items
GROUP BY item_type;
-- This shows what categories you actually have bookings for


-- ============================================================
-- STEP 5: Check booking dates (to see if they're in current month)
-- ============================================================
SELECT 
    DATE(created_at) as booking_date,
    booking_status,
    COUNT(*) as count
FROM bookings
GROUP BY DATE(created_at), booking_status
ORDER BY booking_date DESC
LIMIT 20;


-- ============================================================
-- STEP 6: Check the exact data the analytics endpoint uses
-- ============================================================
-- This is the EXACT query your backend runs for the chart
SELECT 
    bi.item_type,
    COUNT(DISTINCT bi.booking_id) as count
FROM booking_items bi
JOIN bookings b ON bi.booking_id = b.booking_id
WHERE b.booking_status != 'Cancelled'
AND DATE(b.created_at) BETWEEN 
    DATE_FORMAT(NOW(), '%Y-%m-01')  -- First day of current month
    AND LAST_DAY(NOW())              -- Last day of current month
GROUP BY bi.item_type
ORDER BY count DESC;


-- ============================================================
-- STEP 7: Check all bookings with their items (detailed view)
-- ============================================================
SELECT 
    b.booking_id,
    b.booking_reference,
    b.booking_status,
    DATE(b.created_at) as created_date,
    bi.item_type,
    bi.item_name,
    bi.quantity
FROM bookings b
LEFT JOIN booking_items bi ON b.booking_id = bi.booking_id
ORDER BY b.created_at DESC
LIMIT 20;


-- ============================================================
-- STEP 8: Check if there are bookings but no booking_items
-- ============================================================
SELECT 
    'Bookings without items' as issue,
    COUNT(*) as count
FROM bookings b
LEFT JOIN booking_items bi ON b.booking_id = bi.booking_id
WHERE bi.item_id IS NULL;


-- ============================================================
-- STEP 9: Check date range for all bookings
-- ============================================================
SELECT 
    MIN(DATE(created_at)) as earliest_booking,
    MAX(DATE(created_at)) as latest_booking,
    COUNT(*) as total_bookings
FROM bookings;


-- ============================================================
-- STEP 10: Get sample data (last 10 bookings with all details)
-- ============================================================
SELECT 
    b.booking_id,
    b.booking_reference,
    b.booking_status,
    b.created_at,
    b.check_in_date,
    b.check_out_date,
    b.total_amount,
    GROUP_CONCAT(
        CONCAT(bi.item_type, ': ', bi.item_name, ' (', bi.quantity, ')')
        SEPARATOR ' | '
    ) as items
FROM bookings b
LEFT JOIN booking_items bi ON b.booking_id = bi.booking_id
GROUP BY b.booking_id
ORDER BY b.created_at DESC
LIMIT 10;


-- ============================================================
-- COMMON ISSUES AND FIXES
-- ============================================================

-- ISSUE 1: Wrong item_type values in database (e.g., 'food' instead of 'Food')
-- Check:
SELECT DISTINCT item_type FROM booking_items;

-- ISSUE 2: All bookings are cancelled
-- Check:
SELECT booking_status, COUNT(*) FROM bookings GROUP BY booking_status;

-- ISSUE 3: Bookings are from different months
-- Check:
SELECT 
    DATE_FORMAT(created_at, '%Y-%m') as month,
    COUNT(*) as count
FROM bookings
GROUP BY month
ORDER BY month DESC;

-- ISSUE 4: No booking_items linked to bookings
-- Check:
SELECT 
    (SELECT COUNT(*) FROM bookings) as total_bookings,
    (SELECT COUNT(DISTINCT booking_id) FROM booking_items) as bookings_with_items;


-- ============================================================
-- QUICK FIX: If item_type enum is wrong, update it
-- ============================================================
-- Uncomment and run this if the ENUM is still set to old values:
-- ALTER TABLE booking_items 
-- MODIFY COLUMN item_type ENUM('Room', 'Cottage', 'Event', 'Swimming') NOT NULL;


-- ============================================================
-- QUICK FIX: If you need test data
-- ============================================================
-- Uncomment to create sample bookings for testing:
/*
INSERT INTO bookings (user_id, booking_reference, booking_status, total_amount, created_at, check_in_date, check_out_date)
VALUES 
(1, 'BK-TEST-001', 'Confirmed', 5000.00, NOW(), CURDATE(), DATE_ADD(CURDATE(), INTERVAL 2 DAY)),
(1, 'BK-TEST-002', 'Confirmed', 3000.00, NOW(), CURDATE(), DATE_ADD(CURDATE(), INTERVAL 1 DAY)),
(1, 'BK-TEST-003', 'Confirmed', 8000.00, NOW(), CURDATE(), DATE_ADD(CURDATE(), INTERVAL 3 DAY));

-- Get the last inserted booking IDs
SET @booking1 = (SELECT booking_id FROM bookings WHERE booking_reference = 'BK-TEST-001');
SET @booking2 = (SELECT booking_id FROM bookings WHERE booking_reference = 'BK-TEST-002');
SET @booking3 = (SELECT booking_id FROM bookings WHERE booking_reference = 'BK-TEST-003');

INSERT INTO booking_items (booking_id, item_type, item_name, unit_price, quantity, total_price)
VALUES 
(@booking1, 'Room', 'Deluxe Room', 2500.00, 1, 5000.00),
(@booking2, 'Cottage', 'Family Cottage', 3000.00, 1, 3000.00),
(@booking3, 'Swimming', 'Swimming Pool Access', 500.00, 4, 2000.00),
(@booking3, 'Event', 'Birthday Package', 6000.00, 1, 6000.00);
*/
