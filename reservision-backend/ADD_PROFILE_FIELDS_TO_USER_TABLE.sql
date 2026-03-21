-- Move customer profile fields to user table
-- Run in your DB before using profile update endpoints:
-- mysql -u root -p eduardos < ADD_PROFILE_FIELDS_TO_USER_TABLE.sql

USE eduardos;

ALTER TABLE user
ADD COLUMN IF NOT EXISTS address VARCHAR(255) NULL AFTER phone,
ADD COLUMN IF NOT EXISTS city VARCHAR(100) NULL AFTER address,
ADD COLUMN IF NOT EXISTS country VARCHAR(100) NULL DEFAULT 'Philippines' AFTER city,
ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20) NULL AFTER country,
ADD COLUMN IF NOT EXISTS profile_image TEXT NULL AFTER postal_code;

-- Optional index for location filters/search
CREATE INDEX IF NOT EXISTS idx_user_country_city ON user(country, city);
