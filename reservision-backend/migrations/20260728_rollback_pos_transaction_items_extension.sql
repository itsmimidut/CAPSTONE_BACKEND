-- Non-destructive Phase B rollback.
-- Snapshot columns retain backfilled data. Only Phase B constraints are removed.
-- Dropping populated columns requires an explicit backup and manual migration.

ALTER TABLE pos_transaction_items
    DROP INDEX IF EXISTS uq_pos_transaction_item_line;

ALTER TABLE pos_transaction_items
    DROP CONSTRAINT IF EXISTS chk_pos_item_line_number,
    DROP CONSTRAINT IF EXISTS chk_pos_item_quantity,
    DROP CONSTRAINT IF EXISTS chk_pos_item_unit_price,
    DROP CONSTRAINT IF EXISTS chk_pos_item_line_total;
