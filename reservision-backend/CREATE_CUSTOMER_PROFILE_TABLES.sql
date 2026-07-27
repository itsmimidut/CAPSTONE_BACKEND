-- Customer Profile Account Center tables

CREATE TABLE IF NOT EXISTS customer_addresses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  label VARCHAR(100) NOT NULL,
  street VARCHAR(255) NOT NULL,
  city VARCHAR(100),
  postal_code VARCHAR(20),
  country VARCHAR(100) DEFAULT 'Philippines',
  is_default TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customer_addresses_customer_id (customer_id)
);

CREATE TABLE IF NOT EXISTS customer_notification_preferences (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL UNIQUE,
  booking_updates TINYINT(1) DEFAULT 1,
  restaurant_orders TINYINT(1) DEFAULT 1,
  shop_orders TINYINT(1) DEFAULT 1,
  activity_updates TINYINT(1) DEFAULT 1,
  promotions TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customer_notif_customer_id (customer_id)
);

CREATE TABLE IF NOT EXISTS customer_viewed_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  order_reference VARCHAR(100) NOT NULL,
  viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_customer_order_view (customer_id, order_reference),
  INDEX idx_customer_viewed_orders_customer_id (customer_id)
);
