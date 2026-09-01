ALTER TABLE public.funds
  ADD COLUMN IF NOT EXISTS aum_billion numeric,
  ADD COLUMN IF NOT EXISTS aum_date date,
  ADD COLUMN IF NOT EXISTS sharpe_1y numeric,
  ADD COLUMN IF NOT EXISTS volatility_1y numeric,
  ADD COLUMN IF NOT EXISTS max_drawdown_1y numeric,
  ADD COLUMN IF NOT EXISTS manager_names text;

COMMENT ON COLUMN public.funds.aum_billion IS '净资产规模（亿元）';
COMMENT ON COLUMN public.funds.aum_date IS '规模截止日期';
COMMENT ON COLUMN public.funds.sharpe_1y IS '近1年夏普比率';
COMMENT ON COLUMN public.funds.volatility_1y IS '近1年年化波动率（%）';
COMMENT ON COLUMN public.funds.max_drawdown_1y IS '近1年最大回撤（%，负值）';
COMMENT ON COLUMN public.funds.manager_names IS '当前基金经理姓名（多人用顿号分隔）';
