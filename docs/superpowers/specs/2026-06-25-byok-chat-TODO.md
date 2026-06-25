# BYOK 上线前待办（必须你手动完成）

代码已全部写完并通过审查，但要让功能真正跑起来，还差两步**只能你来做**的配置/验证。

## 1.（必做）给数据库加 3 个字段

到 Supabase 控制台 → SQL Editor，粘贴执行：

```sql
alter table user_profile
  add column if not exists ai_api_key_cipher text,
  add column if not exists ai_chat_model text,
  add column if not exists ai_review_model text;
```

> 不加这三列，保存设置会报错。`if not exists` 可安全重复执行。

## 2.（已完成，确认即可）加密密钥

`.env` 里已自动生成并写入 `AI_KEY_SECRET`（64 位随机串，用于加密用户 Key）。

- 本地：已就绪，重启服务生效。
- 生产服务器（PM2 进程 `funds`，路径 `/www/wwwroot/funds`）：需要把这一行 `AI_KEY_SECRET=...` 同样加到服务器的 `.env`，然后重启 `funds` 进程。**这个密钥一旦上线不要再改**，否则已存的用户 Key 会解不开。

## 3.（必做）端到端实测一次

做完第 1 步后：

```bash
npm run build && npm start
```

浏览器打开 http://localhost:5173，登录后：

1. 打开「AI 投顾」抽屉 → 应显示「填写你的百炼 API Key 后即可使用」+「去设置」，输入框灰掉。
2. 点头像 →「模型设置」→ 弹窗先只显示 Key 输入框 +「验证 Key」。
3. 填你的真实百炼 Key → 点「验证 Key」→ 通过后出现「短/长评模型」「投问模型」两个框 → 都填 `qwen-plus`（或你想用的）→ 保存。
4. 再开 AI 投顾 → 正常提问、能出回答。
5. 打开任一基金详情 → 点评区有「用我的模型重新生成」→ 点一下，点评换成你模型生成的版本；关掉详情再打开 → 回到共享版（没存库）。
6. 点「模型设置」→「清除我的配置」→ AI 投顾回到引导态。

## 说明

- 短评/长评的全站共享版（734 只已生成的）继续用你后台的 Key，普通访客不配 Key 也能看。
- 只有「聊天投问」和「用我的模型重新生成点评」用用户自己的 Key。
- 分支：`feat/byok-chat`（11 个提交）。实测通过后再合并到 main。
