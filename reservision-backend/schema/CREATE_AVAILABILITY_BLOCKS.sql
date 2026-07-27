-- Phase 5D: Manual availability blocks for rooms, cottages, and event areas
CREATE TABLE IF NOT EXISTS availability_blocks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  inventory_item_id INT NOT NULL,
  category_type VARCHAR(32) NOT NULL,

  block_type VARCHAR(50) DEFAULT 'admin_block',
  reason VARCHAR(255) NULL,
  notes TEXT NULL,

  start_date DATE NOT NULL,
  end_date DATE NULL,

  start_time TIME NULL,
  end_time TIME NULL,

  status VARCHAR(32) DEFAULT 'Active',

  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_availability_blocks_item (inventory_item_id),
  INDEX idx_availability_blocks_category (category_type),
  INDEX idx_availability_blocks_dates (start_date, end_date),
  INDEX idx_availability_blocks_status (status)
);
