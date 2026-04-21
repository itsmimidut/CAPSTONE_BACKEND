-- ============================================================
-- ADD_AUTH_IMPROVEMENTS.sql
-- Run this migration once before deploying the improved auth code.
-- It is safe to run multiple times (uses IF NOT EXISTS / IGNORE).
-- ============================================================

-- 1. last_login_at
--    Replaces the incorrect practice of overwriting created_at on every login.
--    The application now calls: UPDATE user SET last_login_at = NOW() WHERE user_id = ?
ALTER TABLE user
  ADD COLUMN IF NOT EXISTS last_login_at DATETIME NULL DEFAULT NULL
  COMMENT 'Timestamp of the most recent successful login';

-- 2. google_sub
--    Google''s stable unique user ID.  Unlike the email address, this never
--    changes even if the user renames their Gmail account.  Used as the
--    primary key for Google Sign-In lookups so email-spoofing attacks are
--    not possible.
ALTER TABLE user
  ADD COLUMN IF NOT EXISTS google_sub VARCHAR(128) NULL DEFAULT NULL
  COMMENT 'Google OAuth2 subject ID (stable unique user identifier from Google)';

-- 3. auth_provider
--    Records how the account was originally created so we can distinguish
--    local (email + password) accounts from Google-only accounts.
--    Values: ''local'' | ''google''
ALTER TABLE user
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32) NULL DEFAULT NULL
  COMMENT 'How the account was created: local | google';

-- 4. Index on google_sub for fast lookups during Google Sign-In
--    (avoids a full table scan on every Google login)
CREATE INDEX IF NOT EXISTS idx_user_google_sub
  ON user (google_sub);

-- 5. Backfill existing accounts as ''local'' provider where not already set
UPDATE user
  SET auth_provider = 'local'
  WHERE auth_provider IS NULL OR auth_provider = '';

-- Done.
SELECT 'AUTH_IMPROVEMENTS migration applied successfully.' AS status;
