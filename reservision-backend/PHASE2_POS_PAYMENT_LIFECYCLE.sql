-- Phase 2 — Payment Integrity & Transaction Lifecycle

ALTER TABLE pos_transactions
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS xendit_invoice_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS paid_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS payment_processed TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS voided_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS voided_by INT NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_pos_transactions_payment_status ON pos_transactions (payment_status);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_xendit_invoice ON pos_transactions (xendit_invoice_id);
