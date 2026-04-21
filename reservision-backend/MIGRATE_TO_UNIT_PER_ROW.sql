-- ============================================================
-- MIGRATION: One physical unit = one inventory_items row
-- ============================================================
-- Safe to run multiple times — uses IF NOT EXISTS / guard logic.
-- ROLLBACK PRECAUTION: Back up your inventory_items table first:
--   CREATE TABLE inventory_items_backup AS SELECT * FROM inventory_items;
-- ============================================================

-- Step 1: Add unit_number and unit_label columns if they don't exist yet
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS unit_number INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_label  VARCHAR(100) DEFAULT NULL;

-- Step 2: Set unit_number = 1 for all existing rows (they were all qty=1 implicitly)
UPDATE inventory_items SET unit_number = 1 WHERE unit_number IS NULL OR unit_number = 0;

-- Step 3: Expand rows where quantity > 1 into individual unit rows.
-- This script iterates via a stored procedure so it works with any quantity value.

DROP PROCEDURE IF EXISTS migrate_units_to_rows;

DELIMITER $$
CREATE PROCEDURE migrate_units_to_rows()
BEGIN
  DECLARE done INT DEFAULT FALSE;
  DECLARE v_id INT;
  DECLARE v_qty INT;
  DECLARE v_cat VARCHAR(50);
  DECLARE v_cat_type VARCHAR(100);
  DECLARE v_room_number VARCHAR(50);
  DECLARE v_name VARCHAR(255);
  DECLARE v_desc LONGTEXT;
  DECLARE v_max_guests INT;
  DECLARE v_price DECIMAL(10,2);
  DECLARE v_status VARCHAR(50);
  DECLARE v_promo VARCHAR(100);
  DECLARE v_images LONGTEXT;
  DECLARE v_pimg INT;
  DECLARE v_unit INT;

  DECLARE cur CURSOR FOR
    SELECT item_id, quantity, category, category_type, room_number,
           name, description, max_guests, price, status, promo, images, primaryImageIndex
    FROM inventory_items
    WHERE quantity > 1;

  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

  OPEN cur;
  read_loop: LOOP
    FETCH cur INTO v_id, v_qty, v_cat, v_cat_type, v_room_number, v_name, v_desc,
                   v_max_guests, v_price, v_status, v_promo, v_images, v_pimg;
    IF done THEN LEAVE read_loop; END IF;

    -- Update the original row to be unit 1
    UPDATE inventory_items
    SET quantity = 1, unit_number = 1,
        unit_label = CONCAT(v_name, ' - Unit 1')
    WHERE item_id = v_id;

    -- Insert additional rows for units 2..quantity
    SET v_unit = 2;
    WHILE v_unit <= v_qty DO
      INSERT INTO inventory_items
        (category, category_type, room_number, name, description, max_guests,
         price, status, promo, images, primaryImageIndex, quantity, unit_number, unit_label)
      VALUES
        (v_cat, v_cat_type, v_room_number, v_name, v_desc, v_max_guests,
         v_price, v_status, v_promo, v_images, v_pimg,
         1, v_unit, CONCAT(v_name, ' - Unit ', v_unit));
      SET v_unit = v_unit + 1;
    END WHILE;
  END LOOP;
  CLOSE cur;
END$$
DELIMITER ;

CALL migrate_units_to_rows();
DROP PROCEDURE IF EXISTS migrate_units_to_rows;

-- Step 4: Set unit_label for all rows that don't have one yet.
-- For single-unit items the label is just the name.
UPDATE inventory_items
SET unit_label = CONCAT(name, ' - Unit ', unit_number)
WHERE unit_label IS NULL OR unit_label = '';

-- Step 5: Set quantity = 1 on every row (quantity column is now semantically unused for logic)
UPDATE inventory_items SET quantity = 1;

-- Step 6: Add a useful index for grouped lookups (name + category + status)
CREATE INDEX IF NOT EXISTS idx_inv_name_cat ON inventory_items (name(191), category, status);

-- Done. Verify:
-- SELECT item_id, category, name, unit_number, unit_label, quantity, status FROM inventory_items ORDER BY name, unit_number;
