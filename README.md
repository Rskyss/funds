# QDII 基金罗盘

**当前版本：1.6.0** · [更新记录](CHANGELOG.md)

本地运行的 QDII 基金查询、筛选、对比与 AI 问答 Web 应用。前端为 **Vite + React**（源码在 `frontend/`），后端为 Node.js HTTP 服务；数据持久化在 Supabase Postgres，基金数据主要来自东方财富 / 天天基金公开页面，AI 能力通过阿里云百炼 DashScope（OpenAI 兼容接口）调用。

**线上实例**：https://funds.aisoup.ai

> 本工具仅用于基金信息整理和辅助筛选，不构成投资建议。基金数据、持仓和申购状态可能有延迟，请以基金公司公告和销售平台为准。

## 功能

- QDII 基金列表、收益、评分、费率、限购状态展示；列表迷你净值曲线、板块风向筛选、只看自选、排序升/降
- 基金详情、净值历史、持仓、费率、同类对比；列表一句话 AI 点评 + 详情抽屉长点评（250–350 字）
- 收藏、自选与登录态管理（邀请码注册；登录走服务端 `/api/auth/signin`，错误提示中文化）
- AI 基金短点评 / 详情长点评批量生成（`npm run ai:generate`、`npm run ai:detail`）
- 聊天式 Agent：筛选、比较、概念解释、事件问答、持仓关键词检索；开场 **2 条 🔥 热议 + 4 条固定推荐**；流式思考过程可折叠查看
- **用户自带百炼 Key（BYOK）**：每个登录用户在「模型设置」里填自己的 API Key + 投问模型 + 短/长评模型（先验证 Key 再展开模型）；聊天投问用各自的 Key，未配置则禁用并引导；详情可「用我的模型重新生成点评」（临时、不落库）；Key 经 AES-256-GCM 加密存储、不回显
- 管理后台 `/admin`：用户、邀请码、对话记录（需配置 `ADMIN_PASSWORD`）

