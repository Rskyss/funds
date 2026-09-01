-- 基金主表
CREATE TABLE IF NOT EXISTS public.funds (
  code           text PRIMARY KEY,
  name           text NOT NULL,
  pinyin         text,
  category       text,
  region         text,
  theme          text,
  fund_type      text,
  role           text,
  risk           text,
  inception      date,
  age_years      numeric,
  buy_fee        numeric,
  discount_fee   numeric,
  nav            numeric,
  accum_nav      numeric,
  nav_date       date,
  return_1d      numeric,
  return_1w      numeric,
  return_1m      numeric,
  return_3m      numeric,
  return_6m      numeric,
  return_1y      numeric,
  return_2y      numeric,
  return_3y      numeric,
  return_ytd     numeric,
  return_since   numeric,
  score          integer,
  score_label    text,
  source         text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS funds_region_idx ON public.funds (region);
CREATE INDEX IF NOT EXISTS funds_theme_idx ON public.funds (theme);
CREATE INDEX IF NOT EXISTS funds_score_idx ON public.funds (score DESC);

-- 净值历史
CREATE TABLE IF NOT EXISTS public.nav_history (
  id           bigserial PRIMARY KEY,
  code         text NOT NULL REFERENCES public.funds(code) ON DELETE CASCADE,
  nav_date     date NOT NULL,
  nav          numeric,
  accum_nav    numeric,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, nav_date)
);

CREATE INDEX IF NOT EXISTS nav_history_code_date_idx ON public.nav_history (code, nav_date DESC);

-- F10 详情缓存
CREATE TABLE IF NOT EXISTS public.fund_details (
  code         text PRIMARY KEY REFERENCES public.funds(code) ON DELETE CASCADE,
  goal         text,
  scope        text,
  benchmark    text,
  detail_url   text,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);

-- 用户收藏
CREATE TABLE IF NOT EXISTS public.favorites (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL,
  code        text NOT NULL REFERENCES public.funds(code) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code)
);

CREATE INDEX IF NOT EXISTS favorites_user_idx ON public.favorites (user_id);

-- 公开表对匿名只读，写入靠 service role 绕过 RLS
ALTER TABLE public.funds         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nav_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_details  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "funds public read" ON public.funds;
CREATE POLICY "funds public read" ON public.funds FOR SELECT USING (true);

DROP POLICY IF EXISTS "nav_history public read" ON public.nav_history;
CREATE POLICY "nav_history public read" ON public.nav_history FOR SELECT USING (true);

DROP POLICY IF EXISTS "fund_details public read" ON public.fund_details;
CREATE POLICY "fund_details public read" ON public.fund_details FOR SELECT USING (true);

DROP POLICY IF EXISTS "favorites self read" ON public.favorites;
CREATE POLICY "favorites self read" ON public.favorites FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "favorites self insert" ON public.favorites;
CREATE POLICY "favorites self insert" ON public.favorites FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "favorites self delete" ON public.favorites;
CREATE POLICY "favorites self delete" ON public.favorites FOR DELETE USING (auth.uid() = user_id);
