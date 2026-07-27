-- ============================================================
-- CREATE_REFRESH_TOKENS_TABLE.sql
-- Sprint 3 Task 02 — Refresh token storage
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS)
-- ============================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL COMMENT 'SHA-256 hash of the refresh token',
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_agent VARCHAR(512) NULL,
  ip_address VARCHAR(45) NULL,
  INDEX idx_refresh_tokens_user_id (user_id),
  INDEX idx_refresh_tokens_token_hash (token_hash),
  INDEX idx_refresh_tokens_expires_at (expires_at),
  CONSTRAINT fk_refresh_tokens_user
    FOREIGN KEY (user_id) REFERENCES user(user_id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
