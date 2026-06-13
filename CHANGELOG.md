# 更新记录

本文件记录 [QDII 基金罗盘](https://github.com/Rskyss/funds) 的版本变更。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)（主版本.次版本.修订号）。

---

## [1.5.1] - 2026-06-12

### 修复

- **会话历史时间显示**：历史列表的时间此前直接展示 UTC（伦敦）时间，比北京时间慢 8 小时（如 09:42 显示成 01:42）。改为按浏览器所在时区换算后再显示，与后台 `/admin` 时间显示口径一致（`frontend/src/components.jsx`）。

### 改进

- **AI 热议推荐自动更新**：热议问题的「是否需要更新」检查此前仅在服务进程启动时执行一次，长期运行（数周不重启）期间从不复查，导致开场热议长期不变。现接入每日定时数据刷新（07:00 `/api/funds?refresh=1`）：每日刷新后后台自动检查一次，板块当日异动（|涨跌| > 2.5%）当天即可更新，平稳期最多 30 天兜底刷新；失败静默降级，不影响主流程（`server.mjs`）。

### 说明

- 纯前端展示与后端触发时机调整，**无新增表/字段**。
- 上线步骤：`npm run build` → 同步 `public/` 与 `server.mjs` → `pm2 restart funds`。

---

## [1.5.0] - 2026-05-20

### 新增

- **服务端登录接口** `POST /api/auth/signin`：登录改走后端，统一邮箱规范化与密码首尾空白处理；错误信息中文化（`lib/authSignIn.mjs`）。
- **运维脚本** `npm run auth:reset-password`：管理员通过 Supabase Admin 重置指定用户密码（`scripts/reset-user-password.mjs`）。
- **前端错误边界**：根组件增加 `ErrorBoundary`，运行时异常可见报错与重试，避免整页白屏。

### 修复

- **申购限购展示**：东财返回「限大额」等无具体金额时，详情/列表/聊天卡片由「限购 null元/日」改为 **「大额限购」**。
- **登录流程**：前端不再直连 Supabase `signInWithPassword`，改调 `/api/auth/signin`，与注册路径一致。
- **注册/登录提示**：常见 Supabase 英文错误转为中文可读文案。

### 改进

- **顶栏品牌区**：文字品牌「QDII 罗盘 · FUND COMPASS · PRO」，可点击回首页。
- **详情·前 10 大重仓**：过滤无效持仓行；加载中与无数据分态；商品/债基主题显示对应说明。
- **详情·资产配置表**：增加「其他/期货等/债券等」列与堆叠条，补足 100% 构成展示。
- **详情·费率区**：赎回费率骨架高度收紧。
- **登录弹窗**：错误提示改用红色语义色。

### 生产部署

- **域名**：https://funds.aisoup.ai（Nginx 反代 → PM2 `funds`，端口 `3002`）
- **目录**：`/www/wwwroot/funds`
- **发版**：`npm run build` → 同步 `public/` 与后端 → `pm2 restart funds`

### 依赖与上线步骤

1. `npm install` → `npm run build` → 部署 `public/`、`server.mjs`、`lib/authSignIn.mjs`
2. `.env` 仍需 `SUPABASE_*`；无新增表/字段
3. 可选：`npm run auth:reset-password -- <邮箱> <新密码>`

### 已知限制（继承 v1.4）

- 多基金对比栏、偏好设置入口、完整筛选工具栏等仍未接入新 UI
- 详情持仓/费率仍可能首次为空（异步补抓）
- `npm run dev` 在部分代理环境下可能空白，验收建议 `build + start`

---

## [1.4.0] - 2026-05-20

### 新增

- **AI 热议推荐**：AI 投顾开场问题改为「2 条 🔥 实时热议 + 4 条固定推荐」；热议带暖色样式；板块日涨跌 |超过 2.5%| 或距上次生成超过 30 天触发重写；失败时静默降级为纯固定库。
- **管理后台**（`/admin`）：密码登录；概览（用户 / 邀请码 / 对话数）；用户列表；邀请码批量生成与删除；对话记录分页查看。
- **详情页 AI 长点评**：基金抽屉新增 250–350 字、3–4 段扩展点评（与列表卡片一句话区分）；新增 `rules/detail_blurb.md`；`npm run ai:detail` 批量生成（支持 `--limit` / `--force` / `--code`）。
- **聊天思考过程**：流式回复时展示可折叠的「思考过程」（模型开启 thinking 时）。
- **首页板块风向**：顶部由 KPI 四宫格改为「今日 QDII 板块风向」（主题只数 + 今日平均涨跌），点击可筛选列表。
- **只看自选**：列表支持「只看自选」；未登录点击引导登录。
- **排序升/降序**：收益、夏普、评级、规模等排序支持再次点击切换升序/降序。

### 改进

- **列表卡片迷你走势**：使用 `spark_json` 在卡片上展示净值迷你曲线（v1.3 已落库，本版接上 UI）。
- **AI 卡片短点评**：规则收紧为单句 30–42 字、只讲一个重点；输出自动去除 `(X字)`、外层引号等。
- **AI 投顾回答**：合成约束收紧（约 250 字内、基金只写 6 位代码、禁止重复卡片数字与引用清单）；推荐问题库约 16 条改写（去代码、口语化）。
- **打开基金交互**：再次点击同一只基金可关闭详情抽屉。
- **视觉**：主强调色调整为 `#3480F4`。
- **路由**：`/admin` 等前端路径支持 SPA 回退（直接访问不 404）。
- **文档**：`CLAUDE.md` 补充架构与运维说明；新增 `docs/ai-热议推荐/`（建表 SQL、上线步骤、交付说明）。

### 依赖与上线步骤

1. **Supabase 新表** `chat_hot_suggestions`（见 `docs/ai-热议推荐/migration.sql`）。
2. **`fund_ai_summary` 增加字段**（详情长点评，若尚未添加）：

```sql
alter table fund_ai_summary
  add column if not exists detail_summary text,
  add column if not exists detail_model text,
  add column if not exists detail_generated_at timestamptz;
```

3. **环境变量**：`.env` 配置 `ADMIN_PASSWORD`（管理后台）；热议生成仍需 `DASHSCOPE_API_KEY`，可选 `TAVILY_API_KEY`。
4. **发版命令**：`npm install` → `npm run build` → `npm start`；可选 `npm run ai:detail` 回填详情点评。

### 已知限制（相对 v1.3，仍未迁移）

- **多基金对比栏**（勾选最多 6 只、底部对比表）尚未接入新 UI。
- **偏好设置弹窗**（5 题画像）仍无入口；后端 `/api/profile` 与 `rules/persona.md` 仍可用。
- **筛选工具栏**：区域 / 主题 / 用途下拉、申购状态分段、列表分页/无限滚动仍为占位或未完整接入。
- **聊天多份额脚注**（`altShares`）尚未迁移。
- **详情持仓/费率**：首次请求可能为空（异步补抓），偶发需重开抽屉或清缓存。
- **开发模式**：系统 HTTP 代理可能导致 `npm run dev` 空白，验收建议 `npm run build && npm start`。

---

## [1.3.0] - 2026-05-19

### 重大变更

- **前端迁移至 Vite + React 18**：源码在 `frontend/`，`npm run build` 产出到 `public/`；v1.2 原生 JS 前端归档至 `public_legacy/`。
- **全新 UI**：Hero KPI 区、基金卡片、详情抽屉、AI 侧栏等整体重设计（Inter + JetBrains Mono 字体）。

### 新增

- **构建与开发命令**：`npm run dev`（Vite + 后端代理）、`npm run build`、`npm run preview`。
- **列表净值迷你曲线数据**：`funds.spark_json` 字段；刷新时自动生成；`npm run data:spark` 单独回填。
- **列表内存快照**：详情接口复用全表快照，减少重复查询。
- **服务启动自检**：数据早于最近定时更新时刻时，后台自动补刷。
- **前端本地缓存**：基金列表 7 天、详情 24 小时（`fundsCache` / `detailCache`）。
- **详情抽屉预览态**：打开时先用列表字段渲染，接口返回后再更新。
- **Agent 事件搜索优化**：按重仓股 + 主题拼搜索词；Tavily 改 `news` 主题、30 天内、结果去重。
- **合规卡**：新增「定投收益 vs 区间涨幅」禁止混算规则。

### 改进

- 详情页持仓、费率改为服务端异步补抓，首屏更快返回。
- 静态资源：`/assets/*` 长期缓存，HTML 入口 `no-cache`。
- Supabase SDK 从前端 CDN 改为 npm 包引入。

### 已知限制（相对 v1.2，后续版本补齐）

- **多基金对比栏**（勾选最多 6 只、底部对比表）尚未迁移到新 UI。
- **偏好设置弹窗**（5 题画像 → AI 千人千面）尚无入口；后端 `/api/profile` 与 `rules/persona.md` 仍可用。
- **筛选与排序**：区域 / 主题 / 用途下拉、申购状态分段、排序切换、「只看自选」、列表分页/无限滚动尚未接好（工具栏部分为占位 UI）。
- **列表卡片迷你走势图**：`spark_json` 已落库，列表卡 UI 尚未展示曲线。
- **聊天多份额脚注**（`altShares` 卡片备注）尚未迁移。
- **详情持仓/费率**：首次请求可能为空（异步补抓 + 详情缓存），偶发需关闭重开或清缓存后才看到完整数据。
- **开发模式**：系统 HTTP 代理可能导致 `npm run dev` 页面空白，日常验收请用 `npm run build && npm start`。

### 依赖说明

- 需在 Supabase `funds` 表增加 `spark_json`（json/jsonb 数组）字段。
- 发版前执行 `npm install` 与 `npm run build`，`npm start` 服务的是构建后的 `public/`。

---

## [1.2.0] - 2026-05-16

### 新增

- **邀请码注册**：注册需填写邀请码；服务端校验、占用与回滚；`npm run invite:gen` 批量生成邀请码写入 `invite_codes` 表。
- **用户画像「投资年限」**：偏好设置新增第 5 题（投资基金年限），写入 `user_profiles.fund_years`。
- **千人千面 AI 表达**：新增 `rules/persona.md` 策略卡，合成层按用户画像调整话术深浅与建议倾向。
- **推荐问题可配置化**：话术迁至 `rules/suggestions.md`，新增 `GET /api/chat/suggestions`；支持按基金动态替换回撤、夏普、评级等占位符。
- **快捷提问入口**：基金卡片与详情抽屉增加「向 AI 提问」按钮，一键带入当前基金上下文。
- **登录门槛**：未登录时勾选对比基金会引导登录。

### 改进

- 聊天推荐问题改为服务端下发，产品可直接改 `rules/suggestions.md` 而无需改前端代码。
- AI 合成（流式与非流式）注入用户画像，回答更贴合个人偏好。
- 偏好设置文案与说明优化（4 题 → 5 题）。

### 依赖说明

- 需在 Supabase 中已存在 `invite_codes` 表（字段：`code`、`status`、`expires_at`、`used_at`、`used_by` 等）。
- 需在 `user_profiles` 表增加 `fund_years` 字段（若尚未迁移）。

---

## [1.1.1] - 2026-05-16

### 文档

- `README.md` 全文改为中文，统一章节标题与说明表述。

---

## [1.1.0] - 2026-05-16

### 新增

- 首次开源发布：QDII 基金列表、筛选、对比、详情与净值图表。
- 东方财富 / 天天基金数据抓取与 Supabase 持久化。
- 用户登录、收藏、偏好设置。
- AI 基金短点评（DashScope）与聊天式 Agent（筛选 / 对比 / 概念 / 事件 / 持仓检索）。
- 数据回填与定时刷新脚本（F10、指标、持仓、经理、费率、向量等）。
