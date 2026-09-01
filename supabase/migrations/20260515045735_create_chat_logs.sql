create table if not exists public.chat_logs (
  id bigserial primary key,
  session_id uuid,
  user_id text,
  ip text,
  intent text,
  user_message text,
  reply_preview text,
  tools_json jsonb,
  plan_json jsonb,
  cards_count smallint,
  sources_count smallint,
  latency_ms int,
  ok boolean,
  degraded boolean,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_logs_created on public.chat_logs(created_at desc);
create index if not exists idx_chat_logs_session on public.chat_logs(session_id);
alter table public.chat_logs enable row level security;
-- 注意：下面这条策略把表对 anon/authenticated 全开，已在 20260901 迁移中删除；保留原文以便按序重放。
drop policy if exists chat_logs_admin_all on public.chat_logs;
create policy chat_logs_admin_all on public.chat_logs for all using (true) with check (true);
