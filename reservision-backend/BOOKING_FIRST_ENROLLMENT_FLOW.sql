-- ============================================================
-- BOOKING-FIRST ENROLLMENT FLOW
-- ============================================================
-- 
-- CORRECT FLOW:
-- 1. Customer books swimming package on Reservation page
--    - Selects dates, time, participant count
--    - Pays for the package
--    - Receives booking_reference (e.g., SWM12345678)
-- 
-- 2. Students enroll using the booking_reference
--    - Each student fills enrollment form on Swimming page
--    - Provides booking_reference from Step 1
--    - System validates enrollment count vs. paid participants
--    - Creates enrollment record linked to booking
-- 
-- 3. System creates session schedules (auto or admin-triggered)
--    - Creates schedule records for each date
--    - Links enrolled students to each session
-- 
-- ============================================================

-- ============================================================
-- STEP 1: Update swimming_enrollments to include booking_id
-- ============================================================

ALTER TABLE swimming_enrollments 
ADD COLUMN IF NOT EXISTS booking_id INT(11) DEFAULT NULL COMMENT 'Links to booking that paid for this enrollment',
ADD INDEX IF NOT EXISTS idx_swimming_enrollments_booking (booking_id),
ADD CONSTRAINT fk_swimming_enrollments_booking 
  FOREIGN KEY (booking_id) 
  REFERENCES bookings (booking_id) 
  ON DELETE SET NULL;

-- ============================================================
-- STEP 2: Query to validate enrollment capacity
-- ============================================================
-- Use this to check if a booking can accept more enrollments

DELIMITER $$

CREATE PROCEDURE sp_check_enrollment_capacity(
  IN p_booking_reference VARCHAR(50),
  OUT p_paid_slots INT,
  OUT p_enrolled_count INT,
  OUT p_available_slots INT,
  OUT p_can_enroll BOOLEAN
)
BEGIN
  SELECT 
    bi.participants,
    COUNT(se.enrollment_id),
    (bi.participants - COUNT(se.enrollment_id)),
    (bi.participants - COUNT(se.enrollment_id)) > 0
  INTO 
    p_paid_slots,
    p_enrolled_count,
    p_available_slots,
    p_can_enroll
  FROM bookings b
  JOIN booking_items bi ON b.booking_id = bi.booking_id
  LEFT JOIN swimming_enrollments se ON b.booking_id = se.booking_id
  WHERE b.booking_reference = p_booking_reference
    AND bi.item LIKE '%Swimming%'
  GROUP BY bi.booking_item_id
  LIMIT 1;
END$$

DELIMITER ;

-- ============================================================
-- STEP 3: Sample enrollment validation query (for API)
-- ============================================================

-- Example: Check if booking SWM12345678 can accept new enrollment
SELECT 
  b.booking_id,
  b.booking_reference,
  b.customer_id,
  CONCAT(c.first_name, ' ', c.last_name) as booker_name,
  bi.participants as paid_slots,
  COUNT(se.enrollment_id) as enrolled_count,
  (bi.participants - COUNT(se.enrollment_id)) as available_slots,
  CASE 
    WHEN COUNT(se.enrollment_id) < bi.participants THEN 'Can enroll'
    ELSE 'Booking full'
  END as enrollment_status
FROM bookings b
JOIN booking_items bi ON b.booking_id = bi.booking_id
JOIN customers c ON b.customer_id = c.customer_id
LEFT JOIN swimming_enrollments se ON b.booking_id = se.booking_id
WHERE b.booking_reference = 'SWM12345678'
  AND bi.item LIKE '%Swimming%'
GROUP BY b.booking_id, bi.booking_item_id;

-- ============================================================
-- STEP 4: Create enrollment record (sample insert)
-- ============================================================

