# QDII 基金罗盘

**当前版本：1.2.0** · [更新记录](CHANGELOG.md)

本地运行的 QDII 基金查询、筛选、对比与 AI 问答 Web 应用。前端为原生浏览器 JavaScript，后端为 Node.js HTTP 服务；数据持久化在 Supabase Postgres，基金数据主要来自东方财富 / 天天基金公开页面，AI 能力通过阿里云百炼 DashScope（OpenAI 兼容接口）调用。

> 本工具仅用于基金信息整理和辅助筛选，不构成投资建议。基金数据、持仓和申购状态可能有延迟，请以基金公司公告和销售平台为准。

## 功能

- QDII 基金列表、收益、评分、费率、限购状态展示
- 基金详情、净值历史、F10 投资目标 / 范围 / 业绩基准缓存
- 收藏、自选与登录态管理
- AI 基金短点评批量生成
- 聊天式 Agent：筛选、比较、概念解释、事件问答、持仓关键词检索
- 同基金不同份额提示（如人民币、美元现汇、C 类等）

## 项目结构

```text
server.mjs          # HTTP 服务与 API 路由
lib/                # Supabase、鉴权、抓取、AI、向量、Agent 逻辑
public/             # 静态前端（HTML / CSS / JS）
scripts/            # 数据回填、刷新、向量、AI 点评等脚本
rules/              # Agent 策略与提示词卡片
docs/               # 架构与规划文档
outputs/            # 生成的报告（Git 忽略）
```

## 环境要求

- 推荐 Node.js 20+（使用原生 `fetch` 与 `node --env-file`）
- 已配置好表结构与 RPC 的 Supabase 项目
- 使用 AI 点评、向量检索或聊天时需配置 DashScope API Key

## 安装与配置

```bash
npm install
cp .env.example .env
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
```

更多可选项见 `.env.example`（如 Agent 轮次、Tavily 搜索、数据更新时间等）。

请勿将 `.env` 提交到 Git；真实密钥只放在本地 `.env` 中。

## 本地开发

```bash
npm start
```

浏览器访问：

```text
http://localhost:5173
```

无打包、无构建步骤。改前端后刷新浏览器即可；改 `.env` 后需重启 `npm start`。

## 常用命令

```bash
npm run data:refresh      # 定时刷新基金数据
npm run data:f10          # 回填 F10 基金详情
npm run data:metrics      # 回填风险收益指标
npm run data:holdings     # 回填持仓
npm run data:managers     # 回填基金经理
npm run data:fees         # 回填费率与申购状态
npm run data:embed        # 生成文档向量
npm run ai:generate       # 批量生成 AI 基金短点评
npm run agent:test        # 运行 Agent 脚本用例
```

AI 点评小批量示例：

```bash
npm run ai:generate -- --limit 10   # 仅前 10 只
npm run ai:generate -- --force        # 覆盖已有缓存
```

## 数据说明

- 基金列表与收益数据来自东方财富基金排行页
- F10 详情来自天天基金页面
- 持仓为定期披露数据，相对实际持仓有滞后
- 数据库字段为 `snake_case`，JavaScript 为 `camelCase`，映射在 `lib/store.mjs`

## 安全提示

发布到 GitHub 前请确认：仓库中仅有 `.env.example` 占位配置，真实密钥保留在已被 Git 忽略的 `.env` 中。
