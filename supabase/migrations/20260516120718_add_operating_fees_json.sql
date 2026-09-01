ALTER TABLE fund_details ADD COLUMN IF NOT EXISTS operating_fees_json jsonb DEFAULT NULL;
