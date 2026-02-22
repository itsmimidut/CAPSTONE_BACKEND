-- ============================================================
-- Swimming Class Bookings Table
-- Links enrollments to their scheduled classes
-- ============================================================

CREATE TABLE `swimming_class_bookings` (
  `booking_id` int(11) NOT NULL AUTO_INCREMENT,
  `enrollment_id` int(11) NOT NULL,
  `class_date` date NOT NULL,
  `class_time` time NOT NULL,
  `coach_name` varchar(100) NOT NULL,
  `status` enum('Scheduled','Completed','Cancelled','No-show') DEFAULT 'Scheduled',
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`booking_id`),
  KEY `enrollment_id` (`enrollment_id`),
  KEY `class_date` (`class_date`),
  CONSTRAINT `fk_swimming_class_bookings_enrollment` 
    FOREIGN KEY (`enrollment_id`) 
    REFERENCES `swimming_enrollments` (`enrollment_id`) 
    ON DELETE CASCADE 
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- USAGE EXAMPLES
-- ============================================================

-- Book a class for an enrollment
-- INSERT INTO swimming_class_bookings (enrollment_id, class_date, class_time, coach_name)
-- VALUES (1, '2026-03-01', '14:00:00', 'Coach Maria Santos');

-- Get all classes for an enrollment
-- SELECT * FROM swimming_class_bookings 
-- WHERE enrollment_id = 1 
-- ORDER BY class_date ASC;

-- Get all classes for a coach
-- SELECT * FROM swimming_class_bookings 
-- WHERE coach_name = 'Coach Maria Santos' 
-- AND class_date >= CURDATE()
-- ORDER BY class_date ASC, class_time ASC;

-- Get completed classes
-- SELECT * FROM swimming_class_bookings 
-- WHERE status = 'Completed' 
-- ORDER BY class_date DESC;

-- Mark class as completed
-- UPDATE swimming_class_bookings 
-- SET status = 'Completed' 
-- WHERE booking_id = 1;

-- ============================================================
-- API ENDPOINTS
-- ============================================================

-- POST /api/swimming/class-bookings
-- {
--   "enrollmentId": 1,
--   "classDate": "2026-03-01",
--   "classTime": "14:00:00",
--   "coachName": "Coach Maria Santos",
--   "remarks": "Student seems eager to learn"
-- }

-- GET /api/swimming/class-bookings?enrollmentId=1
-- Returns all class bookings for an enrollment

-- GET /api/swimming/class-bookings/:id
-- Returns specific class booking details

-- PUT /api/swimming/class-bookings/:id
-- {
--   "status": "Completed",
--   "remarks": "Student completed beginner level"
-- }

-- DELETE /api/swimming/class-bookings/:id
-- Deletes a class booking
