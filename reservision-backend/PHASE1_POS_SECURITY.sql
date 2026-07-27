-- Phase 1 — Critical POS Security
-- Server-generated receipt numbers + unique receipt constraint

CREATE TABLE IF NOT EXISTS pos_receipt_sequences (
  id INT AUTO_INCREMENT PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Run only after resolving duplicate receipt_no values in pos_transactions
-- ALTER TABLE pos_transactions
-- ADD UNIQUE INDEX uq_pos_transactions_receipt_no (receipt_no);
