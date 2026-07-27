-- Phase 2: Dynamic printer per print job
-- Safe to run multiple times (checks INFORMATION_SCHEMA before ALTER)

SET @db := DATABASE();

SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'print_jobs' AND COLUMN_NAME = 'printer_id') = 0,
  'ALTER TABLE print_jobs ADD COLUMN printer_id INT NULL AFTER job_file',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'print_jobs' AND COLUMN_NAME = 'printer_name') = 0,
  'ALTER TABLE print_jobs ADD COLUMN printer_name VARCHAR(150) NULL AFTER printer_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'print_jobs' AND COLUMN_NAME = 'printer_interface') = 0,
  "ALTER TABLE print_jobs ADD COLUMN printer_interface ENUM('usb', 'ethernet', 'bluetooth') DEFAULT 'usb' AFTER printer_name",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'print_jobs' AND COLUMN_NAME = 'printer_config') = 0,
  'ALTER TABLE print_jobs ADD COLUMN printer_config JSON NULL AFTER printer_interface',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
