-- Adds JSON fields for menu item customization options.
-- Run this once in your database before using sizes/add-ons persistence.

ALTER TABLE menu_items
  ADD COLUMN sizes JSON NULL,
  ADD COLUMN addons JSON NULL;
