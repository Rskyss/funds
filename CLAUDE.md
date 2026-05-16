# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

QDII 基金罗盘：本地运行的 QDII 基金查询/对比/AI 点评 Web app。原生 JS，零构建，浏览器直接跑。数据持久化到 Supabase Postgres，AI 点评走阿里云百炼 DashScope（OpenAI 兼容协议）。

## 常用命令

```bash
npm install                                 # 仅首次
npm start                                   # 启动 HTTP 服务（http://localhost:5173）
npm run ai:generate                         # 批量生成所有基金的 AI 点评
npm run ai:generate -- --limit 10           # 仅生成前 10 只
npm run ai:generate -- --force              # 重新生成所有（覆盖已存在）
AI_CONCURRENCY=8 npm run ai:generate        # 调整并发（默认 5）
```

启动脚本通过 `node --env-file=.env` 加载环境变量，**无需** 第三方 dotenv。改 `.env` 后要重启服务。

没有测试套件、没有 linter、没有构建步骤。改完代码直接重启 `npm start` 验证。

## 必需的环境变量

`.env`（参考 `.env.example`）：

- `SUPABASE_URL` / `SUPABASE_SECRET_KEY` — 服务端写入和 Auth 管理用（`supabaseAdmin`）
- `SUPABASE_PUBLISHABLE_KEY` — 通过 `/api/config` 下发给前端，仅做匿名读和登录
- `DASHSCOPE_API_KEY` — 仅在使用 `/api/fund/:code/ai-summary` 或 `npm run ai:generate` 时需要
- `DASHSCOPE_MODEL`（可选，默认 `qwen-plus`）

缺 Supabase 变量服务会启动失败（`lib/supabase.mjs` 顶层抛错）；缺 DashScope 变量只在调用 AI 路径时失败。

## 架构

AI 投顾（聊天 Agent）分层图与 SSE 事件说明见 [`docs/ai-agent/ARCHITECTURE.md`](docs/ai-agent/ARCHITECTURE.md)。策略卡片在 `rules/`，由 `lib/agent/rules.mjs` 加载。

### 数据流

```
浏览器 (public/*.js)
   ├─ Supabase JS SDK (esm.sh CDN) → 直连 Supabase Auth 登录
   └─ fetch /api/* + Authorization: Bearer <access_token>
        ↓
Node http server (server.mjs)
   ├─ lib/auth.mjs       — 用 admin client 校验 Bearer token，解出 userId
   ├─ lib/store.mjs      — Supabase 表读写（funds / nav_history / fund_details / fund_ai_summary / favorites）
   ├─ lib/eastmoney.mjs  — 抓东方财富、解析、分类、评分、生成结构化分析
   └─ lib/ai.mjs         — DashScope 调用（OpenAI 兼容端点 + 重试）
        ↓
Supabase Postgres + Auth（韩国首尔）
```

前端 SDK 仅用于登录（拿 `access_token`），所有业务读写都走自家 `/api/*`，token 通过 `Authorization` 头透传给服务端用 admin client 校验。注册走 `/api/auth/signup`，因为要绕过邮箱验证（admin API）。

### 表与 RLS（与代码强绑定）

- `funds`（主键 `code`）：基金主表，所有展示字段都从这里来；`upsertFunds` 按 `code` 冲突合并
- `nav_history`：净值历史，唯一键 `(code, nav_date)`，每次刷新追加当日快照
- `fund_details`：F10 投资目标/范围/基准缓存（首次访问时按需抓取并落库）
- `fund_ai_summary`：AI 点评缓存（主键 `code`），与 funds 1:1
- `favorites`：唯一键 `(user_id, code)`，**开 RLS**（`auth.uid() = user_id`），其它表关 RLS 公开读

字段命名规则：DB 用 snake_case（`fund_type`, `nav_date`, `return_1y`），JS 用 camelCase（`fundType`, `date`, `return1y`）。所有转换集中在 `lib/store.mjs` 的 `fundToRow` / `rowToFund`。新增字段必须两边同步。

### 关键模块约束

- `lib/eastmoney.mjs` 解析的是东方财富 JSONP/HTML 私有格式，包含两个数据源合并：基金排行接口（有完整收益数据）+ 基金代码库（兜底，让没上排行的 QDII 也能出现）。排行接口数据用 `vm.runInNewContext` 解 `var rankData = {...}`，更换数据源前先看 `parseRankData` 和 `fetchQdiiUniverse`。
- `classifyFund(name)` 是纯字符串规则（关键词匹配），用来给基金打 `region/theme/fundType/role/risk` 五个标签。`scoreFund(fund)` 也是手工权重的启发式。两者都在 `eastmoney.mjs` 里，改了之后要重新刷新才会重算落库。
- `buildStructuredAnalysis` 输出结构化分析对象给详情抽屉用，不走 AI；AI 点评（一句话）单独由 `lib/ai.mjs` 生成、单独存表。
- `loadOrRefresh` 是兜底加载逻辑：DB 没数据时自动抓一次；刷新只在 `?refresh=1` 时触发。

### 前端

- `public/index.html` 引入 `app.js`（type=module），它再 import `auth.js` 和 `chart.js`
- `chart.js` 是手写的纯 SVG 折线图，不依赖任何图表库
- `auth.js` 把 session 存在 localStorage `qdii-compass-session`；`authedFetch` 统一注入 Bearer 头，遇 401 自动清 session
- 没有框架、没有打包，编辑后刷新浏览器即可

## 工作约定

- 改任何抓取/解析逻辑前，先在浏览器或 curl 看一眼东方财富接口当前返回，格式漂移过几次
- 改表结构要同时更新：Supabase 控制台 migration + `lib/store.mjs` 的 mapper + 用到该字段的所有代码
- 历任开发文档在 `docs/qdii-supabase接入/`，含 ALIGNMENT/CONSENSUS/DESIGN/TASK/ACCEPTANCE/FINAL/TODO 全套（6A 工作流产物）
- `.env` 已在 `.gitignore`，不要提交
