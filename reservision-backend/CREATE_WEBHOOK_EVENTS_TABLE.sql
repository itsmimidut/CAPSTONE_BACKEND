-- ============================================================
-- CREATE_WEBHOOK_EVENTS_TABLE.sql
-- Sprint 4 Task 02 — Payment webhook idempotency
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS)
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  event_id VARCHAR(255) NOT NULL,
  event_type VARCHAR(255) NULL,
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_webhook_events_event_id (event_id),
  INDEX idx_webhook_events_event_type (event_type),
  INDEX idx_webhook_events_processed_at (processed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
