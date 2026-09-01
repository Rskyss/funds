ALTER TABLE fund_details
  ADD COLUMN IF NOT EXISTS buy_fees_json jsonb,
  ADD COLUMN IF NOT EXISTS redeem_fees_json jsonb,
  ADD COLUMN IF NOT EXISTS fees_fetched_at timestamptz;
