CREATE TABLE IF NOT EXISTS pos_printers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  model VARCHAR(100) DEFAULT NULL,
  interface_type ENUM('usb', 'ethernet', 'bluetooth') NOT NULL DEFAULT 'usb',
  windows_printer_name VARCHAR(150) DEFAULT NULL,
  ip_address VARCHAR(100) DEFAULT NULL,
  port INT DEFAULT 9100,
  bluetooth_device_name VARCHAR(150) DEFAULT NULL,
  bluetooth_device_id VARCHAR(150) DEFAULT NULL,
  paper_width ENUM('58', '72', '80') DEFAULT '58',
  print_mode ENUM('escpos', 'graphic') DEFAULT 'escpos',
  print_resolution VARCHAR(50) DEFAULT '203dpi',
  initial_commands TEXT DEFAULT NULL,
  cutter_commands TEXT DEFAULT NULL,
  drawer_commands TEXT DEFAULT NULL,
  print_receipts TINYINT DEFAULT 1,
  print_orders TINYINT DEFAULT 1,
  auto_print_receipt TINYINT DEFAULT 1,
  single_item_per_order_ticket TINYINT DEFAULT 0,
  group_identical_items TINYINT DEFAULT 1,
  usage_type ENUM('receipt', 'kitchen', 'bar', 'general') DEFAULT 'receipt',
  station_id INT DEFAULT NULL,
  is_default TINYINT DEFAULT 0,
  is_active TINYINT DEFAULT 1,
  last_test_at DATETIME DEFAULT NULL,
  last_test_status ENUM('success', 'failed', 'unknown') DEFAULT 'unknown',
  last_error TEXT DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS receipt_settings (
  id INT PRIMARY KEY DEFAULT 1,
  store_name VARCHAR(150) DEFAULT 'Reservision',
  printed_logo VARCHAR(255) DEFAULT NULL,
  emailed_logo VARCHAR(255) DEFAULT NULL,
  header_text TEXT DEFAULT NULL,
  footer_text TEXT DEFAULT NULL,
  show_customer_info TINYINT DEFAULT 1,
  show_comments TINYINT DEFAULT 0,
  receipt_language VARCHAR(50) DEFAULT 'English',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO receipt_settings (
  id,
  store_name,
  header_text,
  footer_text,
  show_customer_info,
  show_comments,
  receipt_language
)
VALUES (
  1,
  'Reservision',
  'Brgy. Nag-Iba II, Calapan City\nSitio Labasan\nTel# 099956391671',
  'This receipt is for inventory purposes only!\nThank you for Coming!',
  1,
  0,
  'English'
)
ON DUPLICATE KEY UPDATE id = id;
