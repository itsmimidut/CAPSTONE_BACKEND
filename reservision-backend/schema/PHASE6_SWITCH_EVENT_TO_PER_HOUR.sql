-- Switch Functional Hall (item 16) to per_hour mode for Phase 6 hourly pricing tests.
-- Run BEFORE per-hour / seasonal+promo hourly tests.
-- Re-run PHASE6_PRICING_TEST_DATA.sql section 2 (item 16) to restore per_event mode.

UPDATE inventory_items
SET price = 1000.00,
    rate_type = 'per_hour',
    status = 'Available'
WHERE item_id = 16;

SELECT item_id, name, category_type, price, rate_type
FROM inventory_items
WHERE item_id = 16;