-- When student enrolls using booking reference
INSERT INTO swimming_enrollments (
  booking_id,  -- ← Links to the booking
  student_name,
  age,
  parent_guardian_name,
  parent_guardian_contact,
  medical_conditions,
  emergency_contact_name,
  emergency_contact_phone,
  skill_level,
  lesson_type,
  created_at
)
SELECT 
  b.booking_id,
  'Juan Dela Cruz',  -- Student info from enrollment form
  8,
  'Maria Dela Cruz',
  '09123456789',
  'None',
  'Rosa Dela Cruz',
  '09187654321',
  'Beginner',
  bi.item,
  NOW()
FROM bookings b
JOIN booking_items bi ON b.booking_id = bi.booking_id
WHERE b.booking_reference = 'SWM12345678'
  AND bi.item LIKE '%Swimming%'
  -- Validate capacity first
  AND (
    SELECT COUNT(*) 
    FROM swimming_enrollments 
    WHERE booking_id = b.booking_id
  ) < bi.participants
LIMIT 1;

-- ============================================================
-- STEP 5: View all enrollments for a booking
-- ============================================================

SELECT 
  b.booking_reference,
  b.total_price,
  bi.participants as paid_for,
  COUNT(se.enrollment_id) as enrolled,
  (bi.participants - COUNT(se.enrollment_id)) as remaining_slots,
  GROUP_CONCAT(se.student_name ORDER BY se.created_at SEPARATOR ', ') as enrolled_students
FROM bookings b
JOIN booking_items bi ON b.booking_id = bi.booking_id
LEFT JOIN swimming_enrollments se ON b.booking_id = se.booking_id
WHERE b.booking_reference = 'SWM12345678'
GROUP BY b.booking_id, bi.booking_item_id;

-- ============================================================
-- STEP 6: Extract dates from booking_items for schedule creation
-- ============================================================

-- When all students enrolled, create session schedules
-- Note: booking_items may store dates in JSON or comma-separated format
-- Adjust based on your actual schema

-- Example if dates stored in separate `booking_swimming_details` table:
INSERT INTO swimming_session_schedules (
  booking_id,
  customer_id,
  session_date,
  session_time,
  lesson_type,
  status
)
SELECT 
  b.booking_id,
  b.customer_id,
  bsd.session_date,  -- Assuming dates stored here
  bsd.session_time,
  bi.item,
  'Scheduled'
FROM bookings b
JOIN booking_items bi ON b.booking_id = bi.booking_id
JOIN booking_swimming_details bsd ON bi.booking_item_id = bsd.booking_item_id  -- Adjust table name
WHERE b.booking_reference = 'SWM12345678';

-- ============================================================
-- STEP 7: Link enrolled students to each session
-- ============================================================

-- After creating schedules, link all enrolled students to each session
INSERT INTO swimming_session_participants (
  schedule_id,
  enrollment_id
)
SELECT 
  ss.schedule_id,
  se.enrollment_id
FROM swimming_session_schedules ss
CROSS JOIN swimming_enrollments se  -- Link all enrollments to all sessions
WHERE ss.booking_id = se.booking_id
  AND ss.booking_id = (
    SELECT booking_id FROM bookings WHERE booking_reference = 'SWM12345678'
  );

-- ============================================================
-- EXAMPLE SCENARIO
-- ============================================================

