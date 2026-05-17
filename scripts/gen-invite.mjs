// 生成邀请码并写入 invite_codes 表。
// 用法：
//   npm run invite:gen                生成 1 个
//   npm run invite:gen -- 10          生成 10 个
//   npm run invite:gen -- 10 内测     生成 10 个并备注「内测」

import { createInviteCodes } from "../lib/store.mjs";

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const count = Math.max(1, Math.min(200, parseInt(process.argv[2], 10) || 1));
const note = process.argv[3] || null;

const rows = Array.from({ length: count }, () => ({ code: randomCode(), note }));

const created = await createInviteCodes(rows);

console.log(`已生成 ${created.length} 个邀请码${note ? `（备注：${note}）` : ""}：\n`);
for (const r of created) console.log("  " + r.code);
console.log("\n把邀请码发给要注册的人即可，每个码只能用一次。");
