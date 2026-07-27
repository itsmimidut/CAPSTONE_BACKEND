-- Phase 3 — Structured inventory details (additive)
-- Safe to run on the current development database.
-- Does NOT rewrite existing descriptions or insert OCR data.
--
-- FK target: inventory_items.item_id (INT)
-- Rollback: see PHASE3_STRUCTURED_INVENTORY_DETAILS_ROLLBACK.sql

CREATE TABLE IF NOT EXISTS inventory_item_amenities (
  id INT NOT NULL AUTO_INCREMENT,
  inventory_item_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  normalized_name VARCHAR(150) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  source ENUM('manual', 'ocr', 'migration') NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_item_amenity_name (inventory_item_id, normalized_name),
  KEY idx_item_amenities_item_sort (inventory_item_id, sort_order),
  CONSTRAINT fk_item_amenities_inventory_item
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(item_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS accommodation_details (
  inventory_item_id INT NOT NULL,
  check_in_time TIME NULL,
  check_out_time TIME NULL,
  location VARCHAR(255) NULL,
  max_extra_guests INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (inventory_item_id),
  CONSTRAINT fk_accommodation_details_item
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(item_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS accommodation_beds (
  id INT NOT NULL AUTO_INCREMENT,
  inventory_item_id INT NOT NULL,
  bed_type VARCHAR(100) NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  notes VARCHAR(255) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  source ENUM('manual', 'ocr', 'migration') NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_accommodation_beds_item_sort (inventory_item_id, sort_order),
  CONSTRAINT fk_accommodation_beds_item
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(item_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS accommodation_extra_guest_policies (
  id INT NOT NULL AUTO_INCREMENT,
  inventory_item_id INT NOT NULL,
  min_age INT UNSIGNED NOT NULL,
  max_age INT UNSIGNED NULL,
  amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  label VARCHAR(255) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  source ENUM('manual', 'ocr', 'migration') NOT NULL DEFAULT 'manual',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_extra_guest_policy_item_age (inventory_item_id, min_age, max_age),
  CONSTRAINT fk_extra_guest_policy_item
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(item_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- NOTE: event venue / rate_type / capacity already live on inventory_items.
-- No event_details table is created to avoid duplicating those columns.
-- Event amenities use inventory_item_amenities.
