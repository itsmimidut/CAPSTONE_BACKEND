-- Event-specific columns for inventory_items (Phase 2)
-- Run once against your database before using the Events module.

ALTER TABLE inventory_items
  ADD COLUMN event_date DATE NULL,
  ADD COLUMN event_start_time TIME NULL,
  ADD COLUMN event_end_time TIME NULL,
  ADD COLUMN venue VARCHAR(255) NULL;

-- Optional indexes (skip if they already exist)
CREATE INDEX idx_inventory_category_type ON inventory_items (category_type);
CREATE INDEX idx_inventory_event_date ON inventory_items (event_date);
