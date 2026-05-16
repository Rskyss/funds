# ACCEPTANCE — QDII 基金罗盘 · Supabase 接入

## 验收检查

| 编号 | 标准 | 结果 | 验证方式 |
|---|---|---|---|
| 1 | `npm install && npm start` 一次成功 | ✅ 通过 | 安装 9 个包，服务监听 5173 |
| 2 | 首次访问列表渲染 ≥ 100 只 QDII 基金 | ✅ 726 只 | `/api/funds` 返回 total=726 |
| 3 | 点击"刷新数据"，Supabase `funds` 表行数增加或更新 | ✅ 通过 | funds_count=726, nav_count=220 |
| 4 | 详情页能看到历史净值点 | ✅ 通过 | `/api/fund/012920` 返回 navHistory 20 个点 |
| 5 | 注册 → 登录 → 收藏 → 刷新页面 → 收藏仍在 | ✅ 通过 | 端到端脚本验证全链路 |
| 6 | 退出登录后，收藏入口隐藏 | ✅ 通过 | `onAuthChange` 回调切换 UI |
| 7 | `.env` 不在 `git status` 输出里 | ✅ 通过 | `.gitignore` 已包含 `.env` |

## 关键接口验证日志

```
GET /api/config            → { url, publishableKey }
GET /api/funds             → { total: 726, fetchedAtText: "2026/5/14 21:14:53", funds: [...] }
GET /api/fund/012920       → { code, goal, navHistory(20), analysis(...) }
POST /api/auth/signup      → { ok:true, userId:"e2baa7c8-..." }
POST /api/favorites        → { ok:true }
GET /api/favorites         → { favorites:["012920"] }
DELETE /api/favorites/012920 → { ok:true }
```

## 数据库状态（Supabase Studio 可验证）

```
funds         : 726 行
nav_history   : 220 行（仅有当期净值的基金会写入历史）
fund_details  : 0 行（按需写入，访问详情时累积）
favorites     : 0 行（用户自行创建）
auth.users    : 0 行（删除了测试账号）
```

## 文件清单

### 新增
- `.env`
- `.env.example`
- `lib/supabase.mjs`
- `lib/store.mjs`
- `lib/eastmoney.mjs`
- `lib/auth.mjs`
- `public/auth.js`
- `public/chart.js`
- `docs/qdii-supabase接入/*.md`（6 份文档）

### 重写
- `server.mjs`（HTTP 路由 + 业务编排，业务逻辑移到 lib/）

### 修改
- `package.json`（加 `@supabase/supabase-js`，`npm start` 加 `--env-file=.env`）
- `public/index.html`（加登录、自选切换、详情走势图容器）
- `public/app.js`（接 Supabase Auth、收藏、走势图）
- `public/styles.css`（追加 145 行新样式）
- `.gitignore`（加 `.env`）
