-- Add user_id column to pos_transactions table for filtering transactions by user
-- This allows customers to see only their own order history

ALTER TABLE pos_transactions
ADD COLUMN IF NOT EXISTS user_id INT AFTER id,
ADD CONSTRAINT fk_pos_transactions_user FOREIGN KEY (user_id) REFERENCES user(user_id) ON DELETE CASCADE,
ADD INDEX idx_pos_user_id (user_id);

-- Backfill: Set user_id = 1 for existing transactions (default to first user)
-- Adjust or remove this if you have a different default logic
UPDATE pos_transactions SET user_id = 1 WHERE user_id IS NULL;
