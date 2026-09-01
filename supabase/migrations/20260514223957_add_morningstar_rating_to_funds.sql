ALTER TABLE public.funds
  ADD COLUMN IF NOT EXISTS rating_morningstar smallint,
  ADD COLUMN IF NOT EXISTS rating_date date;

COMMENT ON COLUMN public.funds.rating_morningstar IS '晨星评级 1-5 星，null 表示暂无评级';
COMMENT ON COLUMN public.funds.rating_date IS '评级日期（评级时效性参考）';
