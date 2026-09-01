ALTER TABLE fund_ai_summary
  ADD COLUMN IF NOT EXISTS detail_summary text,
  ADD COLUMN IF NOT EXISTS detail_model text,
  ADD COLUMN IF NOT EXISTS detail_generated_at timestamptz;