尚未迁移的能力见 [CHANGELOG.md · 已知限制](CHANGELOG.md#150---2026-05-20)。

## 项目结构

```text
server.mjs          # HTTP 服务与 API 路由
lib/                # Supabase、鉴权、抓取、AI、向量、Agent 逻辑
lib/authSignIn.mjs  # 服务端邮箱密码登录（publishable key）
frontend/           # React 源码（Vite 入口）
public/             # 构建产物（npm run build 生成，npm start 对外服务）
public_legacy/      # v1.2 原生 JS 前端归档（回滚参考）
scripts/            # 数据回填、刷新、向量、AI 点评等脚本
rules/              # Agent 策略与提示词卡片
docs/               # 架构与规划文档
outputs/            # 生成的报告（Git 忽略）
```

## 环境要求

- 推荐 Node.js 20+（使用原生 `fetch` 与 `node --env-file`）
- 已配置好表结构与 RPC 的 Supabase 项目
- 平台侧 AI 点评、向量检索、批量生成需配置 DashScope API Key（聊天投问改由用户自带 Key）
- 启用用户自带 Key（BYOK）需配置 `AI_KEY_SECRET`（`openssl rand -hex 32` 生成的 64 位 hex，用于加密用户 Key，上线后不可更改）

## 安装与配置

```bash
npm install
cp .env.example .env
npm run build
```

在 `.env` 中填入自己的配置（变量名勿改）：

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
DASHSCOPE_API_KEY=

DASHSCOPE_MODEL=qwen-plus
DASHSCOPE_MODEL_FAST=qwen-turbo
DASHSCOPE_MODEL_STRONG=qwen-max
DASHSCOPE_MODEL_STRONG_FALLBACK=qwen-plus
DASHSCOPE_ENABLE_THINKING=0
DASHSCOPE_THINKING_BUDGET=1200

AI_KEY_SECRET=          # 用户自带 Key（BYOK）的加密密钥；openssl rand -hex 32 生成；上线后不可更改
ADMIN_PASSWORD=          # 管理后台 /admin，留空则后台不可用
```

更多可选项见 `.env.example`（如 Agent 轮次、Tavily 搜索、数据更新时间等）。全新 Supabase 环境还需执行 `docs/ai-热议推荐/migration.sql`，并为 `fund_ai_summary` 增加详情点评字段（见 [CHANGELOG · v1.4](CHANGELOG.md#140---2026-05-20)）。**v1.6 为 `user_profile` 新增 `ai_api_key_cipher`/`ai_chat_model`/`ai_review_model` 三列（用户自带 Key）**，升级时需执行对应增列 SQL（见 [CHANGELOG · v1.6](CHANGELOG.md#160---2026-06-25)）。

请勿将 `.env` 提交到 Git；真实密钥只放在本地 `.env` 中。

## 本地开发

**日常验收（推荐）**

```bash
npm run build
npm start
```

浏览器访问 `http://localhost:5173`。

**前端热更新开发**

```bash
npm run dev
```

同时启动后端（默认 `8787`）与 Vite（`5173`），`/api` 由 Vite 代理。若本机有系统 HTTP 代理导致 dev 页面空白，请改用上面的 `build + start`。

改 `.env` 后需重启服务；改 `frontend/` 后需重新 `npm run build`（或使用 `npm run dev`）。

## 常用命令

```bash
npm run build           # 构建前端到 public/
npm run dev             # Vite 开发模式（双进程）
npm run preview         # 构建后启动服务

npm run data:refresh    # 定时刷新基金数据
npm run data:spark      # 回填列表迷你净值曲线（spark_json）
npm run data:f10        # 回填 F10 基金详情
npm run data:metrics    # 回填风险收益指标
npm run data:holdings   # 回填持仓
npm run data:managers   # 回填基金经理
npm run data:fees       # 回填费率与申购状态
npm run data:embed      # 生成文档向量
npm run ai:generate     # 批量生成 AI 基金短点评（列表卡片）
npm run ai:detail       # 批量生成 AI 详情长点评（抽屉）
npm run agent:test      # 运行 Agent 脚本用例
npm run invite:gen      # 生成邀请码
npm run auth:reset-password  # 管理员重置用户密码（需 SUPABASE_SECRET_KEY）
```

AI 点评小批量示例：

```bash
npm run ai:generate -- --limit 10
npm run ai:generate -- --force
npm run ai:detail -- --limit 10
```

密码重置示例：

```bash
npm run auth:reset-password -- user@example.com 新密码至少6位
```

## 生产部署（简要）

```bash
npm run build
# 同步代码与 public/ 到服务器，配置 .env 后：
PORT=3002 npm start   # 或使用 PM2：pm2 start npm --name funds -- start
```

Nginx 将站点根目录指向 `public/`，`/api` 与页面请求反代到 Node 进程（默认监听 `127.0.0.1:PORT`）。静态 `.js`/`.css` 需能从 `public/assets/` 正确加载。

> **从 1.5 升级到 1.6**：先在 Supabase 给 `user_profile` 增三列（见 CHANGELOG v1.6），再在服务器 `.env` 补 `AI_KEY_SECRET`（上线后不可更改），然后 `npm run build` → 同步 `public/` 与后端 → `pm2 restart funds`。

## 数据说明

- 基金列表与收益数据来自东方财富基金排行页
- F10 详情来自天天基金页面
- 持仓为定期披露数据，相对实际持仓有滞后
- 列表迷你曲线存于 `funds.spark_json`，由净值历史降采样生成
- 数据库字段为 `snake_case`，JavaScript 为 `camelCase`，映射在 `lib/store.mjs`

## 安全提示

发布到 GitHub 前请确认：仓库中仅有 `.env.example` 占位配置，真实密钥保留在已被 Git 忽略的 `.env` 中。
