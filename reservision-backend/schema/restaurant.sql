-- Restaurant Management Tables

-- Tables in the restaurant
CREATE TABLE IF NOT EXISTS restaurant_tables (
  table_id INT PRIMARY KEY AUTO_INCREMENT,
  table_number INT NOT NULL UNIQUE,
  capacity INT NOT NULL,
  status ENUM('available', 'occupied', 'reserved', 'maintenance') DEFAULT 'available',
  guests INT DEFAULT 0,
  ordered_time DATETIME NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Menu Items
CREATE TABLE IF NOT EXISTS menu_items (
  menu_id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  price DECIMAL(10, 2) NOT NULL,
  category VARCHAR(100) NOT NULL,
  available BOOLEAN DEFAULT TRUE,
  prep_time INT DEFAULT 15,
  description TEXT,
  image_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
  order_id INT PRIMARY KEY AUTO_INCREMENT,
  table_id INT NOT NULL,
  status ENUM('pending', 'preparing', 'ready', 'served', 'completed', 'cancelled') DEFAULT 'pending',
  special_requests TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (table_id) REFERENCES restaurant_tables(table_id) ON DELETE CASCADE
);

-- Order Items (items in an order)
CREATE TABLE IF NOT EXISTS order_items (
  order_item_id INT PRIMARY KEY AUTO_INCREMENT,
  order_id INT NOT NULL,
  menu_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_price DECIMAL(10, 2) NOT NULL,
  special_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
  FOREIGN KEY (menu_id) REFERENCES menu_items(menu_id) ON DELETE CASCADE
);

-- Inventory
CREATE TABLE IF NOT EXISTS inventory (
  inventory_id INT PRIMARY KEY AUTO_INCREMENT,
  item_name VARCHAR(255) NOT NULL UNIQUE,
  quantity DECIMAL(10, 2) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  threshold DECIMAL(10, 2) NOT NULL,
  status ENUM('good', 'low', 'critical') DEFAULT 'good',
  last_restocked TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert sample data
INSERT INTO restaurant_tables (table_number, capacity, status, guests, ordered_time, notes) VALUES
('1', 4, 'occupied', 4, NOW(), ''),
('2', 2, 'available', 0, NULL, ''),
('3', 6, 'occupied', 3, NOW(), 'Birthday'),
('4', 4, 'reserved', 0, DATE_ADD(NOW(), INTERVAL 1 HOUR), 'Reservation');

-- Test menu items removed - add your own items through the admin panel
-- INSERT INTO menu_items (name, price, category, available, prep_time) VALUES
-- ('Caesar Salad', 320, 'Appetizers', TRUE, 5),
-- ('Grilled Salmon', 580, 'Seafood', TRUE, 25),
-- ('Spaghetti Carbonara', 450, 'Pasta', FALSE, 20),
-- ('Margherita Pizza', 380, 'Pasta', TRUE, 15),
-- ('Chocolate Cake', 180, 'Desserts', TRUE, 5);

INSERT INTO orders (table_id, status, special_requests) VALUES
(1, 'preparing', 'No croutons'),
(3, 'ready', 'Extra cheese'),
(1, 'pending', '');

INSERT INTO order_items (order_id, menu_id, quantity, unit_price) VALUES
(1, 1, 2, 320),
(1, 2, 1, 580),
(2, 3, 3, 450),
(2, 4, 1, 380),
(3, 5, 2, 180);

INSERT INTO inventory (item_name, quantity, unit, threshold, status) VALUES
('Salmon Fillet', 8, 'kg', 10, 'low'),
('Pasta (Spaghetti)', 25, 'kg', 15, 'good'),
('Tomato Sauce', 5, 'L', 10, 'low'),
('Mozzarella Cheese', 12, 'kg', 8, 'good');
