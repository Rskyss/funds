# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

QDII 基金罗盘：本地运行的 QDII 基金查询/筛选/对比/AI 点评/聊天 Agent 的 Web 应用。当前版本 **1.8.0**（1.6 引入 BYOK 用户自带百炼 Key；1.7 筛选多选/同类内评分；1.7.1 安全加固与工程补全；1.7.3 线上体检修复：东财接口连通、无数据不评分、持仓 30 天缓存、数据库瞬时错误重试、数据完整性告警；1.7.4 净值停更基金标注与沉底、无日期净值当缺失；1.8.0 详情页「去哪里买」购买引导）：

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
npm test                                 # 单元测试（node --test tests/*.test.mjs，不需要 .env）

# 开发模式（双进程：后端 8787 + Vite 5174，Vite 代理 /api；端口可用 BACKEND_PORT / FRONTEND_PORT 覆盖）
npm run dev
# 注意：系统 HTTP 代理可能导致 dev 页面空白，验收时改用 build + start

# 数据回填 / 刷新
npm run data:refresh                     # 定时刷新基金列表
npm run data:spark                       # 回填列表迷你净值曲线（funds.spark_json）
npm run data:f10                         # F10 投资目标/范围/基准 + 基金管理人（缺公司字段的会补；结尾打印无官网对照的公司）
npm run data:metrics                     # 风险收益指标
npm run data:holdings                    # 持仓
npm run data:managers                    # 基金经理
npm run data:fees                        # 费率与申购状态
npm run data:embed                       # 文档向量

# AI / Agent
npm run ai:generate                      # 批量生成列表 AI 短点评（全部）
npm run ai:generate -- --limit 10        # 仅生成前 10 只
npm run ai:generate -- --force           # 重新生成所有（覆盖已存在）
AI_CONCURRENCY=8 npm run ai:generate     # 调整并发（默认 5）
npm run ai:detail                        # 生成详情页长点评（generate-detail-summary.mjs）
npm run agent:test                       # 跑 scripts/test-agent-cases.mjs 的聊天用例

