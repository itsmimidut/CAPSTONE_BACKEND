-- Add updated_at to inventory_items if missing (Phase 4)
ALTER TABLE inventory_items
  ADD COLUMN updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Optional performance indexes (skip if already exist)
CREATE INDEX idx_inventory_category_type ON inventory_items (category_type);
CREATE INDEX idx_inventory_status ON inventory_items (status);
CREATE INDEX idx_inventory_updated_at ON inventory_items (updated_at);
