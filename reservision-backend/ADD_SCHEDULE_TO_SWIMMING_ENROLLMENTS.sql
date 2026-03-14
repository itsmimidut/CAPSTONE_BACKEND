-- ============================================================
-- ADD TRAINING SCHEDULE COLUMNS TO SWIMMING_ENROLLMENTS
-- Run this ONCE in your database to enable admin schedule management
-- ============================================================

ALTER TABLE swimming_enrollments 
  ADD COLUMN IF NOT EXISTS admin_lesson_dates JSON NULL COMMENT 'Admin-assigned lesson dates (JSON array)',
  ADD COLUMN IF NOT EXISTS admin_lesson_time  VARCHAR(50)  NULL COMMENT 'Admin-assigned time slot',
  ADD COLUMN IF NOT EXISTS admin_assigned_coach VARCHAR(255) NULL COMMENT 'Admin-assigned coach name';

-- Verify:
-- DESCRIBE swimming_enrollments;
