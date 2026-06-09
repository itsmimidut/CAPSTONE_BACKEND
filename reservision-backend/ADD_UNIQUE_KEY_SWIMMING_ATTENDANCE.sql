-- Add unique key to swimming_attendance table to prevent duplicate records
-- Run this only if the unique key does not exist yet

ALTER TABLE swimming_attendance
ADD UNIQUE KEY IF NOT EXISTS unique_attendance_record (schedule_id, enrollment_id, attendance_date);