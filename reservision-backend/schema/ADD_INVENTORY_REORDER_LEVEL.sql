-- Phase 5A: Add reorder_level for inventory alerts/status
ALTER TABLE inventory
  ADD COLUMN reorder_level DECIMAL(10,2) NULL AFTER threshold;

-- Backfill existing rows so current behavior remains stable.
UPDATE inventory
SET reorder_level = threshold
WHERE reorder_level IS NULL;
