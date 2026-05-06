-- Check current entrance rates
SELECT id, name, price, day_type, status FROM entrance_rates ORDER BY name, day_type;

-- Verify and fix day_type values
-- Weekday rates
UPDATE entrance_rates SET day_type = 'weekday' 
WHERE LOWER(name) IN ('adult', 'child', 'senior') AND day_type IS NULL;

UPDATE entrance_rates SET day_type = 'weekday' 
WHERE LOWER(name) IN ('adult', 'child', 'senior') AND day_type NOT IN ('weekday', 'weekend', 'holiday');

-- Weekend rates
UPDATE entrance_rates SET day_type = 'weekend' 
WHERE LOWER(name) IN ('adult weekend', 'child weekend', 'senior weekend') AND day_type IS NULL;

UPDATE entrance_rates SET day_type = 'weekend' 
WHERE LOWER(name) IN ('adult weekend', 'child weekend', 'senior weekend') AND day_type NOT IN ('weekday', 'weekend', 'holiday');

-- Holiday rates
UPDATE entrance_rates SET day_type = 'holiday' 
WHERE LOWER(name) = 'child holiday' AND day_type IS NULL;

UPDATE entrance_rates SET day_type = 'holiday' 
WHERE LOWER(name) = 'child holiday' AND day_type NOT IN ('weekday', 'weekend', 'holiday');

-- Ensure all rates are active
UPDATE entrance_rates SET status = 'active' WHERE status IS NULL OR status = '';

-- Final verification
SELECT id, name, price, day_type, status FROM entrance_rates ORDER BY name, day_type;
