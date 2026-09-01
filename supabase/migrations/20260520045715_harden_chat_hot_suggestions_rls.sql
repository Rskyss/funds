alter table public.chat_hot_suggestions enable row level security;

create policy "chat_hot_suggestions_public_read"
  on public.chat_hot_suggestions
  for select
  using (true);
