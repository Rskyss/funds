# Repository Guidelines

（详细的架构、表结构与工作约定见 `CLAUDE.md`，两份文档以 `CLAUDE.md` 为准。）

## 项目结构

- `server.mjs` — 原生 Node HTTP 服务与全部 `/api/*` 路由（无框架）
- `lib/` — 服务端模块：Supabase 访问（`store.mjs`）、鉴权、东方财富抓取解析（`eastmoney.mjs`）、AI 调用（`ai.mjs`）、向量、聊天 Agent（`lib/agent/`）、HTTP 工具（`http.mjs` / `fetchTimeout.mjs` / `rateLimit.mjs`）
- `frontend/` — Vite + React 18 源码；`npm run build` 产出到 `public/`（构建产物随仓库提交，服务直接托管 `public/`）
- `public_legacy/` — v1.2 原生 JS 前端归档，仅供回滚参考
- `supabase/migrations/` — 数据库结构的唯一权威定义，按文件名顺序可从零重放
- `scripts/` — 数据回填、定时刷新、AI 点评批量生成、向量入库、Agent 用例
- `rules/` — Agent 策略卡片（Markdown），改动后需重启服务生效
- `tests/` — `node --test` 单元测试（纯函数：评分、解析守卫、路径守卫、限流、超时、净值校验）
- `docs/` — 6A 工作流文档与开发进度台账（`docs/开发进度跟踪.md`）

## 常用命令

- `npm install` / `npm run build` / `npm start`（http://localhost:5173）
- `npm test` — 单元测试（不需要 .env）
- `npm run dev` — 后端 8787 + Vite 热更新
- `npm run data:refresh` — 触发全量刷新（需要 `.env` 里的 `DATA_REFRESH_TOKEN`，或在服务器本机直连）
- `npm run agent:test` — Agent 端到端用例（需 `AGENT_TEST_TOKEN`）
- 改 `.env` 需重启服务；改 `frontend/` 需重新 `npm run build`

## 代码风格

ES modules（`.mjs`，`type: module`）、两空格缩进、分号；JS 用 `camelCase`，数据库列用 `snake_case`，DB↔JS 映射只在 `lib/store.mjs`。前端是 React 函数组件；请求统一走 `frontend/src/api.js`（超时、错误文案、401 登出）。

## 测试与验证

- 单元测试：`npm test`
- 抓取/解析改动：跑对应 `data:*` 脚本核对落库
- UI 改动：`npm run build && npm start` 后浏览器实测
- 健康检查：`GET /api/health`（含版本、数据更新时间、数据库连通性）

## 提交与发版

本地开发期可以小步提交；**推向 `main` 前必须 squash 成恰好一个提交**，标题 `vX.Y 一句话主题`（修订版写 `vX.Y.Z`）；正文**第一段固定是「解决问题：」编号清单 1～n**（每条一句话：用户之前遇到什么 → 这版之后怎样），之后再按「新增功能 / 优化功能 / 修复bug」分组、用产品语言；打同名 tag + GitHub Release（Release 说明同样以「解决问题」开头）。`main` 上不允许 `docs:` / `fix:` 之类的零碎提交；`.githooks/pre-push` 会机械拦截不合规标题（clone 后执行一次 `git config core.hooksPath .githooks` 启用）。推送、打 tag、部署都是对外动作，先经用户明确指示。

## 生产服务器

线上 `funds.aisoup.ai`，PM2 进程名 `funds`（端口 3002，目录 `/www/wwwroot/funds`），本机 SSH 别名 `funds`。**服务器目录不是 git 仓库**，部署靠 rsync 同步 `server.mjs`、`lib/`、`public/`、`package.json`，再 `pm2 restart funds`。服务器 `.env` 独立维护，任何同步都不要覆盖。每日 07:00 的 crontab 调 `scripts/scheduled-refresh.mjs` 刷新数据。

## 安全与配置

复制 `.env.example` 为 `.env`，永远不要提交 `.env`。必填 `SUPABASE_URL` / `SUPABASE_SECRET_KEY` / `SUPABASE_PUBLISHABLE_KEY`；BYOK 需 `AI_KEY_SECRET`（上线后不可改）；刷新授权用 `DATA_REFRESH_TOKEN`。
