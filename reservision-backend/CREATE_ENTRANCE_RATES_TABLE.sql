-- Entrance Rates Configuration Table
CREATE TABLE IF NOT EXISTS entrance_rates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL COMMENT 'e.g. Adult, Child, Senior',
  price DECIMAL(10, 2) NOT NULL COMMENT 'Rate per head in PHP',
  age_min INT NULLABLE COMMENT 'Minimum age for this rate',
  age_max INT NULLABLE COMMENT 'Maximum age for this rate',
  day_type ENUM('weekday', 'weekend', 'holiday') NOT NULL DEFAULT 'weekday',
  start_time TIME NULLABLE COMMENT 'Start time for rate (optional)',
  end_time TIME NULLABLE COMMENT 'End time for rate (optional)',
  status ENUM('active', 'hidden') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_day_type (day_type),
  INDEX idx_status (status),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sample data
INSERT INTO entrance_rates (name, price, age_min, age_max, day_type, status) VALUES
('Adult', 500.00, 18, 59, 'weekday', 'active'),
('Adult Weekend', 650.00, 18, 59, 'weekend', 'active'),
('Adult Holiday', 750.00, 18, 59, 'holiday', 'active'),
('Child', 300.00, 5, 17, 'weekday', 'active'),
('Child Weekend', 400.00, 5, 17, 'weekend', 'active'),
('Child Holiday', 500.00, 5, 17, 'holiday', 'active'),
('Senior', 400.00, 60, 120, 'weekday', 'active'),
('Senior Weekend', 500.00, 60, 120, 'weekend', 'active'),
('Senior Holiday', 600.00, 60, 120, 'holiday', 'active');
