# AI 热议推荐 · 上线前你需要做的事

代码已经全部写完，但有一步必须你手动操作 —— 在 Supabase 控制台建表。

## ✅ 已经完成（你不用动）

- `rules/suggestions.md`：清理了 16 条不清晰、用代号、过于专业的问题
- `lib/agent/hotTopics.mjs`：新文件，事件检测 + Tavily 搜索 + AI 生成
- `lib/store.mjs`：（未改）热议表读写直接走 `supabaseAdmin`
- `server.mjs`：
  - `/api/chat/suggestions` 接口现在会同时返回 AI 热议（最多 2 条）
  - 启动自检完成后，异步触发一次"事件检测+热议生成"
- `frontend/`：
  - 推荐问题区域：热议会带 🔥 徽标置顶，整条按钮也加了暖色调
  - 已重新构建到 `public/`

## 🚧 你需要操作的一步：在 Supabase 建新表

打开你的 Supabase 项目控制台 → 左侧 **SQL Editor** → 新建查询，粘贴下面整段并 Run：

```sql
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
```

（这段 SQL 也保存了一份在 `docs/ai-热议推荐/migration.sql`）

## 🔄 然后重启服务

```bash
# 杀掉旧进程
pkill -f "node.*server.mjs" 2>/dev/null

# 启动新服务
npm start
```

启动日志会看到：

- `[启动自检] 数据已是最新...` 或 `[启动自检] 补刷完成 ✓ ...`
- 1.5 秒后：`[热议推荐] 触发生成：...` 或 `[热议推荐] 跳过：...`

## 🧪 怎么验证生效

### 情况 A：今日板块平稳（无任一 |avg1d| > 2.5%），首次部署

控制台会看到 `[热议推荐] 触发生成：首次生成（无历史热议）`，紧接着可能：

- ✅ 看到 `[热议推荐] 已更新 ✓ XXX / YYY` → 表示 AI 生成成功，刷新前端 AI 投顾会有 2 条 🔥 热议
- ⚠️ 看到 `[热议推荐] 生成失败（静默降级）：...` → 检查 `.env` 里 `DASHSCOPE_API_KEY` / `TAVILY_API_KEY` 是否配置正确

### 情况 B：今日有板块异动（如纳指 +3%）

控制台 `[热议推荐] 触发生成：板块异动：科技成长 +3.42%`，然后同上。

### 情况 C：板块平稳 + 上次生成不到 30 天

控制台 `[热议推荐] 跳过：板块涨跌平稳且热议未过期`，前端继续显示上次生成的 2 条热议。

## ⚙️ 配置项说明

`.env` 里你已经有的配置就够用了：

- `DASHSCOPE_API_KEY` —— LLM 生成问题用
- `DASHSCOPE_MODEL_STRONG` —— 优先用这个模型（如 `qwen-max`）；没配会回退到 `DASHSCOPE_MODEL`
- `TAVILY_API_KEY` —— 拉市场背景用；如果没配，LLM 仍然能生成但缺少时效素材

新增可选配置（不配也行，用默认）：

| 变量名 | 默认 | 说明 |
| --- | --- | --- |
| —— | —— | 当前所有阈值都写死在 `lib/agent/hotTopics.mjs` 顶部，需要调整改源码即可 |

如果以后想调阈值（比如把 2.5% 改成 3%，或 30 天兜底改成 14 天），直接改文件顶部的 `EVENT_THRESHOLD` 和 `FALLBACK_DAYS` 常量。

## 🔧 强制重新生成（运维彩蛋）

如果想测试效果不想等异动，可以手动跑 SQL 把现有记录失活：

```sql
update chat_hot_suggestions set is_active = false where is_active = true;
```

然后重启服务，触发"首次生成"分支即可生成新的。
