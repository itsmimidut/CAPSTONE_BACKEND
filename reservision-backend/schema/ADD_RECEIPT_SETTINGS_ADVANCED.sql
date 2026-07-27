-- Phase 7: Receipt template advanced settings (safe to re-run)
SET @db := DATABASE();

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='logo_alignment')=0,
  "ALTER TABLE receipt_settings ADD COLUMN logo_alignment ENUM('left','center','right') DEFAULT 'center'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='store_name_style')=0,
  "ALTER TABLE receipt_settings ADD COLUMN store_name_style ENUM('normal','bold','large') DEFAULT 'bold'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='show_receipt_number')=0,
  'ALTER TABLE receipt_settings ADD COLUMN show_receipt_number TINYINT DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='show_datetime')=0,
  'ALTER TABLE receipt_settings ADD COLUMN show_datetime TINYINT DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='show_cashier')=0,
  'ALTER TABLE receipt_settings ADD COLUMN show_cashier TINYINT DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='show_station')=0,
  'ALTER TABLE receipt_settings ADD COLUMN show_station TINYINT DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='show_terminal')=0,
  'ALTER TABLE receipt_settings ADD COLUMN show_terminal TINYINT DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='show_payment_method')=0,
  'ALTER TABLE receipt_settings ADD COLUMN show_payment_method TINYINT DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='show_reference_number')=0,
  'ALTER TABLE receipt_settings ADD COLUMN show_reference_number TINYINT DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='show_discount_line')=0,
  'ALTER TABLE receipt_settings ADD COLUMN show_discount_line TINYINT DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='show_tax_line')=0,
  'ALTER TABLE receipt_settings ADD COLUMN show_tax_line TINYINT DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='show_change_line')=0,
  'ALTER TABLE receipt_settings ADD COLUMN show_change_line TINYINT DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='item_layout')=0,
  "ALTER TABLE receipt_settings ADD COLUMN item_layout ENUM('compact','detailed') DEFAULT 'compact'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='item_name_wrap')=0,
  'ALTER TABLE receipt_settings ADD COLUMN item_name_wrap TINYINT DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='text_size')=0,
  "ALTER TABLE receipt_settings ADD COLUMN text_size ENUM('small','normal','large') DEFAULT 'normal'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='divider_style')=0,
  "ALTER TABLE receipt_settings ADD COLUMN divider_style ENUM('dashed','solid','none') DEFAULT 'dashed'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='default_preview_paper_width')=0,
  "ALTER TABLE receipt_settings ADD COLUMN default_preview_paper_width ENUM('58','80') DEFAULT '58'", 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='receipt_copies')=0,
  'ALTER TABLE receipt_settings ADD COLUMN receipt_copies INT DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='cut_paper_after_print')=0,
  'ALTER TABLE receipt_settings ADD COLUMN cut_paper_after_print TINYINT DEFAULT 1', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='receipt_settings' AND COLUMN_NAME='open_cash_drawer_after_print')=0,
  'ALTER TABLE receipt_settings ADD COLUMN open_cash_drawer_after_print TINYINT DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
