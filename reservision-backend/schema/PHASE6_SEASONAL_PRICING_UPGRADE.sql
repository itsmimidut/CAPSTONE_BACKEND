-- Phase 6: Extend seasonal_pricing (keeps legacy multiplier/startDate columns for backward compatibility)
CREATE TABLE IF NOT EXISTS seasonal_pricing (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NULL,
  multiplier DECIMAL(10,4) NULL,
  startDate DATE NULL,
  endDate DATE NULL,
  applyTo VARCHAR(100) NULL,
  inventory_item_id INT NULL,
  category_type VARCHAR(32) NULL,
  season_name VARCHAR(100) NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  pricing_type VARCHAR(32) NULL,
  value DECIMAL(10,2) NULL,
  status VARCHAR(32) DEFAULT 'Active',
  priority INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_seasonal_item (inventory_item_id),
  INDEX idx_seasonal_category (category_type),
  INDEX idx_seasonal_dates (start_date, end_date),
  INDEX idx_seasonal_legacy_dates (startDate, endDate)
);