/*
STEP 1: Teacher books swimming package
- Teacher Ana Rodriguez books for 3 students
- Selects 10 dates (March 1, 5, 8, 12, 15, 19, 22, 26, 29, April 2)
- Time: 8:00 AM - 9:00 AM
- Pays ₱11,000
- Receives booking_reference: SWM12345678

RESULT:
  bookings table:
    booking_id: 789
    booking_reference: 'SWM12345678'
    customer_id: 456 (Teacher Ana)
    total_price: 11000
    
  booking_items table:
    booking_item_id: 234
    booking_id: 789
    item: 'Swimming Package - 7 Years & Above'
    participants: 3  ← PAID FOR 3 STUDENTS

---

STEP 2: Students enroll using SWM12345678

Enrollment 1:
  booking_reference: SWM12345678
  student_name: Juan Dela Cruz
  age: 8
  → System checks: 0/3 enrolled, can accept ✅
  → Creates enrollment_id: 101

Enrollment 2:
  booking_reference: SWM12345678
  student_name: Pedro Santos
  age: 9
  → System checks: 1/3 enrolled, can accept ✅
  → Creates enrollment_id: 102

Enrollment 3:
  booking_reference: SWM12345678
  student_name: Anna Reyes
  age: 7
  → System checks: 2/3 enrolled, can accept ✅
  → Creates enrollment_id: 103

Enrollment 4 (REJECTED):
  booking_reference: SWM12345678
  student_name: Sofia Cruz
  age: 8
  → System checks: 3/3 enrolled, FULL ❌
  → Error: "Booking SWM12345678 is full. Paid for 3 participants, all slots used."

RESULT:
  swimming_enrollments table:
    enrollment_id: 101, booking_id: 789, student_name: Juan Dela Cruz
    enrollment_id: 102, booking_id: 789, student_name: Pedro Santos
    enrollment_id: 103, booking_id: 789, student_name: Anna Reyes

---

STEP 3: System creates session schedules (10 sessions)

swimming_session_schedules:
  schedule_id: 1, booking_id: 789, session_date: 2026-03-01
  schedule_id: 2, booking_id: 789, session_date: 2026-03-05
  schedule_id: 3, booking_id: 789, session_date: 2026-03-08
  ... (7 more dates)

---

STEP 4: Link students to each session (30 participant records)

swimming_session_participants:
  -- March 1 session
  schedule_id: 1, enrollment_id: 101 (Juan)
  schedule_id: 1, enrollment_id: 102 (Pedro)
  schedule_id: 1, enrollment_id: 103 (Anna)
  
  -- March 5 session
  schedule_id: 2, enrollment_id: 101 (Juan)
  schedule_id: 2, enrollment_id: 102 (Pedro)
  schedule_id: 2, enrollment_id: 103 (Anna)
  
  ... (8 more sessions × 3 students = 24 more records)

---

QUERY: Who's enrolled for March 1?

SELECT 
  ss.session_date,
  ss.session_time,
  se.student_name,
  se.age,
  se.parent_guardian_name
FROM swimming_session_schedules ss
JOIN swimming_session_participants sp ON ss.schedule_id = sp.schedule_id
JOIN swimming_enrollments se ON sp.enrollment_id = se.enrollment_id
WHERE ss.session_date = '2026-03-01'
ORDER BY se.student_name;

RESULT:
  session_date  | session_time    | student_name    | age | parent_guardian_name
  2026-03-01    | 8:00 AM - 9:00  | Anna Reyes      | 7   | Jose Reyes
  2026-03-01    | 8:00 AM - 9:00  | Juan Dela Cruz  | 8   | Maria Dela Cruz
  2026-03-01    | 8:00 AM - 9:00  | Pedro Santos    | 9   | Rosa Santos

*/

-- ============================================================
-- USEFUL VALIDATION QUERIES
-- ============================================================

-- Check booking enrollment status
SELECT 
  b.booking_reference,
  bi.participants as 'Paid For',
  COUNT(se.enrollment_id) as 'Enrolled',
  (bi.participants - COUNT(se.enrollment_id)) as 'Slots Left'
FROM bookings b
JOIN booking_items bi ON b.booking_id = bi.booking_id
LEFT JOIN swimming_enrollments se ON b.booking_id = se.booking_id
WHERE b.booking_reference = 'SWM12345678'
GROUP BY b.booking_id;

-- List all enrolled students for a booking
SELECT 
  se.enrollment_id,
  se.student_name,
  se.age,
  se.created_at as enrolled_at
FROM swimming_enrollments se
JOIN bookings b ON se.booking_id = b.booking_id
WHERE b.booking_reference = 'SWM12345678'
ORDER BY se.created_at;

-- Check if specific student already enrolled for booking
SELECT 
  COUNT(*) as already_enrolled
FROM swimming_enrollments se
JOIN bookings b ON se.booking_id = b.booking_id
WHERE b.booking_reference = 'SWM12345678'
  AND se.student_name = 'Juan Dela Cruz';
