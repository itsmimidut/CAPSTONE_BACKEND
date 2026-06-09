-- Create swimming_attendance table for instructor attendance tracking
CREATE TABLE IF NOT EXISTS `swimming_attendance` (
  `attendance_id` INT AUTO_INCREMENT PRIMARY KEY,
  `coach_id` INT NOT NULL,
  `schedule_id` INT NOT NULL,
  `batch_id` INT NULL,
  `enrollment_id` INT NULL,
  `attendance_date` DATE NOT NULL,
  `status` ENUM('Present','Absent','Late','Excused') NOT NULL DEFAULT 'Present',
  `remarks` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_coach_date (coach_id, attendance_date),
  INDEX idx_schedule_date (schedule_id, attendance_date),
  INDEX idx_enrollment (enrollment_id),
  UNIQUE KEY unique_attendance_record (schedule_id, enrollment_id, attendance_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;