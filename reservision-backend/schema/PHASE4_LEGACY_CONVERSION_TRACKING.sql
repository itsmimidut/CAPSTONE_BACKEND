-- Phase 4 — Controlled Legacy Inventory Conversion tracking
-- Additive only: creates tracking infrastructure without converting data.

CREATE TABLE IF NOT EXISTS inventory_legacy_conversions (
  id INT NOT NULL AUTO_INCREMENT,
  inventory_item_id INT NOT NULL,
  conversion_status ENUM('pending','in_review','converted','skipped','failed','reverted') NOT NULL DEFAULT 'pending',
  parser_version VARCHAR(50) NULL,
  source_snapshot_hash CHAR(64) NULL,
  source_snapshot_json JSON NULL,
  original_description LONGTEXT NULL,
  original_structured_details JSON NULL,
  review_draft_json JSON NULL,
  applied_snapshot_json JSON NULL,
  description_replaced TINYINT(1) NOT NULL DEFAULT 0,
  reviewed_by INT NULL,
  reviewed_at DATETIME NULL,
  converted_at DATETIME NULL,
  skipped_at DATETIME NULL,
  reverted_at DATETIME NULL,
  notes TEXT NULL,
  last_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_legacy_conversion_item (inventory_item_id),
  KEY idx_legacy_conversion_status (conversion_status),
  KEY idx_legacy_conversion_status_item (conversion_status, inventory_item_id),
  KEY idx_legacy_conversion_reviewed_by (reviewed_by),
  CONSTRAINT fk_legacy_conversion_item
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(item_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_legacy_conversion_reviewer
    FOREIGN KEY (reviewed_by) REFERENCES user(user_id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
