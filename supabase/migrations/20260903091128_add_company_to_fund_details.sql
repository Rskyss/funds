-- 购买引导（去哪里买）：记录基金管理人（东财公司 id + 名称），服务端据此查官网对照表 lib/data/fund-companies.json。
-- 两列可空、纯追加；由 fetchFundProfile 解析概况页写入，FORCE=1 npm run data:f10 可全量回填。
ALTER TABLE public.fund_details
  ADD COLUMN IF NOT EXISTS company_id   text,
  ADD COLUMN IF NOT EXISTS company_name text;
