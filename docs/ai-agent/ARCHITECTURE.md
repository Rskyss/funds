# AI 投顾 · 架构图（2026-05 现行）

> 替代早期对话里的旧版图。与 `server.mjs`、`lib/agent/*`、`public/chat.js` 实现一致。

## 升级后流程图（推荐 · 对齐旧版布局）

与早期「自家服务 → 数据 → 用户端」三张结构一致，标注已落地的能力。

```mermaid
flowchart TB
  subgraph UI [用户端]
    direction TB
    ChatUI["聊天抽屉 chat.js<br/>输入 · 流式气泡 · 基金卡片 · 历史列表"]
    AppUI["基金罗盘 app.js<br/>列表筛选 · 详情抽屉 · 收藏对比"]
    Store["浏览器 localStorage<br/>会话 ID · 对话缓存 · 历史索引 · 登录态"]
    ChatUI <--> Store
    AppUI <--> Store
    ChatUI -.->|点击卡片| AppUI
  end

  subgraph SRV [自家服务 server.mjs]
    direction TB
    Entry["POST /api/chat?stream=1<br/>GET sessions / history · profile"]
    RL["限流 metrics.mjs"]
    Session["会话 session.mjs<br/>多轮上下文 · lastCodes"]
    Planner["规划层 planner.mjs<br/>qwen-turbo"]
    Rules["rules/*.md → rules.mjs<br/>filter / 合规 / 对比 / 概念 / 事件"]
    Tools["工具层 tools.mjs"]
    Thematic["行业词 thematic.mjs<br/>存储→半导体 等"]
    Synth["合成层 synth.mjs<br/>qwen-max · 流式"]
    Entry --> RL --> Session
    Entry --> Planner
    Planner --> Rules
    Planner --> Tools
    Tools --> Thematic
    Tools --> Synth
    Session --> Tools
  end

  subgraph EXT [数据与外部]
    direction TB
    SB["Supabase<br/>funds · fund_details · fund_ai_summary<br/>fund_doc_chunks · chat_sessions<br/>user_profile · chat_logs"]
    DS["阿里云百炼 DashScope<br/>规划 · 合成 · embedding"]
    TV["Tavily 联网搜索<br/>可选 TAVILY_API_KEY"]
    EM["东方财富 eastmoney.mjs<br/>刷新基金池 · F10 · 经理档案"]
  end

  ChatUI -->|"SSE: session → plan → tools → cards → sources → delta → done"| Entry
  Synth -->|"逐字推送 delta"| ChatUI
  AppUI -->|"/api/funds · /api/fund/:code"| Entry

  Planner --> DS
  Synth --> DS
  Tools --> DS
  Tools --> SB
  Tools --> TV
  Session --> SB
  EM --> SB

  classDef ui fill:#eef2ff,stroke:#6366f1,color:#1e1b4b
  classDef srv fill:#f0fdf4,stroke:#16a34a,color:#14532d
  classDef ext fill:#fffbeb,stroke:#d97706,color:#78350f
  class UI ui
  class SRV srv
  class EXT ext
```

### 工具层分支（按意图）

```mermaid
flowchart LR
  PlanJSON["规划 JSON<br/>intent + filter/codes/queries"]
  PlanJSON --> F{intent?}

  F -->|filter / mixed| T1["filterFunds<br/>结构化筛 funds"]
  F -->|filter + 行业词| T2["retrieveDocs 主题 RAG<br/>fund_doc_chunks"]
  F -->|compare| T3["getFundsByCodes<br/>+ 可选 getFundContext"]
  F -->|concept| T4["conceptKnowledge<br/>内置术语"]
  F -->|event / mixed| T5["webSearchEvent<br/>Tavily 或降级"]
  F -->|needF10| T6["retrieveDocs<br/>按基金代码检索 F10 片段"]

  T1 --> Out["工具结果 state<br/>funds · sources · trace"]
  T2 --> Out
  T3 --> Out
  T4 --> Out
  T5 --> Out
  T6 --> Out
  Out --> Synth2["合成层 qwen-max<br/>只根据工具结果写回答"]
```

---

## 总览（模块关系简图）

```mermaid
flowchart TB
  subgraph client [用户端]
    App[基金罗盘 app.js<br/>列表 / 详情抽屉 / 收藏]
    Chat[AI 投顾 chat.js]
    LS[(localStorage<br/>会话 ID · 对话缓存 · 历史索引 · 登录态)]
  end

  subgraph server [自家服务 server.mjs]
    API["POST /api/chat?stream=1"]
    SessAPI["GET /api/chat/sessions<br/>GET /api/chat/history"]
    Profile["GET/POST /api/profile"]
    Plan[规划层 planner.mjs<br/>qwen-turbo]
    Rules[rules/*.md → rules.mjs]
    Tools[工具层 tools.mjs<br/>+ thematic.mjs]
    Synth[合成层 synth.mjs<br/>qwen-max 流式]
    Sess[会话 session.mjs]
    Metrics[限流 / chat_logs metrics.mjs]
  end

  subgraph data [数据与外部]
    SB[(Supabase)]
    EM[东方财富抓取 eastmoney.mjs]
    DS[阿里云百炼 DashScope]
    TV[Tavily 联网<br/>可选 · TAVILY_API_KEY]
  end

  App -->|/api/funds · /api/fund/:code| API
  Chat -->|SSE| API
  Chat --> SessAPI
  Chat <--> LS
  App <--> LS

  API --> Metrics
  API --> Sess
  API --> Plan
  Plan --> Rules
  Plan --> DS
  API --> Tools
  Tools --> SB
  Tools --> TV
  Tools --> DS
  Tools --> Synth
  Synth --> DS
  Synth -->|event: delta / cards / sources| Chat
  Sess --> SB
  Profile --> SB
  EM --> SB
```

