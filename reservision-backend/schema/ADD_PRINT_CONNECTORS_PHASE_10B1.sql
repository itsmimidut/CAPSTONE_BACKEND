-- Phase 10B.1: Print Connectors generalization (safe to re-run)
SET @db := DATABASE();

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='print_bridge_devices' AND COLUMN_NAME='device_type')=0,
  "ALTER TABLE print_bridge_devices ADD COLUMN device_type ENUM('windows','android','unknown') DEFAULT 'unknown'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='print_bridge_devices' AND COLUMN_NAME='capabilities')=0,
  'ALTER TABLE print_bridge_devices ADD COLUMN capabilities JSON NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='print_bridge_devices' AND COLUMN_NAME='reported_printers')=0,
  'ALTER TABLE print_bridge_devices ADD COLUMN reported_printers JSON NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='print_bridge_devices' AND COLUMN_NAME='reported_at')=0,
  'ALTER TABLE print_bridge_devices ADD COLUMN reported_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='pos_printers' AND COLUMN_NAME='connector_device_id')=0,
  'ALTER TABLE pos_printers ADD COLUMN connector_device_id INT NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='pos_printers' AND COLUMN_NAME='connection_method')=0,
  "ALTER TABLE pos_printers ADD COLUMN connection_method ENUM('ethernet','windows_printer','bluetooth_serial','android_bluetooth') DEFAULT 'windows_printer'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='pos_printers' AND COLUMN_NAME='com_port')=0,
  'ALTER TABLE pos_printers ADD COLUMN com_port VARCHAR(50) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='pos_printers' AND COLUMN_NAME='baud_rate')=0,
  'ALTER TABLE pos_printers ADD COLUMN baud_rate INT DEFAULT 9600', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
