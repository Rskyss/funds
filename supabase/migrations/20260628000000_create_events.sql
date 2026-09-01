-- 补录：events（匿名行为埋点）表约在 2026-06-28 于 Supabase SQL Editor 手工创建，未进迁移历史。
-- 本文件按线上实际结构反推（列 / 主键 / 索引 / RLS），2026-09-01 核对一致。
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  anon_id    text,
  user_id    uuid,
  type       text not null,
  code       text,
  payload    jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_created_idx on public.events (created_at desc);
create index if not exists events_type_idx    on public.events (type);
create index if not exists events_anon_idx    on public.events (anon_id);
create index if not exists events_code_idx    on public.events (code) where (code is not null);

-- 只由服务端（service role）写入与读取；开启 RLS 且不加策略 = 浏览器侧无法读写
alter table public.events enable row level security;
