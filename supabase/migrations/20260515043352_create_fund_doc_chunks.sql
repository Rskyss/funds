create extension if not exists vector;
create table if not exists public.fund_doc_chunks (
  id bigserial primary key,
  code text not null,
  source text not null,
  chunk_index smallint not null default 0,
  content text not null,
  embedding vector(1024) not null,
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_fund_doc_chunks_code_source_idx on public.fund_doc_chunks(code, source, chunk_index);
create index if not exists idx_fund_doc_chunks_code on public.fund_doc_chunks(code);
create index if not exists idx_fund_doc_chunks_embed on public.fund_doc_chunks using hnsw (embedding vector_cosine_ops);
alter table public.fund_doc_chunks enable row level security;
-- 注意：下面这条策略把表对 anon/authenticated 全开，已在 20260901 迁移中删除；保留原文以便按序重放。
drop policy if exists fund_doc_chunks_admin_all on public.fund_doc_chunks;
create policy fund_doc_chunks_admin_all on public.fund_doc_chunks for all using (true) with check (true);
create or replace function public.search_fund_doc_chunks(query_embedding vector(1024), match_count int default 5, code_filter text[] default null)
returns table (id bigint, code text, source text, chunk_index smallint, content text, similarity float)
language sql stable as $$
  select c.id, c.code, c.source, c.chunk_index, c.content, 1 - (c.embedding <=> query_embedding) as similarity
  from public.fund_doc_chunks c
  where code_filter is null or c.code = any(code_filter)
  order by c.embedding <=> query_embedding
  limit match_count
$$;
