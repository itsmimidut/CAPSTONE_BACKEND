-- Sprint 3 Task 06 — track session activity
ALTER TABLE refresh_tokens
  ADD COLUMN IF NOT EXISTS last_used_at DATETIME NULL DEFAULT NULL
  COMMENT 'Last time this refresh token was used';
