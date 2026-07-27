-- ============================================================
-- CREATE_AUDIT_LOGS_TABLE.sql
-- Sprint 4 Task 04 — Immutable financial audit logs
-- Safe to run multiple times (CREATE TABLE IF NOT EXISTS)
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL DEFAULT 0,
  action VARCHAR(255) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id INT NOT NULL DEFAULT 0,
  old_value JSON NULL,
  new_value JSON NULL,
  ip_address VARCHAR(45) NULL,
  user_agent TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_logs_user_id (user_id),
  INDEX idx_audit_logs_action (action),
  INDEX idx_audit_logs_entity (entity_type, entity_id),
  INDEX idx_audit_logs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
