# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

QDII 基金罗盘：本地运行的 QDII 基金查询/筛选/对比/AI 点评/聊天 Agent 的 Web 应用。当前版本 **1.5.0**：

- 前端：Vite + React 18，源码在 `frontend/`，`npm run build` 产出到 `public/`
- 后端：Node 原生 HTTP 服务（`server.mjs`），无框架
- 数据：Supabase Postgres + Auth（韩国首尔）
- 基金原始数据：东方财富 / 天天基金公开页（私有 JSONP/HTML 格式）
- AI：阿里云百炼 DashScope（OpenAI 兼容协议）+ 可选 Tavily Web 搜索

v1.2 的原生 JS 前端已归档到 `public_legacy/`，新前端 v1.3 尚未迁移的能力详见 `CHANGELOG.md`。

## 常用命令

```bash
# 安装与构建
npm install                              # 仅首次
npm run build                            # 构建前端到 public/
npm start                                # 启动 HTTP 服务（http://localhost:5173），服务的是 public/
npm run preview                          # build + start 一条命令

# 开发模式（双进程：后端 8787 + Vite 5173，Vite 代理 /api）
npm run dev
# 注意：系统 HTTP 代理可能导致 dev 页面空白，验收时改用 build + start

# 数据回填 / 刷新
npm run data:refresh                     # 定时刷新基金列表
npm run data:spark                       # 回填列表迷你净值曲线（funds.spark_json）
npm run data:f10                         # F10 投资目标/范围/基准
npm run data:metrics                     # 风险收益指标
npm run data:holdings                    # 持仓
npm run data:managers                    # 基金经理
npm run data:fees                        # 费率与申购状态
npm run data:embed                       # 文档向量

# AI / Agent / 邀请码
npm run ai:generate                      # 批量生成 AI 短点评（全部）
npm run ai:generate -- --limit 10        # 仅生成前 10 只
npm run ai:generate -- --force           # 重新生成所有（覆盖已存在）
AI_CONCURRENCY=8 npm run ai:generate     # 调整并发（默认 5）
npm run agent:test                       # 跑 scripts/test-agent-cases.mjs 的聊天用例
npm run invite:gen                       # 生成邀请码写入 invite_codes
```

所有 Node 脚本都通过 `node --env-file=.env` 加载环境变量，**无需** 第三方 dotenv。改 `.env` 后必须重启服务。改 `frontend/` 源码后需要重新 `npm run build`（或用 `npm run dev` 热更新）。

**没有测试套件、没有 linter**。后端/Agent 改动跑 `npm run agent:test`；抓取/解析改动跑对应 `data:*` 脚本核对落库结果；UI 改动 `build + start` 后浏览器实测。

## 必需的环境变量

参考 `.env.example`：

- `SUPABASE_URL` / `SUPABASE_SECRET_KEY` — 服务端写入和 Auth 管理用（`supabaseAdmin`）
- `SUPABASE_PUBLISHABLE_KEY` — 通过 `/api/config` 下发给前端，仅做匿名读和登录
- `DASHSCOPE_API_KEY` — 走 AI 点评 / 聊天 Agent / 向量生成时必填
- `DASHSCOPE_MODEL` / `DASHSCOPE_MODEL_FAST` / `DASHSCOPE_MODEL_STRONG` / `DASHSCOPE_MODEL_STRONG_FALLBACK` — 不同任务（合成、规划、强模型、降级）用不同模型
- `DASHSCOPE_ENABLE_THINKING` / `DASHSCOPE_THINKING_BUDGET` — Qwen 思考模式开关与预算
- `AGENT_MAX_TURNS` — Agent 最多轮次（默认 12）
- `TAVILY_API_KEY` — 留空则事件类问题降级
- `DATA_UPDATE_TIME` — 首页「更新时间」展示对齐的定时批次（默认 `07:00` Asia/Shanghai）

缺 Supabase 变量服务会启动失败（`lib/supabase.mjs` 顶层抛错）；缺 DashScope 变量只在调用 AI 路径时失败。

## 架构

聊天 Agent 的分层图与 SSE 事件说明在 [`docs/ai-agent/ARCHITECTURE.md`](docs/ai-agent/ARCHITECTURE.md)。策略卡片在 `rules/`，由 `lib/agent/rules.mjs` 加载。

### 数据流

```
浏览器 (frontend/src/*.jsx + 构建产物 public/)
   ├─ @supabase/supabase-js → 直连 Supabase Auth 登录
   └─ fetch /api/* + Authorization: Bearer <access_token>
        ↓
Node http server (server.mjs)
   ├─ lib/auth.mjs          — 用 admin client 校验 Bearer，解出 userId
   ├─ lib/store.mjs         — Supabase 表读写 + DB↔JS 字段映射
   ├─ lib/eastmoney.mjs     — 抓东方财富、解析、分类、评分、结构化分析
   ├─ lib/ai.mjs            — DashScope 调用（OpenAI 兼容端点 + 重试 + 多模型路由）
   ├─ lib/embedding.mjs     — 文档向量化（fund 文档检索）
   ├─ lib/dataSchedule.mjs  — 定时批次时间对齐与启动自检补刷
   └─ lib/agent/*           — 聊天 Agent：planner / session / tools / synth / rules ...
        ↓
Supabase Postgres + Auth
```

