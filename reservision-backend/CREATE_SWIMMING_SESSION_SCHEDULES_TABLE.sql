-- ============================================================
-- Swimming Session Schedules Table
-- Tracks individual swimming sessions with support for group bookings
-- ============================================================

-- Main session schedules table
CREATE TABLE IF NOT EXISTS `swimming_session_schedules` (
  `schedule_id` INT(11) NOT NULL AUTO_INCREMENT,
  `booking_id` INT(11) NOT NULL,
  `customer_id` INT(11) NOT NULL COMMENT 'Who made the booking (teacher/parent)',
  `session_date` DATE NOT NULL,
  `session_time` VARCHAR(50) NOT NULL,
  `lesson_type` VARCHAR(100) NOT NULL,
  `status` ENUM('Scheduled','Completed','Cancelled','No-show') DEFAULT 'Scheduled',
  `coach_assigned` VARCHAR(100) DEFAULT NULL,
  `remarks` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`schedule_id`),
  KEY `booking_id` (`booking_id`),
  KEY `session_date` (`session_date`),
  KEY `customer_id` (`customer_id`),
  CONSTRAINT `fk_swimming_schedules_booking` 
    FOREIGN KEY (`booking_id`) 
    REFERENCES `bookings` (`booking_id`) 
    ON DELETE CASCADE,
  CONSTRAINT `fk_swimming_schedules_customer` 
    FOREIGN KEY (`customer_id`) 
    REFERENCES `customers` (`customer_id`) 
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Swimming Session Participants Table
-- Tracks individual students enrolled in each session
-- ============================================================

CREATE TABLE IF NOT EXISTS `swimming_session_participants` (
  `participant_id` INT(11) NOT NULL AUTO_INCREMENT,
  `schedule_id` INT(11) NOT NULL,
  `student_name` VARCHAR(200) NOT NULL,
  `student_age` INT(11) DEFAULT NULL,
  `student_email` VARCHAR(100) DEFAULT NULL,
  `student_phone` VARCHAR(20) DEFAULT NULL,
  `parent_guardian_name` VARCHAR(200) DEFAULT NULL,
  `parent_guardian_phone` VARCHAR(20) DEFAULT NULL,
  `emergency_contact_name` VARCHAR(200) DEFAULT NULL,
  `emergency_contact_phone` VARCHAR(20) DEFAULT NULL,
  `skill_level` VARCHAR(50) DEFAULT NULL COMMENT 'Beginner, Intermediate, Advanced',
  `medical_notes` TEXT DEFAULT NULL,
  `attendance_status` ENUM('Present','Absent','Excused') DEFAULT NULL,
  `performance_notes` TEXT DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`participant_id`),
  KEY `schedule_id` (`schedule_id`),
  KEY `student_name` (`student_name`),
  CONSTRAINT `fk_swimming_participants_schedule` 
    FOREIGN KEY (`schedule_id`) 
    REFERENCES `swimming_session_schedules` (`schedule_id`) 
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- Indexes for Performance
-- ============================================================

CREATE INDEX idx_session_date_time ON swimming_session_schedules(session_date, session_time);
CREATE INDEX idx_participant_student ON swimming_session_participants(student_name);
CREATE INDEX idx_attendance ON swimming_session_participants(attendance_status);

-- ============================================================
-- USAGE EXAMPLES
-- ============================================================

-- Example 1: Teacher books for 3 students on March 1, 2026
-- Step 1: Create session schedule
-- INSERT INTO swimming_session_schedules (
--   booking_id, customer_id, session_date, session_time, lesson_type, coach_assigned
-- ) VALUES (
--   123, -- booking_id from bookings table
--   456, -- customer_id of the teacher who booked
--   '2026-03-01',
--   '8:00 AM - 9:00 AM',
--   '7 Years Old & Above',
--   'Coach Maria Santos'
-- );
-- -- Returns schedule_id = 1

-- Step 2: Add each student to the session
-- INSERT INTO swimming_session_participants (
--   schedule_id, student_name, student_age, parent_guardian_name, parent_guardian_phone
-- ) VALUES 
--   (1, 'Juan Dela Cruz', 8, 'Maria Dela Cruz', '09123456789'),
--   (1, 'Pedro Santos', 9, 'Rosa Santos', '09187654321'),
--   (1, 'Anna Reyes', 7, 'Jose Reyes', '09156781234');

-- ============================================================
-- QUERY EXAMPLES
-- ============================================================

-- Get all students enrolled on a specific date
-- SELECT 
--   s.session_date,
--   s.session_time,
--   s.lesson_type,
--   s.coach_assigned,
--   p.student_name,
--   p.student_age,
--   p.parent_guardian_name,
--   p.parent_guardian_phone,
--   c.first_name as booked_by_firstname,
--   c.last_name as booked_by_lastname,
--   c.email as booker_email
-- FROM swimming_session_schedules s
-- JOIN swimming_session_participants p ON s.schedule_id = p.schedule_id
-- LEFT JOIN customers c ON s.customer_id = c.customer_id
-- WHERE s.session_date = '2026-03-01'
-- ORDER BY s.session_time, p.student_name;

-- Get all sessions for a specific student
-- SELECT 
--   s.session_date,
--   s.session_time,
--   s.lesson_type,
--   s.status,
--   s.coach_assigned,
--   p.attendance_status,
--   p.performance_notes
-- FROM swimming_session_participants p
-- JOIN swimming_session_schedules s ON p.schedule_id = s.schedule_id
-- WHERE p.student_name = 'Juan Dela Cruz'
-- ORDER BY s.session_date DESC;

-- Get attendance summary for a date
-- SELECT 
--   s.session_date,
--   s.session_time,
--   COUNT(p.participant_id) as total_students,
--   SUM(CASE WHEN p.attendance_status = 'Present' THEN 1 ELSE 0 END) as present,
--   SUM(CASE WHEN p.attendance_status = 'Absent' THEN 1 ELSE 0 END) as absent,
--   SUM(CASE WHEN p.attendance_status = 'Excused' THEN 1 ELSE 0 END) as excused
-- FROM swimming_session_schedules s
-- LEFT JOIN swimming_session_participants p ON s.schedule_id = p.schedule_id
-- WHERE s.session_date = '2026-03-01'
-- GROUP BY s.schedule_id, s.session_date, s.session_time
-- ORDER BY s.session_time;

-- Get daily roster grouped by time slots
-- SELECT 
--   s.session_time,
--   s.coach_assigned,
--   COUNT(p.participant_id) as student_count,
--   GROUP_CONCAT(p.student_name ORDER BY p.student_name SEPARATOR ', ') as students
-- FROM swimming_session_schedules s
-- LEFT JOIN swimming_session_participants p ON s.schedule_id = p.schedule_id
-- WHERE s.session_date = '2026-03-01'
-- GROUP BY s.schedule_id, s.session_time, s.coach_assigned
-- ORDER BY s.session_time;
