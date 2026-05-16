# CONSENSUS — QDII 基金罗盘 · Supabase 接入

## 明确的需求描述
在保留现有原生 JS 项目结构的前提下，接入 Supabase 作为数据持久层和用户系统，新增净值历史走势图和用户收藏能力。

## 核心功能清单
| 功能 | 描述 |
|---|---|
| F1 基金主数据持久化 | 基金代码、名称、分类、收益快照存入 Supabase，替代 .cache 文件 |
| F2 净值历史 | 每次刷新追加快照，详情页画线 |
| F3 F10 详情持久化 | 减少重复抓取，加速详情展示 |
| F4 用户系统 | Supabase Auth 邮箱注册登录 |
| F5 自选/收藏 | 登录用户可勾选基金到自选 |

## 技术实现方案
- **后端**：保留 `server.mjs`，新增 `lib/supabase.js`（admin client，用 secret key），新增 `/api/auth/*`、`/api/favorites` 路由
- **前端**：保留 `public/app.js`，新增 `public/auth.js`（用 supabase-js 浏览器 SDK，publishable key）、`public/chart.js`（Chart.js 走势图）
- **数据流**：
  1. 服务启动 → 从 Supabase `funds` 表读取上次缓存数据（秒级返回前端）
  2. 用户点"刷新" → 后端拉取东方财富 → upsert 到 `funds` + 追加 `nav_history`
  3. 用户点详情 → 先查 `fund_details`，无则抓取 F10 并写入
  4. 用户登录后 → 收藏写入 `favorites` 表

## 技术约束
- Node 版本：≥ 18（依赖原生 fetch）
- 包管理：保持 `package.json` 干净，仅添加 `@supabase/supabase-js`
- 不引入 Vue / React / 任何 build 工具，保持零编译
- 走势图用 Chart.js CDN 引入，无需 npm
- 所有密钥走 `.env`，已被 `.gitignore` 忽略

## 集成方案
| 接口 | 方法 | 用途 |
|---|---|---|
| `/api/funds` | GET | 返回基金列表（先 Supabase，必要时回退现拉） |
| `/api/funds?refresh=1` | GET | 拉新数据并写入 Supabase |
| `/api/fund/:code` | GET | 返回基金详情 + 历史净值 + 结构化分析 |
| `/api/auth/signup` | POST | 注册（代理到 Supabase Auth） |
| `/api/auth/login` | POST | 登录 |
| `/api/favorites` | GET/POST/DELETE | 查/加/删收藏（需 Bearer token） |

## 任务边界
- **In scope**：上述 5 个功能、Supabase 表结构、本地启动验证
- **Out of scope**：UI 大改、Vue 重写、部署上线、移动端适配优化、多语言、SEO

## 验收标准（可测试）
1. ✅ `npm install && npm start` 一次成功
2. ✅ 首次访问列表渲染 ≥ 100 只 QDII 基金
3. ✅ 点击"刷新数据"，Supabase `funds` 表行数增加或更新（用 Studio 验证）
4. ✅ 同一只基金详情页能看到至少 1 条历史净值点（首次刷新后）
5. ✅ 注册 → 登录 → 收藏 → 刷新页面 → 收藏仍在
6. ✅ 退出登录后，收藏入口隐藏
7. ✅ `.env` 不在 `git status` 输出里
