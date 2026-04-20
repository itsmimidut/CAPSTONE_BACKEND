-- Add image support to entrance_rates table
-- This migration adds the ability to store image URLs/paths for each entrance rate

ALTER TABLE entrance_rates ADD COLUMN image_url VARCHAR(500) NULL AFTER status;

-- Update existing records to have NULL images (they can be added later)
-- No data loss occurs

-- Add index for faster queries
CREATE INDEX idx_entrance_rates_image ON entrance_rates(image_url);
