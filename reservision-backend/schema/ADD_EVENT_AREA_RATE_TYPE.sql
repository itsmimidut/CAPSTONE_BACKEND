-- Optional: rate type for event areas (Per Event / Per Hour / Per Day)
ALTER TABLE inventory_items
  ADD COLUMN rate_type VARCHAR(32) NULL DEFAULT 'per_event';
