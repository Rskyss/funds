create table if not exists chat_hot_suggestions (
  id              bigserial primary key,
  questions       jsonb       not null,
  trigger_reason  text,
  context_snippet text,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now()
);

create index if not exists chat_hot_suggestions_active_idx
  on chat_hot_suggestions (is_active, created_at desc);

alter table chat_hot_suggestions disable row level security;