# 运维脚本
npm run invite:gen                       # 生成邀请码写入 invite_codes（注册已不强制邀请码，仅后台留用）
npm run invite:gen -- 10                 # 一次生成 10 个
npm run auth:reset-password              # 重置某用户密码（reset-user-password.mjs）
```

所有 Node 脚本都通过 `node --env-file=.env` 加载环境变量，**无需** 第三方 dotenv。改 `.env` 后必须重启服务。改 `frontend/` 源码后需要重新 `npm run build`（或用 `npm run dev` 热更新）。

**有 `npm test` 单元测试（纯函数：评分、排行解析守卫、静态路径守卫、限流、出站超时、净值校验），没有 linter。** 后端/Agent 改动跑 `npm test`，聊天链路再跑 `npm run agent:test`（需 `AGENT_TEST_TOKEN`＝已配 BYOK 用户的 access_token）；抓取/解析改动跑对应 `data:*` 脚本核对落库结果；UI 改动 `build + start` 后浏览器实测；服务起来后 `GET /api/health` 看版本与数据库连通。

## 必需的环境变量

参考 `.env.example`：

- `SUPABASE_URL` / `SUPABASE_SECRET_KEY` — 服务端写入和 Auth 管理用（`supabaseAdmin`）
- `SUPABASE_PUBLISHABLE_KEY` — 通过 `/api/config` 下发给前端，仅做匿名读和登录
- `AI_KEY_SECRET` — **BYOK 用**：加解密每用户的百炼 Key（`lib/crypto.mjs`，存进 `user_profile.ai_api_key_cipher`）。改这个值会让已存的用户 Key 全部解不开
- `DASHSCOPE_API_KEY` — 平台级 Key，用于**批量脚本**（短/长点评、向量生成）和未配 BYOK 时的兜底；聊天 Agent 现在**优先用用户自带 Key**
- `DASHSCOPE_CHAT_MODELS` — 逗号分隔的聊天模型顺位列表，第一个不可用自动顺位降级（见 `lib/ai.mjs`）
- `DASHSCOPE_MODEL` / `DASHSCOPE_MODEL_STRONG` — 少数未走模型链的直连调用用的单点模型（`MODEL_FAST` / `STRONG_FALLBACK` / `AGENT_MAX_TURNS` 已废弃，代码不再读取）
- `DASHSCOPE_ENABLE_THINKING` / `DASHSCOPE_THINKING_BUDGET` — Qwen 思考模式开关与预算
- `DATA_REFRESH_TOKEN` — 全量刷新授权：`GET /api/funds?refresh=1` 需带 `x-refresh-token`（或后台管理员登录态）；未配置时只接受本机直连（127.0.0.1 且未经反代）；`DATA_REFRESH_COOLDOWN_MS` 两次刷新最短间隔（默认 10 分钟）
- `AGENT_RATE_LIMIT` / `FETCH_TIMEOUT_MS` / `DASHSCOPE_TIMEOUT_MS` / `DASHSCOPE_STREAM_TIMEOUT_MS` — 聊天限流与出站超时，有默认值
- `NET_AUTOSELECT_ATTEMPT_TIMEOUT_MS`（默认 1500）— Node 多 IP "快速切换"每个地址的等待；生产服务器到东财 `fundmobapi` 往返 400ms+，用 Node 默认 250ms 会永远连不上（1.7.3 修复）。`HOLDINGS_TTL_DAYS`（默认 30）— 详情页持仓/资产配置缓存有效期
- `TAVILY_API_KEY` — 留空则事件类问题降级
- `DATA_UPDATE_TIME` — 首页「更新时间」展示对齐的定时批次（默认 `07:00` Asia/Shanghai）
- `ADMIN_PASSWORD` — 后台管理（`/api/admin/*` + 前端 `Admin.jsx`）登录口令；未配置则后台接口返回 503

缺 Supabase 变量服务会启动失败（`lib/supabase.mjs` 顶层抛错）；缺 DashScope/`AI_KEY_SECRET` 变量只在调用对应 AI 路径时失败。

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
   ├─ lib/store.mjs         — Supabase 表读写（字段映射在 `lib/fundRow.mjs`，纯函数可单测；无日期的净值读写两侧都当缺失）
   ├─ lib/eastmoney.mjs     — 抓东方财富、解析、分类、评分、结构化分析
   ├─ lib/ai.mjs            — DashScope 调用（OpenAI 兼容端点 + 重试 + 多模型路由）
   ├─ lib/embedding.mjs     — 文档向量化（fund 文档检索）
   ├─ lib/dataSchedule.mjs  — 定时批次时间对齐与启动自检补刷
   ├─ lib/crypto.mjs        — BYOK 用户 Key 加解密 / 掩码（encryptSecret/decryptSecret/maskSecret）
   ├─ lib/http.mjs          — HttpError / clientIp / resolvePublicPath（静态路径守卫）/ safeEqual / isUuid
   ├─ lib/fetchTimeout.mjs  — 所有出站 fetch 的统一超时封装（默认 15s，超时抛 TimeoutError）
   ├─ lib/rateLimit.mjs     — 进程内滑动窗口限流（登录/注册/聊天/后台/埋点等都用它）
   ├─ lib/navValidation.mjs — 净值行入库校验（非正数/未来日期不入库）
   ├─ lib/retryFetch.mjs    — Supabase 请求瞬时错误（401 issued-at-future / 网关 5xx / 读请求网络瞬断）重试一次
   ├─ lib/dataQuality.mjs   — 关键字段空值统计与告警（刷新日志 + /api/health）
   ├─ lib/purchaseGuide.mjs — 购买引导「去哪里买」纯函数：申购状态 + 基金公司 → 能否买/文案/渠道链接（天天基金基金页 + 公司官网）；官网对照表 `lib/data/fund-companies.json`（只接受 https）
   └─ lib/agent/*           — 聊天 Agent：planner / session / tools / synth / rules ...
        ↓
Supabase Postgres + Auth
```

前端 SDK 仅用于登录拿 `access_token`，所有业务读写走自家 `/api/*`，token 由 `Authorization` 头透传给服务端，用 admin client 校验。注册走 `/api/auth/signup` 是为了用 admin API 绕过邮箱验证（`email_confirm: true`）。**注册现在只校验邮箱+密码，开放注册，不再要邀请码**（早期的邀请码校验已移除，`invite_codes` 表与函数仅后台统计/留用）。

**API 面（`server.mjs`）**：`/api/health`（探活：版本/数据更新时间/DB 连通/`dataQuality` 关键字段空值统计，`warn:true` 表示大面积缺失）；业务 `/api/funds`（`?refresh=1` 全量重抓需 `DATA_REFRESH_TOKEN`/后台登录/本机直连，且单飞 + 冷却）、`/api/fund/:code`（含 `purchaseGuide` 购买引导）、`/api/chat?stream=1`（SSE；限流按用户，续写会话校验归属）、`/api/profile`、`/api/profile/ai/validate`（BYOK 存 Key 前校验）、`/api/favorites`、`/api/events`（前端 `track.js` 匿名埋点上报，类型白名单 page_view/fund_open/search/filter/buy_click）；`POST /api/fund/:code/ai-summary`（用平台 Key 覆盖共享点评）仅限后台管理员；后台 `/api/admin/*`（login/verify/stats/behavior/users/invites/chats，用内存 token + `ADMIN_PASSWORD`）。登录/注册/后台登录/Key 校验/点评重生成/埋点/经理页代理都有限流；未预期异常只返回通用文案 + requestId，细节在服务端日志。

### 表与 RLS（与代码强绑定）

- `funds`（主键 `code`）：基金主表，列表/卡片所有展示字段都从这里来；`upsertFunds` 按 `code` 冲突合并；新增 `spark_json` 字段存列表迷你净值曲线（降采样）
- `nav_history`：净值历史，唯一键 `(code, nav_date)`，每次刷新追加当日快照
- `fund_details`：F10 投资目标/范围/基准缓存（首次访问时按需抓取并落库）；`company_id`/`company_name` 为基金管理人（东财公司 id + 名称，购买引导查官网对照表用，1.8 新增）
- `fund_ai_summary`：AI 点评缓存（主键 `code`），与 funds 1:1
- `favorites`：唯一键 `(user_id, code)`，**开 RLS**（`auth.uid() = user_id`）
- `user_profile`（**单数**，注意别写成 `user_profiles`）：用户画像（含 `fund_years` 等）；BYOK 列 `ai_api_key_cipher`（加密后的用户百炼 Key）/ `ai_chat_model` / `ai_review_model`
- `events`：匿名行为埋点（前端 `track.js` → `/api/events` → `insertEvents`），后台行为分析用
- `invite_codes`：邀请码（`code` / `status` / `expires_at` / `used_at` / `used_by`）——注册已不强制，仅后台统计与 `invite:gen` 留用

所有表都开了 RLS：基金类表（`funds` / `nav_history` / `fund_details` / `fund_ai_summary` / `chat_hot_suggestions`）公开只读；`favorites` 仅本人；`user_profile` / `chat_sessions` / `chat_logs` / `fund_doc_chunks` / `events` / `invite_codes` 对浏览器侧**无任何策略也无表权限**，只有服务端 service role 能读写（1.7.1 收口——之前四张表的 `*_admin_all` 策略是对公网全开的）。结构定义在 `supabase/migrations/`。

**字段命名规则**：DB `snake_case`（`fund_type`, `nav_date`, `return_1y`），JS `camelCase`（`fundType`, `date`, `return1y`）。所有转换集中在 `lib/fundRow.mjs` 的 `fundToRow` / `rowToFund`（1.7.4 从 `store.mjs` 抽出，纯函数可单测）。新增字段必须 `supabase/migrations/` 新文件（并以同名应用到线上）、mapper、调用点三处同步。

### 关键模块约束

- `lib/eastmoney.mjs` 解析东方财富私有格式：基金排行接口（完整收益数据）+ 基金代码库（兜底，让没上排行的 QDII 也出现）。排行接口用 `vm.runInNewContext` 解 `var rankData = {...}`；要换数据源先看 `parseRankData` 和 `fetchQdiiUniverse`。所有 fetch 走 `lib/fetchTimeout.mjs`；抓取失败一律**抛错**（不再返回空值，否则脚本会把空结果连同 `*_fetched_at` 一起落库、之后永久跳过）；`parseFundRow` 字段数不足返回 null，整批解析失败中止刷新。
- `classifyFund(name)` 是纯字符串关键词规则，给基金打 `region/theme/fundType/role/risk` 五标签，改了要重刷数据才会重算落库。评分为**同主题内**百分位（`applyPercentileScores` 按 `theme` 分组，附 `peerRank`/`peerCount`；不足 6 只标"同类样本少"；净值日期比全站最新落后 14 天以上的基金由 `lib/dataQuality.mjs markStaleNav` 标 `navStaleDays`，不打分、标"净值停更"、列表沉底、AI 筛选剔除，读取时现算不落库），服务读库时实时重算，改公式重启即生效、无需重刷数据；纯函数单测在 `tests/score.test.mjs`（`node --test tests/*.test.mjs`）。
- 购买引导（1.8）：本站**不销售基金**，页面只叫「去哪里买」+ 免责声明，不出现「购买/立即买入」；外链只可能来自 `ttfundUrl(code)` 模板或对照表里的 https 地址；暂停/封闭时按钮置灰；新基金公司出现时 `npm run data:f10` 结尾会列出缺对照的公司，补进 `lib/data/fund-companies.json` 后重启服务（表在进程内缓存）。
- `buildStructuredAnalysis` 输出结构化分析对象给详情抽屉用，**不走 AI**；AI 点评（一句话）由 `lib/ai.mjs` 生成、单独存 `fund_ai_summary` 表。
- `loadOrRefresh` 是兜底加载：DB 没数据时自动抓一次；用户主动刷新需要 `?refresh=1`。
- `lib/dataSchedule.mjs` 在服务启动时自检：数据早于最近 `DATA_UPDATE_TIME` 批次会后台补刷。所有全量刷新都经 `server.mjs` 的 `runRefreshOnce()` 单飞（并发触发共用一个 Promise）。线上每日 07:00 由服务器 root crontab 调 `scripts/scheduled-refresh.mjs`（带 flock），日志在 `/www/wwwroot/funds/logs/data-refresh.log`。
- 详情接口复用列表内存快照，减少重复查询；持仓和费率在详情请求里异步补抓，首屏先返回再后台补。

### 聊天 Agent（`lib/agent/`）

- `planner.mjs` — 决定下一步用什么工具（filter / compare / concept / event / inquire ...）
- `tools.mjs` — 工具实现（基金筛选、对比、关键词检索、Web 搜索等）
- `synth.mjs` — 合成最终回答，注入 `rules/persona.md` 的用户画像话术
- `rules.mjs` — 从 `rules/*.md` 加载策略卡片
- `session.mjs` — 多轮会话状态
- `shareClass.mjs` / `metrics.mjs` / `thematic.mjs` — 份额、指标、主题相关辅助
- `hotTopics.mjs` / `hotTopicTrigger.mjs` — 热议推荐生成与触发判定（纯函数，同板块异动 24h 只生成一次）
- 推荐问题话术在 `rules/suggestions.md`，由 `GET /api/chat/suggestions` 下发，支持占位符替换（回撤/夏普/评级等）

### 前端（`frontend/src/`）

- `main.jsx` → `App.jsx` 是入口；`components.jsx` 集中放卡片/抽屉/侧栏等组件
- `compass.css` 全站样式（Inter + JetBrains Mono）
- `auth.js` 封装 Supabase 登录、session 存 localStorage、`authedFetch` 注入 Bearer 头（401 自动清 session）
- `fundsCache.js`（列表 7 天）/ `detailCache.js`（详情 24 小时）是浏览器本地缓存
- `data.js` 是 API 调用层；`AuthModal.jsx` 是登录/注册弹窗（开放注册，无邀请码字段）
- `AiSettingsModal.jsx` 是 BYOK「模型设置」弹窗（填/清自带百炼 Key、选短/长评模型）；`track.js` 是匿名行为埋点
- `Admin.jsx` 是后台管理页（独立用 `ADMIN_PASSWORD` 登录，token 存 sessionStorage，**不走** Supabase Auth）
- 构建后 `public/index.html` 引用 `public/assets/index-*.js|css`；不要手编 `public/`，会被 `npm run build` 覆盖

## 工作约定

- 改任何抓取/解析逻辑前，先 curl 或浏览器看一眼东方财富接口当前返回——格式漂移过几次
- 改表结构要三处同步：`supabase/migrations/` 加新文件并以同名应用到线上（CLI `db push` / MCP `apply_migration`）+ `lib/store.mjs` mapper + 所有用到该字段的代码；规矩见 `supabase/README.md`
- 改 Agent 行为优先改 `rules/*.md`（**改后需重启服务**，卡片在进程内永久缓存），其次才动 `lib/agent/`
- 历任开发文档在 `docs/qdii-supabase接入/`，含 ALIGNMENT/CONSENSUS/DESIGN/TASK/ACCEPTANCE/FINAL/TODO（6A 工作流产物）；前端重设计在 `docs/前端重设计/`；Agent 架构在 `docs/ai-agent/`；1.7.1 安全加固在 `docs/安全加固_1.7.1/`；总台账在 `docs/开发进度跟踪.md`（每个任务完成必须登记）
- 部署到生产走 rsync（服务器目录不是 git 仓库），见 `AGENTS.md`「生产服务器」
- 推送规则：一个版本＝远端恰好一个提交，标题 `vX.Y 一句话主题`，正文**先列「解决问题：1.～n」**（每条一句"之前 → 现在"），再分「新增功能 / 优化功能 / 修复bug」；`.githooks/pre-push` 拦截不合规标题（`git config core.hooksPath .githooks` 启用）；不发版就不推 main；推送/tag/部署先经用户指示
- `outputs/` 是脚本产物，已 Git 忽略
- `.env` 已在 `.gitignore`，发版前确认仓库只有 `.env.example`
