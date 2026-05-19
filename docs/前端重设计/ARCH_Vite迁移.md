# 前端重设计 · 架构迁移文档（Vite + React）

> 决策（2026-05-17）：放弃原生 JS 重砌，改用 Vite + React，把 `fund/` 原型整个搬进来。**后端 `server.mjs` / `lib/*` 一行不改**。

## 一、目录结构

```
基金分析/
  server.mjs / lib/ / scripts/      ← 不动
  public/                            ← 最终为 Vite 构建产物（npm start 原样服务它）
  frontend/                          ← 新增：React 源码
    index.html                       (Vite 入口)
    vite.config.js
    src/
      main.jsx
      App.jsx                        ← 自 fund/app.jsx 适配
      components.jsx                 ← 自 fund/components.jsx
      tweaks-panel.jsx               ← 自 fund/tweaks-panel.jsx
      compass.css                    ← 自 fund/compass.css
      lib/
        api.js                       ← 真实 /api/* 封装（替换 data.jsx 的假数据）
        auth.js                      ← 自 public/auth.js 迁移（npm 版 supabase）
        spark.js                     ← 保留 data.jsx 的走势图生成等纯函数
      features/chat/                 ← 自 public/chat.js 迁移（真实 SSE 流式）
  scripts/dev.mjs                    ← 新增：一条命令同时起后端+Vite（无新依赖，用 child_process）
```

## 二、运行方式

- **开发**：`npm run dev` → 同时启动 ① 后端（`PORT=8787`，仅环境变量，不改代码）② Vite dev（5173），Vite 把 `/api` 代理到 `127.0.0.1:8787`。
- **生产**：`npm run build`（Vite 产物输出到 `public/`）→ `npm start`（现有命令原样服务 `public/`，`/api` 同源）。
- 迁移期间 **不向 public/ 构建**，只用 Vite dev 跑，旧 `public/` 保持可用；达到功能对齐后再做"切换"步骤（产物落 public/，旧文件归档备份）。

## 三、依赖新增（devDependencies）

`react` `react-dom` `vite` `@vitejs/plugin-react`。`@supabase/supabase-js` 已是依赖，改为本地包 import（原走 esm.sh CDN）。

## 四、数据层映射（data.jsx 假数据 → 真实接口）

| 原型用法 | 真实来源 |
|---|---|
| `FUNDS` | `GET /api/funds` 的 `funds[]`（字段见 lib/store.mjs rowToFund） |
| `KPIS` | 由 funds 派生（沿用 renderSummary 口径：总数 / 晨星4+ / 科技成长占比 / 更新时间） |
| `getFundDetail(code)` | `GET /api/fund/:code`（净值历史+持仓+费率+配置等） |
| 经理简历 | `GET /api/manager/:id` |
| AI 投顾对话 | `POST /api/chat`（SSE 流式）+ `/api/chat/suggestions` `/sessions` `/history` |
| 登录/注册 | `/api/config` + Supabase SDK + `/api/auth/signup` |
| 自选 | `GET/POST /api/favorites` |
| 走势图毛刺/采样函数 | 保留 data.jsx 纯函数（仅去掉假 FUNDS/KPIS/会话） |

字段差异处理：原型 mock 字段（return1y/sharpe/aum/rating/risk/status/top3…）逐一映射到真实字段（return1y / sharpe1y / aumBillion / ratingMorningstar / risk / purchaseStatus / 详情接口持仓）；缺失值做兜底（不画图/不显示，不报错）。

## 五、字段映射细则（原型 → 真实）

| 原型 fund.* | 真实 fund.* | 备注 |
|---|---|---|
| code/name/region/theme/role/risk/manager | 同名 / managerNames | manager 取 managerNames 第一个 |
| rating | ratingMorningstar | 可空 → 不显示星 |
| sharpe | sharpe1y | |
| aum | aumBillion | 单位"亿"，美元基金后缀亿美元 |
| drawdown | maxDrawdown1y | |
| return3m/return1y/returnYtd | 同名 | |
| status: open/limit/stop | purchaseStatus: 开放/限购/暂停 | |
| limitYuan | purchaseLimitYuan | |
| top3 | 详情接口持仓前 3（列表初期可空，决策1后续后端补） | 列表先兜底空 |
| sparkSeed→迷你图 | 详情净值历史；列表期先用 spark.js 生成示意，待后端补真实点 | 标注口径 |

## 六、风险与对策

1. **切换前不碰 public/**：迁移期 Vite dev 独立跑，旧站不受影响，零停机。
2. **登录/AI 是重活**：auth.js 近乎可直接复用；chat.js（SSE 流式 957 行）按现协议迁移为 React 组件，逐字段对齐。
3. **构建产物落 public/ 会覆盖旧文件**：切换前把 `public/{app,auth,chat,chart}.js`、`index.html`、`styles.css` 归档到 `public_legacy/`，可回滚。
4. **无测试**：每阶段手动走查关键路径。
5. **npm 安装**：需可访问 npm registry；若环境受限会即时反馈。

## 七、阶段（每阶段完成展示、确认再继续）

- A. 脚手架：Vite 工程 + 依赖 + dev 脚本 + 代理；空壳能起。
- B. 搬原型 UI（components/compass.css/App）+ tweaks，跑通假数据观感（= 原型 1:1）。
- C. 数据层接真实 /api/funds + 派生 KPI + 详情抽屉接 /api/fund/:code。
- D. 登录/注册/自选接入（auth.js 迁移 + 头像菜单）。
- E. AI 投顾接真实 SSE 对话 + 历史 + 推荐问题。
- F. 对比功能 + 经理简历 + 收尾 + 响应式。
- G. 切换：构建落 public/，旧站归档，`npm start` 验证生产路径；更新 CLAUDE.md/进度文档。
