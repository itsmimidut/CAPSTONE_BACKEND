CREATE TABLE IF NOT EXISTS reservation_import_batches (
  import_batch_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  batch_reference VARCHAR(40) NOT NULL,
  source_filename VARCHAR(255) NOT NULL,
  status ENUM('PREVIEWED','IMPORTING','COMPLETED','PARTIAL','FAILED','ROLLED_BACK') NOT NULL DEFAULT 'PREVIEWED',
  total_rows INT UNSIGNED NOT NULL DEFAULT 0,
  valid_rows INT UNSIGNED NOT NULL DEFAULT 0,
  imported_rows INT UNSIGNED NOT NULL DEFAULT 0,
  rejected_rows INT UNSIGNED NOT NULL DEFAULT 0,
  created_by VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  rolled_back_at TIMESTAMP NULL,
  PRIMARY KEY (import_batch_id),
  UNIQUE KEY uq_reservation_import_batch_reference (batch_reference),
  KEY idx_reservation_import_batch_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reservation_import_rows (
  import_row_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  import_batch_id BIGINT UNSIGNED NOT NULL,
  row_number INT UNSIGNED NOT NULL,
  legacy_reference VARCHAR(120) NULL,
  booking_id INT NULL,
  validation_status ENUM('VALID','WARNING','DUPLICATE','INVALID','IMPORTED','FAILED','ROLLED_BACK') NOT NULL,
  error_codes JSON NULL,
  error_messages JSON NULL,
  normalized_payload JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  imported_at TIMESTAMP NULL,
  PRIMARY KEY (import_row_id),
  UNIQUE KEY uq_reservation_import_batch_row (import_batch_id, row_number),
  KEY idx_reservation_import_row_booking (booking_id),
  CONSTRAINT fk_reservation_import_rows_batch FOREIGN KEY (import_batch_id)
    REFERENCES reservation_import_batches(import_batch_id) ON DELETE CASCADE,
  CONSTRAINT fk_reservation_import_rows_booking FOREIGN KEY (booking_id)
    REFERENCES bookings(booking_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS import_batch_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS booking_source VARCHAR(40) NOT NULL DEFAULT 'DIRECT',
  ADD COLUMN IF NOT EXISTS is_historical_import TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_reference VARCHAR(120) NULL,
  ADD INDEX IF NOT EXISTS idx_bookings_import_batch (import_batch_id),
  ADD INDEX IF NOT EXISTS idx_bookings_legacy_reference (legacy_reference);
