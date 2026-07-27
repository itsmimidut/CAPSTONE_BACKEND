-- Phase 2: POS print job tracking and auto-print idempotency
CREATE TABLE IF NOT EXISTS print_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  receipt_no VARCHAR(50) NOT NULL,
  transaction_id INT NULL,
  print_type VARCHAR(30) NOT NULL,
  booking_reference VARCHAR(100) NULL,
  status ENUM('QUEUED','SENT','FAILED') NOT NULL DEFAULT 'QUEUED',
  source VARCHAR(30) NOT NULL DEFAULT 'manual',
  requested_by INT NULL,
  job_file VARCHAR(255) NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  failed_at DATETIME NULL,
  UNIQUE KEY uniq_auto_print (receipt_no, print_type, booking_reference, source)
);
