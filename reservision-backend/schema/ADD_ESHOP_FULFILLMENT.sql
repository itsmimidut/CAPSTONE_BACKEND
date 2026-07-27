-- E-Shop fulfillment lifecycle.
-- pos_transactions.id is INT(11) in the current Eduardo's schema.

ALTER TABLE pos_transactions
  ADD COLUMN fulfillment_method VARCHAR(20) NULL AFTER delivery_notes,
  ADD COLUMN fulfillment_status VARCHAR(30) NULL AFTER fulfillment_method,
  ADD COLUMN fulfillment_updated_at DATETIME NULL AFTER fulfillment_status,
  ADD COLUMN fulfillment_updated_by INT NULL AFTER fulfillment_updated_at,
  ADD COLUMN fulfillment_cancel_reason VARCHAR(255) NULL AFTER fulfillment_updated_by,
  ADD INDEX idx_pos_fulfillment_status (fulfillment_status),
  ADD INDEX idx_pos_type_fulfillment (type, fulfillment_status);

CREATE TABLE pos_fulfillment_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  transaction_id INT(11) NOT NULL,
  from_status VARCHAR(30) NULL,
  to_status VARCHAR(30) NOT NULL,
  changed_by INT NULL,
  change_reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  INDEX idx_fulfillment_history_transaction (transaction_id, created_at),
  CONSTRAINT fk_fulfillment_history_transaction
    FOREIGN KEY (transaction_id)
    REFERENCES pos_transactions(id)
    ON DELETE CASCADE
);

UPDATE pos_transactions
SET
  fulfillment_method = CASE
    WHEN LOWER(TRIM(location_type)) = 'room' THEN 'delivery'
    ELSE 'pickup'
  END,
  fulfillment_status = 'received',
  fulfillment_updated_at = COALESCE(created_at, TIMESTAMP(transaction_date, transaction_time), NOW())
WHERE LOWER(TRIM(type)) = 'e-shop'
  AND fulfillment_status IS NULL
  AND UPPER(COALESCE(status, 'ACTIVE')) <> 'VOIDED';

INSERT INTO pos_fulfillment_history (
  transaction_id,
  from_status,
  to_status,
  changed_by,
  change_reason,
  created_at
)
SELECT
  pt.id,
  NULL,
  pt.fulfillment_status,
  NULL,
  'Existing E-Shop order backfill',
  COALESCE(pt.fulfillment_updated_at, pt.created_at, NOW())
FROM pos_transactions pt
WHERE LOWER(TRIM(pt.type)) = 'e-shop'
  AND pt.fulfillment_status IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM pos_fulfillment_history h
    WHERE h.transaction_id = pt.id
  );
