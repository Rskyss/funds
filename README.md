# QDII Fund Compass

本项目是一个本地运行的 QDII 基金查询、筛选、对比和 AI 问答 Web app。前端使用原生浏览器 JavaScript，后端使用 Node.js HTTP 服务；数据持久化在 Supabase Postgres，基金数据主要来自东方财富/天天基金公开页面，AI 能力通过阿里云百炼 DashScope OpenAI 兼容接口调用。

> 本工具仅用于基金信息整理和辅助筛选，不构成投资建议。基金数据、持仓和申购状态可能有延迟，请以基金公司公告和销售平台为准。

## Features

- QDII 基金列表、收益、评分、费率、限购状态展示
- 基金详情、净值历史、F10 投资目标/范围/业绩基准缓存
- 收藏、自选和登录态管理
- AI 基金短点评批量生成
- 聊天式 Agent：支持筛选、比较、概念解释、事件问题和持仓关键词检索
- 同基金不同份额提示，例如人民币、美元现汇、C 类份额

## Project Structure

```text
server.mjs          # HTTP server and API routes
lib/                # Supabase, auth, scraping, AI, embeddings, agent logic
public/             # Static frontend: HTML/CSS/JS
scripts/            # Data backfill, refresh, embedding, AI summary jobs
rules/              # Agent prompt/rule cards
docs/               # Architecture and planning documents
outputs/            # Generated reports; ignored by Git
```

## Requirements

- Node.js 20+ recommended. The app uses native `fetch` and `node --env-file`.
- A Supabase project with the expected tables and RPC functions.
- DashScope API key for AI summaries, embeddings, and chat.

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env` with your own values:

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

Do not commit `.env`. Keep real API keys and Supabase secrets out of normal source files.

## Development

```bash
npm start
```

Open:

```text
http://localhost:5173
```

There is no bundler or build step. After frontend edits, refresh the browser. After changing `.env`, restart `npm start`.

## Useful Commands

```bash
npm run data:refresh      # Scheduled fund data refresh
npm run data:f10          # Backfill F10 fund details
npm run data:metrics      # Backfill risk/return metrics
npm run data:holdings     # Backfill holdings
npm run data:managers     # Backfill fund managers
npm run data:fees         # Backfill fees and purchase status
npm run data:embed        # Generate document embeddings
npm run ai:generate       # Generate cached AI fund summaries
npm run agent:test        # Run scripted agent cases
```

For small AI summary batches:

```bash
npm run ai:generate -- --limit 10
npm run ai:generate -- --force
```

## Data Notes

- Fund list and return data come from Eastmoney fund ranking pages.
- F10 details come from Tiantian Fund pages.
- Holdings are disclosure-based and lag real portfolios.
- Database fields use `snake_case`; JavaScript uses `camelCase`. Mapping lives in `lib/store.mjs`.

## Security

Before publishing to GitHub, verify that only `.env.example` contains placeholder configuration. Real keys should stay in `.env`, which is ignored by Git.
