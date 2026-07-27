-- Normalize rate_type values by inventory category.
-- Rooms should not use per_event; cottages use per_day; event areas use per_event.

UPDATE inventory_items
SET rate_type = NULL
WHERE category_type = 'room';

UPDATE inventory_items
SET rate_type = 'per_day'
WHERE category_type = 'cottage';

UPDATE inventory_items
SET rate_type = 'per_event'
WHERE category_type = 'event'
  AND (rate_type IS NULL OR rate_type = '');
