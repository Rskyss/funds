/**
 * 定时全量刷新（供 cron 调用，需本机服务已启动）
 * 示例：0 7 * * * cd /path/to/基金分析 && node --env-file=.env scripts/scheduled-refresh.mjs
 */
const port = process.env.PORT || "5173";
const base = (process.env.APP_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");

const res = await fetch(`${base}/api/funds?refresh=1`, { method: "GET" });
if (!res.ok) {
  const text = await res.text().catch(() => "");
  console.error(`刷新失败 HTTP ${res.status}`, text.slice(0, 200));
  process.exit(1);
}
const data = await res.json();
console.log(
  `刷新完成：${data.total} 只基金，页面展示更新时间 ${data.fetchedAtText || "--"}`,
);
