-- Menu Ingredients Junction Table
-- Links menu items to inventory items with quantity needed per serving

CREATE TABLE IF NOT EXISTS menu_ingredients (
  id INT PRIMARY KEY AUTO_INCREMENT,
  menu_id INT NOT NULL,
  inventory_id INT NOT NULL,
  quantity_needed DECIMAL(10, 2) NOT NULL COMMENT 'Amount of inventory item needed per menu item serving',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (menu_id) REFERENCES menu_items(menu_id) ON DELETE CASCADE,
  FOREIGN KEY (inventory_id) REFERENCES inventory(inventory_id) ON DELETE CASCADE,
  UNIQUE KEY unique_menu_inventory (menu_id, inventory_id)
);

-- Example: Adobong Baka needs these ingredients
-- Assuming menu_id for "Adobong Baka" is 1
-- INSERT INTO menu_ingredients (menu_id, inventory_id, quantity_needed) VALUES
-- (1, 1, 0.25), -- 0.25 kg beef per serving
-- (1, 2, 0.05), -- 0.05 L soy sauce per serving
-- (1, 3, 0.02), -- 0.02 kg garlic per serving
-- (1, 4, 0.01); -- 0.01 L vinegar per serving
