-- Rollback for PHASE4_LEGACY_CONVERSION_TRACKING.sql
-- Drops tracking table only.

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS inventory_legacy_conversions;
SET FOREIGN_KEY_CHECKS = 1;
