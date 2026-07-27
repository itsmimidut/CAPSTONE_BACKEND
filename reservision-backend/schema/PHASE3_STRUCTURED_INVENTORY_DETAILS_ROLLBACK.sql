-- Rollback for PHASE3_STRUCTURED_INVENTORY_DETAILS.sql
-- Drops structured child tables only. Does not modify inventory_items rows.

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS accommodation_extra_guest_policies;
DROP TABLE IF EXISTS accommodation_beds;
DROP TABLE IF EXISTS accommodation_details;
DROP TABLE IF EXISTS inventory_item_amenities;

SET FOREIGN_KEY_CHECKS = 1;
