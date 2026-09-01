ALTER TABLE public.fund_details
  ADD COLUMN IF NOT EXISTS holdings_json jsonb,
  ADD COLUMN IF NOT EXISTS holdings_report_date date,
  ADD COLUMN IF NOT EXISTS asset_allocation_json jsonb,
  ADD COLUMN IF NOT EXISTS holdings_fetched_at timestamptz;

COMMENT ON COLUMN public.fund_details.holdings_json IS '前10大重仓股 JSON 数组';
COMMENT ON COLUMN public.fund_details.holdings_report_date IS '持仓季报披露日期';
COMMENT ON COLUMN public.fund_details.asset_allocation_json IS '资产配置历史（最近 8 期）JSON 数组';
COMMENT ON COLUMN public.fund_details.holdings_fetched_at IS '本地抓取时间，用于 TTL 判断';