前端 SDK 仅用于登录拿 `access_token`，所有业务读写走自家 `/api/*`，token 由 `Authorization` 头透传给服务端，用 admin client 校验。注册走 `/api/auth/signup` 是为了用 admin API 绕过邮箱验证 + 校验邀请码。

### 表与 RLS（与代码强绑定）

- `funds`（主键 `code`）：基金主表，列表/卡片所有展示字段都从这里来；`upsertFunds` 按 `code` 冲突合并；新增 `spark_json` 字段存列表迷你净值曲线（降采样）
- `nav_history`：净值历史，唯一键 `(code, nav_date)`，每次刷新追加当日快照
- `fund_details`：F10 投资目标/范围/基准缓存（首次访问时按需抓取并落库）
- `fund_ai_summary`：AI 点评缓存（主键 `code`），与 funds 1:1
- `favorites`：唯一键 `(user_id, code)`，**开 RLS**（`auth.uid() = user_id`）
- `user_profiles`：用户画像（含 `fund_years` 等）
- `invite_codes`：邀请码（`code` / `status` / `expires_at` / `used_at` / `used_by`）

`favorites` 与 `user_profiles` 走 RLS；其它表关 RLS 公开读。

**字段命名规则**：DB `snake_case`（`fund_type`, `nav_date`, `return_1y`），JS `camelCase`（`fundType`, `date`, `return1y`）。所有转换集中在 `lib/store.mjs` 的 `fundToRow` / `rowToFund`。新增字段必须 Supabase migration、mapper、调用点三处同步。

### 关键模块约束

- `lib/eastmoney.mjs` 解析东方财富私有格式：基金排行接口（完整收益数据）+ 基金代码库（兜底，让没上排行的 QDII 也出现）。排行接口用 `vm.runInNewContext` 解 `var rankData = {...}`；要换数据源先看 `parseRankData` 和 `fetchQdiiUniverse`。
- `classifyFund(name)` 是纯字符串关键词规则，给基金打 `region/theme/fundType/role/risk` 五标签。`scoreFund(fund)` 是手工权重启发式。两者改了之后要重刷数据才会重算落库。
- `buildStructuredAnalysis` 输出结构化分析对象给详情抽屉用，**不走 AI**；AI 点评（一句话）由 `lib/ai.mjs` 生成、单独存 `fund_ai_summary` 表。
- `loadOrRefresh` 是兜底加载：DB 没数据时自动抓一次；用户主动刷新需要 `?refresh=1`。
- `lib/dataSchedule.mjs` 在服务启动时自检：数据早于最近 `DATA_UPDATE_TIME` 批次会后台补刷。
- 详情接口复用列表内存快照，减少重复查询；持仓和费率在详情请求里异步补抓，首屏先返回再后台补。

### 聊天 Agent（`lib/agent/`）

- `planner.mjs` — 决定下一步用什么工具（filter / compare / concept / event / inquire ...）
- `tools.mjs` — 工具实现（基金筛选、对比、关键词检索、Web 搜索等）
- `synth.mjs` — 合成最终回答，注入 `rules/persona.md` 的用户画像话术
- `rules.mjs` — 从 `rules/*.md` 加载策略卡片
- `session.mjs` — 多轮会话状态
- `shareClass.mjs` / `metrics.mjs` / `thematic.mjs` — 份额、指标、主题相关辅助
- 推荐问题话术在 `rules/suggestions.md`，由 `GET /api/chat/suggestions` 下发，支持占位符替换（回撤/夏普/评级等）

### 前端（`frontend/src/`）

- `main.jsx` → `App.jsx` 是入口；`components.jsx` 集中放卡片/抽屉/侧栏等组件
- `compass.css` 全站样式（Inter + JetBrains Mono）
- `auth.js` 封装 Supabase 登录、session 存 localStorage、`authedFetch` 注入 Bearer 头（401 自动清 session）
- `fundsCache.js`（列表 7 天）/ `detailCache.js`（详情 24 小时）是浏览器本地缓存
- `data.js` 是 API 调用层；`AuthModal.jsx` 是登录/注册/邀请码弹窗
- 构建后 `public/index.html` 引用 `public/assets/index-*.js|css`；不要手编 `public/`，会被 `npm run build` 覆盖

## 工作约定

- 改任何抓取/解析逻辑前，先 curl 或浏览器看一眼东方财富接口当前返回——格式漂移过几次
- 改表结构要三处同步：Supabase 控制台 migration + `lib/store.mjs` mapper + 所有用到该字段的代码
- 改 Agent 行为优先改 `rules/*.md`（无需重启编辑），其次才动 `lib/agent/`
- 历任开发文档在 `docs/qdii-supabase接入/`，含 ALIGNMENT/CONSENSUS/DESIGN/TASK/ACCEPTANCE/FINAL/TODO（6A 工作流产物）；前端重设计在 `docs/前端重设计/`；Agent 架构在 `docs/ai-agent/`；阶段性进度记录在 `docs/开发进度跟踪.md`
- `outputs/` 是脚本产物，已 Git 忽略
- `.env` 已在 `.gitignore`，发版前确认仓库只有 `.env.example`
