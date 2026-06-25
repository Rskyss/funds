# 用户自带百炼 Key（BYOK）+ 每用户模型设置 — 设计文档

日期：2026-06-25（v2，方案 A 确认后重写）
状态：已与用户确认，待评审

## 1. 目标与背景

本项目开源、由运营方部署成 demo 供不会自建的普通用户直接使用。核心目的：**让用户自带阿里云百炼 API Key，运营方不替所有人承担 AI 费用**。

每个登录用户在头像下拉菜单的「模型设置」里配置 **3 项**：

1. **百炼 API Key**（先填、点验证；验证通过后才显示下面两项）
2. **短/长评模型**（生成基金点评用）
3. **投问模型**（聊天问答用）

锁定阿里云百炼（OpenAI 兼容协议），不支持其它平台。本期不做用量统计/计费。

## 2. 两类 AI 的处理（方案 A）

| AI 功能 | 默认表现 | 用户配置后 |
|---------|---------|-----------|
| **聊天投问** | 未配置 Key → 禁用 + 引导 | 用**用户自己的 Key + 投问模型**，每次提问都走用户的 Key |
| **短/长评（点评）** | 显示**全站共享**的预生成点评（运营方后台 Key 批量生成，所有用户共享，免费白看） | 详情里多一个「用我的模型重新生成点评」按钮：用**用户自己的 Key + 短/长评模型**当场生成，**只给该用户看、不落库**（刷新回到共享版） |

要点：
- 共享点评（734 只已生成）继续用运营方平台 Key，普通访客零门槛即看，**不被用户 Key 影响**。
- 真正持续烧钱的聊天投问，强制 BYOK。
- 短/长评的「重新生成」是按需、临时、不持久化的，不新建每用户点评存储、不动现有共享缓存。

## 3. 用户交互流程

**入口**：右上角头像下拉菜单，邮箱与「退出登录」之间新增「模型设置」。

**模型设置弹窗**（渐进式显示）：
1. 一个「百炼 API Key」密码输入框 + 「验证」按钮。已配置过则显示掩码提示（如 `sk-****abcd`，留空=不改）。
2. 点「验证」：后台用该 Key + 探测模型 `qwen-plus` 发一次最小请求。失败提示错误；成功后**展开**下面两个输入框。
3. 「短/长评模型」「投问模型」两个文本框（占位示例 `qwen-plus`），已配置则回填。
4. 「保存」：后台用 Key + 投问模型再校验一次投问模型可用，通过则加密存库。
5. 「清除我的配置」：删除 Key 与两个模型，聊天回到禁用引导态。

**聊天面板 gate**：
| 状态 | 表现 |
|------|------|
| 未登录 | 禁用，「登录后使用」（现状不变） |
| 已登录、未配置 Key | 禁用，提示「填写你的百炼 API Key 后即可使用」+「去设置」按钮（打开模型设置弹窗） |
| 已登录、已配置 | 正常问答，用用户 Key + 投问模型 |

**基金详情**：已配置 Key 的用户，详情点评区多一个「用我的模型重新生成」按钮；点击 → 调用户 Key + 短/长评模型 → 当场替换显示（不落库）。未配置 Key 的用户不显示该按钮。

## 4. 数据存储

复用现有 `user_profile` 表（单数；RLS 已开 `auth.uid()=user_id`）。新增 3 列：

| 列 | 类型 | 说明 |
|----|------|------|
| `ai_api_key_cipher` | text | AES-256-GCM 加密后的 Key 密文（`ivHex:tagHex:dataHex`），明文永不落库 |
| `ai_chat_model` | text | 投问模型名 |
| `ai_review_model` | text | 短/长评模型名 |

- 加密：服务端用 `.env` 新增 `AI_KEY_SECRET`（32 字节 / 64 位 hex）做 AES-256-GCM。集中在新增的 `lib/crypto.mjs`。
- 后端**永不返回完整 Key**，只返回掩码 + 两个模型名 + `aiConfigured`。

## 5. 后端改动

### 5.1 聊天链路用用户凭证

`lib/ai.mjs` 的 `chatCompletion` / `chatCompletionStream` 增加可选 `apiKey` 入参（缺省回退 env）。`planner.plan` / `synth.synthesize` / `synth.synthesizeStream` 增加 `creds = { apiKey, model }` 入参：`creds.model` 存在则只用该模型（不走 modelChain）、`apiKey` 透传。`/api/chat` 从登录用户画像读取并解密凭证（`apiKey` + `ai_chat_model`），缺失 → 403 `NO_AI_KEY`。`runPlan`（嵌入/检索）不变，仍用平台 Key。

### 5.2 短/长评按用户模型临时生成

`lib/ai.mjs` 的 `generateFundSummary` / `generateFundDetailSummary` 增加可选 `apiKey` 入参（缺省回退 env）。新增端点 `POST /api/fund/:code/ai-summary/preview`：校验登录 + 读用户凭证（`apiKey` + `ai_review_model`），用其生成短评（必要时长评），**直接返回、不落库**。未配置 Key → 403。
（现有 `POST /api/fund/:code/ai-summary` 走平台 Key + 落库的逻辑保留不动，供运营方批量/手动刷新。）

### 5.3 凭证校验与接口

- `validateAiCredentials({ apiKey, model })`（`lib/ai.mjs` 新增）：最小请求校验。
- `POST /api/profile/ai/validate` `{ aiApiKey }`：用探测模型 `qwen-plus` 校验 Key → `{ ok, error? }`。
- `GET /api/profile`：返回 `aiChatModel` / `aiReviewModel` / `aiKeyMask` / `aiConfigured`。
- `POST /api/profile`：接受 `aiApiKey`（明文，空=不改）、`aiChatModel`、`aiReviewModel`、`clearAiKey`；保存前校验投问模型；加密存库。

## 6. 前端改动

- 新增 `frontend/src/AiSettingsModal.jsx`：渐进式（验证 Key→展开两个模型）。
- `components.jsx`：`TopBar` 头像菜单加「模型设置」；`AIDrawer` 加未配置引导态 + 禁用输入；`FundDrawer` 点评区加「用我的模型重新生成」按钮（仅 `aiConfigured` 时显示）。
- `App.jsx`：登录后拉 `/api/profile` 得 `aiConfigured`，下发给 `TopBar` / `AIDrawer` / `FundDrawer` 与弹窗。
- `data.js` / 既有 `authedFetch`：新增 profile 与 preview 调用。

## 7. 环境变量

`.env` / `.env.example` 新增 `AI_KEY_SECRET`（`openssl rand -hex 32` 生成，不提交 git）。

## 8. 范围之外

- 不支持百炼以外平台 / 自定义 Base URL。
- 不做用量统计、计费、配额。
- 不为短/长评建每用户持久化存储（重新生成是临时的）。
- 不改运营方批量生成点评、向量、热议的平台 Key 路径。

## 9. 验收标准

1. 登录但未配置 Key：聊天禁用 + 引导，详情无「重新生成」按钮。
2. 模型设置弹窗：先验证 Key，成功后才出现两个模型框；填好保存成功。
3. 配置后聊天正常，用的是用户 Key + 投问模型（后台日志可验证）。
4. 详情点「用我的模型重新生成」：用用户 Key + 短/长评模型生成新点评、当场替换，刷新后回到共享版（未落库）。
5. 无效 Key 验证/保存：提示失败、不写库。
6. DB 中 `ai_api_key_cipher` 为密文，`GET /api/profile` 不返回完整 Key。
7. 共享点评、向量、批量生成不受影响，仍用平台 Key。
8. 「清除我的配置」后回到未配置态。
