-- Phase 3: Print job purpose / routing type
SET @db := DATABASE();

SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'print_jobs' AND COLUMN_NAME = 'job_type') = 0,
  "ALTER TABLE print_jobs ADD COLUMN job_type VARCHAR(50) DEFAULT 'receipt' AFTER printer_config",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
