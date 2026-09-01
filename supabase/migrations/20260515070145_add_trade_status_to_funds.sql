ALTER TABLE funds
  ADD COLUMN IF NOT EXISTS purchase_status text,
  ADD COLUMN IF NOT EXISTS purchase_limit_yuan numeric,
  ADD COLUMN IF NOT EXISTS redeem_status text,
  ADD COLUMN IF NOT EXISTS status_fetched_at timestamptz;
