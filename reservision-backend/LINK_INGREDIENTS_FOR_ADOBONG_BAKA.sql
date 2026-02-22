-- ============================================================
-- LINK INGREDIENTS TO ADOBONG BAKA
-- ============================================================
-- This script links inventory items as ingredients to the "Adobong Baka" menu item

-- First, get the menu_id for Adobong Baka (usually 1 if it's the first item)
-- Adjust the menu_id if needed based on your database

-- Get the ID:
-- SELECT menu_id FROM menu_items WHERE name = 'Adobong Baka';

-- Then link ingredients (adjust inventory_ids based on your database):
-- Example: Adobong Baka needs:
-- - Beef (Chuck) - 0.25 kg per serving
-- - Soy Sauce - 0.05 L per serving  
-- - Vinegar - 0.01 L per serving
-- - Garlic - 0.02 kg per serving

-- Find your inventory IDs first:
-- SELECT inventory_id, item_name, quantity, unit FROM inventory;

-- Once you have the menu_id and inventory_ids, run these commands:
-- Replace 1 with your actual menu_id for Adobong Baka
-- Replace inventory_ids with your actual inventory IDs from the table above

INSERT INTO menu_ingredients (menu_id, inventory_id, quantity_needed) 
VALUES 
  (1, 9, 0.25),  -- Beef (Chuck) - 0.25 kg per serving
  (1, 10, 0.05), -- Soy Sauce - 0.05 L per serving
  (1, 11, 0.01), -- Vinegar - 0.01 L per serving
  (1, 12, 0.02); -- Garlic - 0.02 kg per serving

-- Verify the links were created:
-- SELECT 
--   m.menu_id, m.name as menu_name,
--   i.inventory_id, i.item_name, 
--   mi.quantity_needed, i.unit
-- FROM menu_ingredients mi
-- JOIN menu_items m ON mi.menu_id = m.menu_id
-- JOIN inventory i ON mi.inventory_id = i.inventory_id
-- WHERE m.name = 'Adobong Baka';
