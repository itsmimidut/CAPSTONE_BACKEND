-- ============================================================
-- INSERT TEST DATA FOR SWIMMING ENROLLMENT UI
-- ============================================================
-- This script adds test data to demonstrate all enrollment states
-- Uses existing coaches from swimming_coaches table

-- Get existing coaches from database
-- Using coaches 1, 2, 3 which already exist in swimming_coaches table

-- Step 1: Get coach IDs (these already exist in swimming_coaches)
SET @coach_id_1 = 1;  -- Coach Maria Santos
SET @coach_id_2 = 2;  -- Coach Juan Dela Cruz
SET @coach_id_3 = 3;  -- Coach Sarah Reyes

-- Step 2: Insert swimming batch (if not exists)
INSERT INTO swimming_batches (batch_name, start_date, end_date, status, description, created_at)
VALUES ('BATCH A - May 2026', '2026-05-10', '2026-06-10', 'Active', 'Advanced swimming lessons for kids', NOW())
ON DUPLICATE KEY UPDATE batch_id=LAST_INSERT_ID(batch_id);

SET @batch_id_1 = LAST_INSERT_ID();

-- Step 3: Insert swimming batch schedule
INSERT INTO swimming_batch_schedules (batch_id, coach_id, class_period, start_time, end_time, max_slots, status, created_at)
VALUES (@batch_id_1, @coach_id_1, 'AM', '09:00:00', '10:00:00', 5, 'Open', NOW())
ON DUPLICATE KEY UPDATE schedule_id=LAST_INSERT_ID(schedule_id);

SET @schedule_id_1 = LAST_INSERT_ID();

-- Step 4: Insert test customer (if not exists)
INSERT INTO customers (first_name, last_name, email, phone, date_of_birth, country, state, city, address, role, created_at)
VALUES ('Test', 'Customer', 'test.customer@email.com', '09171234567', '2015-05-15', 'Philippines', 'Oriental Mindoro', 'Calapan City', 'Nautical Highway, Bayanan I', 'Customer', NOW())
ON DUPLICATE KEY UPDATE customer_id=LAST_INSERT_ID(customer_id);

SET @customer_id_1 = LAST_INSERT_ID();

-- Step 5: Insert paid swimming booking
INSERT INTO bookings (customer_id, booking_reference, booking_date, payment_status, payment_method, total_amount, created_at)
VALUES (@customer_id_1, 'EDU16864909', NOW(), 'Paid', 'Cash', 3000.00, NOW())
ON DUPLICATE KEY UPDATE booking_id=LAST_INSERT_ID(booking_id);

SET @booking_id_1 = LAST_INSERT_ID();

-- Step 6: Insert booking item (swimming program)
INSERT INTO booking_items (booking_id, item_type, item_name, unit_price, quantity, guests, batch_id, schedule_id, coach_id, created_at)
VALUES (@booking_id_1, 'Swimming', 'Advanced Swimming Lessons', 3000.00, 1, 1, @batch_id_1, @schedule_id_1, @coach_id_1, NOW());

-- ============================================================
-- EXISTING ENROLLMENTS FOR TESTING
-- ============================================================

-- Test Case 1: APPROVED Enrollment (locked state)
INSERT INTO swimming_enrollments (
  booking_reference, batch_id, schedule_id, coach_id,
  first_name, middle_name, last_name, date_of_birth,
  sex, weight, height, address, mobile_phone, email,
  father_name, mother_name,
  emergency_contact_name, emergency_contact_phone,
  physician_phone, lesson_type, skill_level, rate_amount,
  preferred_coach, agreed_to_terms, agreed_to_waiver,
  enrollment_status, payment_status, created_at
) VALUES (
  'EDU16864909', @batch_id_1, @schedule_id_1, @coach_id_1,
  'Test', 'S.', 'Customer', '2015-05-15',
  'Male', '35', '140', 'Nautical Highway, Bayanan I, Calapan City', '09171234567', 'test.customer@email.com',
  'Juan Customer', 'Maria Customer',
  'Juan Customer', '09171234567',
  '09171234567', 'Advanced Swimming Lessons', 'Advanced', 3000.00,
  'Coach Maria Santos', 1, 1,
  'Approved', 'Paid', NOW()
)
ON DUPLICATE KEY UPDATE enrollment_id=LAST_INSERT_ID(enrollment_id);

-- Test Case 2: PENDING Enrollment (allow edit)
INSERT INTO swimming_batches (batch_name, start_date, end_date, status, description, created_at)
VALUES ('BATCH B - June 2026', '2026-06-15', '2026-07-15', 'Active', 'Beginner swimming lessons', NOW())
ON DUPLICATE KEY UPDATE batch_id=LAST_INSERT_ID(batch_id);

SET @batch_id_2 = LAST_INSERT_ID();

INSERT INTO swimming_batch_schedules (batch_id, coach_id, class_period, start_time, end_time, max_slots, status, created_at)
VALUES (@batch_id_2, @coach_id_2, 'PM', '14:00:00', '15:00:00', 5, 'Open', NOW());

SET @schedule_id_2 = LAST_INSERT_ID();

INSERT INTO customers (first_name, last_name, email, phone, date_of_birth, country, state, city, address, role, created_at)
VALUES ('Pending', 'Student', 'pending.student@email.com', '09191234567', '2016-03-20', 'Philippines', 'Oriental Mindoro', 'Calapan City', 'Nautical Highway', 'Customer', NOW())
ON DUPLICATE KEY UPDATE customer_id=LAST_INSERT_ID(customer_id);

SET @customer_id_2 = LAST_INSERT_ID();

