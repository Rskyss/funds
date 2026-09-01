# 数据库结构与迁移

本目录是 Supabase Postgres 的**唯一权威结构定义**。`migrations/` 按文件名时间戳顺序重放即可从零建出与线上一致的库。

## 文件来源

- `20260514125629` ~ `20260625085204`：从线上项目的 `supabase_migrations.schema_migrations` 表原样导出（2026-09-01），此前这些 SQL 只存在于线上、仓库里没有副本。
- `20260628000000_create_events.sql`：`events` 表当初在 SQL Editor 手工建的、未进迁移历史，按线上实际结构反推补录。
- `20260901031850_lockdown_sensitive_tables_drop_anon_trial.sql`：v1.7.1 安全收口——删掉把 `user_profile` / `chat_sessions` / `chat_logs` / `fund_doc_chunks` 对公网全开的策略，回收浏览器侧角色的表权限，清理已下线的匿名试用表与函数。

## 从零建库（Fork / 灾备）

方式一（推荐，Supabase CLI）：

```bash
supabase link --project-ref <你的 project ref>
supabase db push          # 按顺序应用 migrations/ 下全部文件
```

方式二（控制台）：到 Supabase → SQL Editor，按文件名顺序逐个粘贴执行。

## 新增/修改表结构的规矩

1. 先在这里加一个新文件：`migrations/<YYYYMMDDHHMMSS>_<snake_case_name>.sql`，写幂等 SQL（`if not exists` / `if exists`）。
2. 用 Supabase CLI `db push`、MCP `apply_migration` 或控制台执行到线上——**名字要和文件名一致**，这样线上迁移历史与仓库能对得上。
3. 同步改 `lib/store.mjs` 的 `fundToRow` / `rowToFund` 映射与所有用到该字段的代码（CLAUDE.md「三处同步」）。
4. 在 `CHANGELOG.md` 的「数据库」小节写一句人话说明。

## 当前表一览（13 张）

| 表 | 浏览器侧（anon）可见 | 说明 |
|---|---|---|
| funds / nav_history / fund_details / fund_ai_summary / chat_hot_suggestions | 只读 | 公开基金数据 |
| favorites | 仅本人（`auth.uid() = user_id`） | 自选 |
| user_profile / chat_sessions / chat_logs / fund_doc_chunks / events / invite_codes | **不可见** | 仅服务端 service role 读写 |

线上安全建议（`get_advisors`）里剩余的 `RLS Enabled No Policy` 属预期：这些表就是故意不给浏览器侧任何策略。
