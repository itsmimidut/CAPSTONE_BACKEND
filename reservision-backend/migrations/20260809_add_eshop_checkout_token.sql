ALTER TABLE pos_transactions
  ADD COLUMN checkout_token VARCHAR(64) NULL,
  ADD UNIQUE INDEX uq_pos_transactions_checkout_token (checkout_token);
