create table if not exists public.user_profile (
  user_id text primary key,
  risk_pref text check (risk_pref in ('low','mid','high')),
  horizon text check (horizon in ('short','mid','long')),
  regions text[] default '{}'::text[],
  amount_band text check (amount_band in ('<10w','10-50w','50-200w','>200w')),
  updated_at timestamptz not null default now()
);
alter table public.user_profile enable row level security;
-- 注意：下面这条策略把表对 anon/authenticated 全开，已在 20260901 迁移中删除；保留原文以便按序重放。
drop policy if exists user_profile_admin_all on public.user_profile;
create policy user_profile_admin_all on public.user_profile for all using (true) with check (true);
