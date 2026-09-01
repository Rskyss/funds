create extension if not exists pgcrypto;
create table if not exists public.chat_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id text,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_chat_sessions_user on public.chat_sessions(user_id);
create index if not exists idx_chat_sessions_updated on public.chat_sessions(updated_at desc);
alter table public.chat_sessions enable row level security;
-- 注意：下面这条策略把表对 anon/authenticated 全开，已在 20260901 迁移中删除；保留原文以便按序重放。
drop policy if exists chat_sessions_admin_all on public.chat_sessions;
create policy chat_sessions_admin_all on public.chat_sessions for all using (true) with check (true);
