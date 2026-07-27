-- Event area booking schedule on booking_items (not inventory_items)
ALTER TABLE booking_items
  ADD COLUMN booking_date DATE NULL,
  ADD COLUMN start_time TIME NULL,
  ADD COLUMN end_time TIME NULL,
  ADD COLUMN event_purpose VARCHAR(255) NULL;

CREATE INDEX idx_booking_items_event_schedule
  ON booking_items (inventory_item_id, booking_date, start_time, end_time);