INSERT INTO bookings (customer_id, booking_reference, booking_date, payment_status, payment_method, total_amount, created_at)
VALUES (@customer_id_2, 'EDU16864910', NOW(), 'Paid', 'Cash', 3000.00, NOW())
ON DUPLICATE KEY UPDATE booking_id=LAST_INSERT_ID(booking_id);

SET @booking_id_2 = LAST_INSERT_ID();

INSERT INTO booking_items (booking_id, item_type, item_name, unit_price, quantity, guests, batch_id, schedule_id, coach_id, created_at)
VALUES (@booking_id_2, 'Swimming', 'Beginner Swimming Lessons', 3000.00, 1, 1, @batch_id_2, @schedule_id_2, @coach_id_2, NOW());

INSERT INTO swimming_enrollments (
  booking_reference, batch_id, schedule_id, coach_id,
  first_name, middle_name, last_name, date_of_birth,
  sex, weight, height, address, mobile_phone, email,
  father_name, mother_name,
  emergency_contact_name, emergency_contact_phone,
  physician_phone, lesson_type, skill_level, rate_amount,
  preferred_coach, agreed_to_terms, agreed_to_waiver,
  enrollment_status, payment_status, created_at
) VALUES (
  'EDU16864910', @batch_id_2, @schedule_id_2, @coach_id_2,
  'Pending', 'Test', 'Student', '2016-03-20',
  'Female', '38', '145', 'Nautical Highway', '09191234567', 'pending.student@email.com',
  'Antonio Student', 'Rosa Student',
  'Antonio Student', '09191234567',
  '09191234567', 'Beginner Swimming Lessons', 'Beginner', 3000.00,
  'Coach Juan Dela Cruz', 1, 1,
  'Pending', 'Paid', NOW()
);

-- Test Case 3: REJECTED Enrollment (with rejection reason)
INSERT INTO swimming_batches (batch_name, start_date, end_date, status, description, created_at)
VALUES ('BATCH C - July 2026', '2026-07-20', '2026-08-20', 'Active', 'Intermediate swimming lessons', NOW())
ON DUPLICATE KEY UPDATE batch_id=LAST_INSERT_ID(batch_id);

SET @batch_id_3 = LAST_INSERT_ID();

INSERT INTO swimming_batch_schedules (batch_id, coach_id, class_period, start_time, end_time, max_slots, status, created_at)
VALUES (@batch_id_3, @coach_id_3, 'AM', '10:00:00', '11:00:00', 5, 'Open', NOW());

SET @schedule_id_3 = LAST_INSERT_ID();

INSERT INTO customers (first_name, last_name, email, phone, date_of_birth, country, state, city, address, role, created_at)
VALUES ('Rejected', 'Applicant', 'rejected.applicant@email.com', '09211234567', '2014-07-10', 'Philippines', 'Oriental Mindoro', 'Calapan City', 'Nautical Highway', 'Customer', NOW())
ON DUPLICATE KEY UPDATE customer_id=LAST_INSERT_ID(customer_id);

SET @customer_id_3 = LAST_INSERT_ID();

INSERT INTO bookings (customer_id, booking_reference, booking_date, payment_status, payment_method, total_amount, created_at)
VALUES (@customer_id_3, 'EDU16864911', NOW(), 'Paid', 'Cash', 3000.00, NOW())
ON DUPLICATE KEY UPDATE booking_id=LAST_INSERT_ID(booking_id);

SET @booking_id_3 = LAST_INSERT_ID();

INSERT INTO booking_items (booking_id, item_type, item_name, unit_price, quantity, guests, batch_id, schedule_id, coach_id, created_at)
VALUES (@booking_id_3, 'Swimming', 'Intermediate Swimming Lessons', 3000.00, 1, 1, @batch_id_3, @schedule_id_3, @coach_id_3, NOW());

INSERT INTO swimming_enrollments (
  booking_reference, batch_id, schedule_id, coach_id,
  first_name, middle_name, last_name, date_of_birth,
  sex, weight, height, address, mobile_phone, email,
  father_name, mother_name,
  emergency_contact_name, emergency_contact_phone,
  physician_phone, lesson_type, skill_level, rate_amount,
  preferred_coach, agreed_to_terms, agreed_to_waiver,
  enrollment_status, payment_status, rejection_reason, created_at
) VALUES (
  'EDU16864911', @batch_id_3, @schedule_id_3, @coach_id_3,
  'Rejected', 'Test', 'Applicant', '2014-07-10',
  'Male', '42', '155', 'Nautical Highway', '09211234567', 'rejected.applicant@email.com',
  'Carlos Applicant', 'Monica Applicant',
  'Carlos Applicant', '09211234567',
  '09211234567', 'Intermediate Swimming Lessons', 'Intermediate', 3000.00,
  'Coach Sarah Reyes', 1, 1,
  'Rejected', 'Paid', 'Age exceeds program requirement. Maximum age is 18 years old.', NOW()
);

-- ============================================================
-- RESULTS
-- ============================================================
-- Use these booking references to test:
-- 
-- 1. APPROVED (locked): EDU16864909
--    - Shows enrolled state with green checkmark
--    - All fields disabled/readonly
--    - Shows "View My Enrollment" and "Download Form" buttons
--
-- 2. PENDING (editable): EDU16864910
--    - Shows enrollment status card with yellow clock icon
--    - Fields are editable
--    - Shows "Update Enrollment" button
--
-- 3. REJECTED (editable): EDU16864911
--    - Shows enrollment status card with red exclamation
--    - Displays rejection reason
--    - Fields are editable
--    - Shows "Resubmit Enrollment" button
--
-- ============================================================

SELECT 'Test data inserted successfully!' as status;
SELECT booking_reference, enrollment_status, payment_status FROM swimming_enrollments WHERE booking_reference LIKE 'EDU168649%' ORDER BY created_at DESC;

