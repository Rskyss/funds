// 重置指定用户登录密码（管理员操作，写入 Supabase Auth）
// 用法：
//   npm run auth:reset-password -- aisoup@aisoup.com 你的新密码

import { supabaseAdmin } from "../lib/supabase.mjs";
import { normalizeAuthEmail } from "../lib/authSignIn.mjs";

const email = normalizeAuthEmail(process.argv[2]);
const newPassword = process.argv[3] || "";

if (!email || !email.includes("@")) {
  console.error("用法: npm run auth:reset-password -- <邮箱> <新密码>");
  process.exit(1);
}
if (newPassword.length < 6) {
  console.error("新密码至少 6 位");
  process.exit(1);
}

const { data, error: listErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
if (listErr) {
  console.error("查询用户失败:", listErr.message);
  process.exit(1);
}

const user = (data?.users || []).find((u) => normalizeAuthEmail(u.email) === email);
if (!user) {
  console.error(`未找到用户: ${email}`);
  process.exit(1);
}

const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
  password: newPassword,
});
if (error) {
  console.error("重置失败:", error.message);
  process.exit(1);
}

console.log(`已重置 ${email} 的登录密码，请用新密码在网页登录。`);
