# rules · AI 投顾能力卡片

参考宠物问诊项目（`2.1/memory/`）的做法：把"一个全能 AI"拆成多张独立、可单独打磨、可热更新的能力卡片。每张卡是一个 md，专管一件事。哪个场景表现不好，改对应那张卡即可，不动代码、不影响其它能力。

## 卡片清单与对应环节

| 卡片 | 管什么 | 对应现有代码位置 |
|---|---|---|
| `compliance.md` | 红线话术、免责边界、最高优先级 | 注入 `lib/agent/prompts.mjs` 的 SYNTH_SYSTEM |
| `individuality.md` | 投顾口吻、立场、开场多变 | 同上（合成层 system 前置） |
| `inquire.md` | 需求模糊时如何反问（KYC 式） | 规划/合成层，filter 意图缺画像时 |
| `filter.md` | 模糊需求 → 结构化筛选条件 | `lib/agent/prompts.mjs` 的 PLANNER_SYSTEM |
| `compare.md` | 多只基金对比维度与结论 | 合成层，compare 意图 |
| `concept.md` | 术语讲人话 | 合成层，concept 意图 |
| `event.md` | 行情/原因解读、来源引用 | 合成层，event 意图 |
| `card_blurb.md` | 列表一句话点评风格 | `lib/ai.mjs` 的 SYSTEM_PROMPT |

## 设计依据（业界做法）
- 合规独立成卡、优先级最高：对应"独立合规校验层"实践
- 规划层（filter.md）→ 领域专家（compare/concept/event）：核心路由 + 领域专家多智能体模式
- 数字只来自工具结果、不编造：抗幻觉，金融问答 LLM 的首要风险点
- 讲框架而非代客决策、显性披露风险：可解释、可审计、面向普通用户的稳健原则

## 接入方式（已实施）

- 加载器：[`lib/agent/rules.mjs`](../lib/agent/rules.mjs) — 按文件名读卡、进程内缓存；改卡片后需 **重启 `npm start`**。
- 拼装：[`lib/agent/prompts.mjs`](../lib/agent/prompts.mjs) — 规划层引用 `filter` 卡；合成层引用 `compliance` / `individuality` / `inquire` / `compare` / `concept` / `event`。
- 列表一句话点评：[`lib/ai.mjs`](../lib/ai.mjs) 仍用内置 `SYSTEM_PROMPT`；`card_blurb.md` 供后续对齐风格时接入。

架构总图见 [`docs/ai-agent/ARCHITECTURE.md`](../docs/ai-agent/ARCHITECTURE.md)。