## 一轮对话怎么走

```mermaid
sequenceDiagram
  participant U as 用户
  participant C as chat.js
  participant S as server.mjs
  participant P as planner
  participant T as tools
  participant Y as synth
  participant DB as Supabase

  U->>C: 输入问题
  C->>S: POST /api/chat?stream=1
  S->>DB: loadSession / getUserProfile
  S-->>C: SSE session
  S->>P: planAgent（意图 + filter/codes）
  P-->>S: plan JSON
  S-->>C: SSE plan
  S->>T: runPlan
  T->>DB: filter / RAG / F10 / 基金行
  opt event 或 mixed 且已配 key
    T->>T: webSearchEvent → Tavily
  end
  T-->>S: funds + sources + trace
  S-->>C: SSE tools / cards / sources
  S->>Y: synthesizeStream
  Y-->>C: SSE delta（逐字）
  S-->>C: SSE final / done
  S->>DB: saveSession + chat_logs
```

## 组件职责

| 层级 | 文件 | 模型/依赖 | 做什么 |
|------|------|-----------|--------|
| **规划层** | `lib/agent/planner.mjs` | `DASHSCOPE_MODEL_FAST`（默认 qwen-turbo） | 听懂用户 → 输出 JSON 计划：`intent` / `filter` / `codes` / `conceptQuery` / `eventQuery` / `needF10` |
| **策略卡片** | `rules/*.md` + `lib/agent/rules.mjs` | — | 合规、筛选政策、对比/概念/事件话术；由 `prompts.mjs` 拼装进规划层/合成层 system |
| **工具层** | `lib/agent/tools.mjs` | Supabase、可选 Tavily、embedding | 按计划查库、RAG、联网；返回结构化结果给合成层 |
| **主题映射** | `lib/agent/thematic.mjs` | — | 「存储/半导体」等行业词 → 主题 + RAG 查询（找基场景） |
| **合成层** | `lib/agent/synth.mjs` | `DASHSCOPE_MODEL_STRONG`（默认 qwen-max） | 只根据工具结果写回答；流式 `delta` |
| **会话** | `lib/agent/session.mjs` | `chat_sessions` 表 | 多轮上下文、`lastCodes` / `lastFilters` |
| **观测** | `lib/agent/metrics.mjs` | `chat_logs` 表 | 限流、每轮 intent/耗时/降级标记 |

## 工具层一览

| 工具 | 何时调用 | 数据来源 |
|------|----------|----------|
| `filterFunds` | `filter` / `mixed` | `funds` 表结构化筛选 |
| `retrieveDocs(thematic)` | 找基 + 行业主题词 | `fund_doc_chunks` 向量检索（pgvector） |
| `retrieveDocs` | `needF10` 且已有基金代码 | 同上，可按 code 过滤 |
| `getFundsByCodes` | `compare` / 点名代码 | `funds` |
| `getFundContext` | 对比且 `needF10` | `fund_details` + `fund_ai_summary` + 净值 |
| `conceptKnowledge` | `concept` / `mixed` | 内置短知识（非 RAG） |
| `webSearchEvent` | `event` / `mixed` 且配了 `TAVILY_API_KEY` | Tavily；未配置则降级话术 |

## Supabase 表（与 Agent 相关）

| 表 | 用途 |
|----|------|
| `funds` | 基金主数据、筛选排序 |
| `fund_details` | F10 目标/范围/基准 |
| `fund_ai_summary` | 一句话 AI 点评（列表/详情展示） |
| `fund_doc_chunks` | RAG 切块 + embedding |
| `chat_sessions` | 登录用户云端会话；匿名仅本地 |
| `user_profile` | 风险偏好等软约束（规划层 filter 时参考） |
| `chat_logs` | 每轮问答审计（intent、耗时、是否降级） |
| `favorites` | 收藏（与 Agent 独立） |

## 前端 SSE 事件

`POST /api/chat?stream=1` 推送事件类型：

| event | 含义 |
|-------|------|
| `session` | 会话 ID |
| `plan` | 意图与筛选条件摘要 |
| `tools` | 工具调用 trace |
| `cards` | 基金卡片数据（可点进详情抽屉） |
| `sources` | 事件类引用链接 |
| `delta` | 回答逐字片段 |
| `final` | 完整回复文本 |
| `done` | 本轮结束 |
| `error` | 异常信息 |

非流式：同一 URL 不带 `stream=1`，一次 JSON 返回。

## 与「基金详情页」的关系

详情抽屉（`app.js` → `showDetail`）与 Agent **共用**后端数据，但 **不走** `/api/chat`：

- 净值走势、四宫格、专业指标 + AI 点评（`fund_ai_summary`）、晨星、经理档案等 → `GET /api/fund/:code`
- 列表 AI 一句话 → 批量脚本 `npm run ai:generate` 写入 `fund_ai_summary`

## 环境变量（Agent）

见根目录 `.env.example`：

- `DASHSCOPE_API_KEY` / `DASHSCOPE_MODEL_FAST` / `DASHSCOPE_MODEL_STRONG`
- `TAVILY_API_KEY`（可选，事件解读）
- `AGENT_MAX_TURNS`（会话轮数上限）

## 旧图 vs 现行差异（备忘）

| 旧图/旧说法 | 现行 |
|-------------|------|
| `rules/` 仅草稿、未接入 | **已接入** `prompts.mjs` |
| 仅 `filter` 结构化检索 | 增加 **行业主题 RAG**、`event` 时也会带候选基金 |
| 会话只写 Supabase | **localStorage 优先** + 登录用户 `chat_sessions` / `history` API |
| 无历史列表 API | 已有 `GET /api/chat/sessions` |
| 合成层非流式 | 默认 **SSE 流式** `delta` |
