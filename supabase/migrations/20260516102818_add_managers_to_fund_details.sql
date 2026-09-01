ALTER TABLE fund_details
  ADD COLUMN IF NOT EXISTS managers_json jsonb,
  ADD COLUMN IF NOT EXISTS managers_fetched_at timestamptz;
