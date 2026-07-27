-- Add category and supplier columns to restaurant inventory table
-- Safe to re-run only if columns do not already exist
ALTER TABLE inventory
  ADD COLUMN category VARCHAR(100) DEFAULT NULL AFTER item_name;

ALTER TABLE inventory
  ADD COLUMN supplier VARCHAR(255) DEFAULT NULL AFTER category;
