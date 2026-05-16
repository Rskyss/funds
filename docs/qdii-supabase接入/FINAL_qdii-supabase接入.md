# FINAL — QDII 基金罗盘 · Supabase 接入 · 项目总结

## 一句话总结
保留原有原生 JS 项目的所有功能，新接入 Supabase 作为数据持久层和用户系统，新增净值历史走势图和用户收藏能力，本地运行验证全部通过。

## 你能做什么

| 操作 | 怎么用 |
|---|---|
| 浏览基金 | 打开 http://localhost:5173 即可看到 726 只 QDII 基金 |
| 搜索/筛选 | 顶部搜索框、按区域/主题/用途下拉、按多种维度排序 |
| 看详情 | 点卡片"详情" → 抽屉里有"净值走势曲线 + AI 结构化分析 + 基金资料" |
| 对比基金 | 卡片右上勾选"对比"，最多 6 只同屏对比 |
| 注册账号 | 右上"登录" → 切到"注册一个" → 邮箱 + 6 位以上密码 |
| 收藏基金 | 登录后卡片左上的 ☆ 变金色 ★ 表示已收藏；顶部"只看自选"切换 |
| 刷新数据 | 右上"刷新数据"，会重新抓东方财富并把新快照写入 Supabase |

## 技术要点（产品视角）

- **数据云存储**：本地不再依赖 `.cache` 文件，所有基金信息存到你的 Supabase（韩国首尔区域）
- **历史净值积累**：每次刷新都会追加一条快照；天天基金会每天产生新数据，你刷得越多，走势图越长
- **零编译**：保持原生 JS，没有引入构建工具，浏览器直接跑
- **登录免邮件验证**：本地用方便注册，上线前请去 Supabase Dashboard 重新开启邮箱验证

## 启动命令

```bash
cd "/Users/rs/Desktop/project/基金分析"
npm install     # 仅首次
npm start       # 启动后访问 http://localhost:5173
```

## 文件结构

```
基金分析/
├── .env                      # 私密，已被 .gitignore 忽略
├── .env.example              # 配置模板（可提交）
├── package.json              # 加了 @supabase/supabase-js
├── server.mjs                # HTTP 入口 + 路由
├── lib/
│   ├── supabase.mjs          # Supabase admin client
│   ├── eastmoney.mjs         # 东方财富数据抓取 + 分类 + 评分 + 分析
│   ├── store.mjs             # Supabase 读写封装
│   └── auth.mjs              # Token 校验
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js                # 主前端
│   ├── auth.js               # Supabase JS SDK 登录
│   └── chart.js              # 纯 SVG 走势图（不依赖第三方库）
└── docs/qdii-supabase接入/   # 全过程文档
```

## 数据安全

- 所有写入用 secret_key（仅服务端持有）
- 收藏表开 RLS：用户只能看到/操作自己的收藏
- 公开表（funds/nav_history/fund_details）允许匿名只读

## 已确认验收
见 `ACCEPTANCE_qdii-supabase接入.md`
