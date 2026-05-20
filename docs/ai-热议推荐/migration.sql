-- ============================================================
-- AI 热议推荐：每周由 AI 生成 2 条市场热议问题
-- 触发条件：板块异动（任一板块 |avg1d| > 2.5%）或距上次成功生成 > 30 天
-- 与 funds / fund_details 一致：开 RLS + 公开读 policy，写入靠 service_role 绕过
-- ============================================================

create table if not exists chat_hot_suggestions (
  id              bigserial primary key,
  questions       jsonb       not null,             -- ["问题1", "问题2"]
  trigger_reason  text,                              -- 例如 "板块异动：科技成长 -3.42%" 或 "30天兜底"
  context_snippet text,                              -- AI 生成时引用的市场背景（来自 Tavily）
  is_active       boolean     not null default true, -- 当前生效中的最新一条
  created_at      timestamptz not null default now()
);

create index if not exists chat_hot_suggestions_active_idx
  on chat_hot_suggestions (is_active, created_at desc);

-- 加固：开 RLS，允许 anon/authenticated 读取；写入由服务端 supabaseAdmin（service_role）绕过 RLS 执行
alter table chat_hot_suggestions enable row level security;

create policy "chat_hot_suggestions_public_read"
  on chat_hot_suggestions
  for select
  using (true);
