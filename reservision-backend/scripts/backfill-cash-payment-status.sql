-- Backfill Cash transactions incorrectly saved as PENDING (Phase 2 audit fix)
UPDATE pos_transactions
SET
  payment_status = 'PAID',
  payment_processed = 1,
  paid_at = COALESCE(
      paid_at,
      TIMESTAMP(transaction_date, transaction_time),
      NOW()
  )
WHERE LOWER(TRIM(payment_method)) = 'cash'
  AND payment_status = 'PENDING'
  AND COALESCE(status, 'ACTIVE') != 'VOIDED';
