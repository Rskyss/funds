-- 匿名试用按 IP 每日计数。仅服务端（service role）访问，开启 RLS 且不加任何策略 = 浏览器侧无法读写。
-- （该功能已下线，表与函数在 20260901 迁移中删除；保留原文以便按序重放。）
create table if not exists public.anon_trial_usage (
  ip         text        not null,
  day        date        not null default current_date,
  count      int         not null default 0,
  updated_at timestamptz not null default now(),
  primary key (ip, day)
);

alter table public.anon_trial_usage enable row level security;

-- 原子消耗一次额度：返回当天剩余次数（>=0）；已用完返回 -1。
-- 用 FOR UPDATE 锁行，避免并发请求把次数刷穿。
create or replace function public.consume_anon_trial(p_ip text, p_limit int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  cur int;
begin
  insert into public.anon_trial_usage (ip, day, count)
  values (p_ip, current_date, 0)
  on conflict (ip, day) do nothing;

  select count into cur
  from public.anon_trial_usage
  where ip = p_ip and day = current_date
  for update;

  if cur >= p_limit then
    return -1;
  end if;

  update public.anon_trial_usage
  set count = count + 1, updated_at = now()
  where ip = p_ip and day = current_date;

  return p_limit - (cur + 1);
end;
$$;
