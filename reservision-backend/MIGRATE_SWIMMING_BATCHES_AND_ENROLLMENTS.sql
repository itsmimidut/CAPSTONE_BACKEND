-- Safe migration for swimming batch-based enrollment model
-- This script creates missing batch tables and adds new enrollment fields.
-- Requires MySQL 8.0.16+ for ADD INDEX IF NOT EXISTS compatibility.

CREATE TABLE IF NOT EXISTS `swimming_batches` (
  `batch_id` INT AUTO_INCREMENT PRIMARY KEY,
  `batch_name` VARCHAR(100) NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `status` ENUM('Open','Full','Closed','Ongoing','Completed') NOT NULL DEFAULT 'Open',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `swimming_batch_schedules` (
  `schedule_id` INT AUTO_INCREMENT PRIMARY KEY,
  `batch_id` INT NOT NULL,
  `coach_id` INT NULL,
  `class_period` ENUM('AM','PM') NOT NULL,
  `start_time` TIME NOT NULL,
  `end_time` TIME NOT NULL,
  `max_slots` INT NOT NULL DEFAULT 10,
  `status` ENUM('Open','Full','Closed') NOT NULL DEFAULT 'Open',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_batch_id (batch_id),
  INDEX idx_coach_id (coach_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

ALTER TABLE `swimming_enrollments`
  ADD COLUMN IF NOT EXISTS `batch_id` INT NULL,
  ADD COLUMN IF NOT EXISTS `schedule_id` INT NULL,
  ADD COLUMN IF NOT EXISTS `coach_id` INT NULL,
  ADD COLUMN IF NOT EXISTS `rate_amount` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS `age_group` ENUM('3-6 years old','7 years old and above') NULL,
  ADD COLUMN IF NOT EXISTS `rejection_reason` TEXT NULL;

ALTER TABLE `swimming_enrollments`
  ADD INDEX IF NOT EXISTS idx_swimming_enrollments_batch (batch_id),
  ADD INDEX IF NOT EXISTS idx_swimming_enrollments_schedule (schedule_id),
  ADD INDEX IF NOT EXISTS idx_swimming_enrollments_coach (coach_id);
