/**
 * 定时全量刷新（供 cron 调用，需本机服务已启动）
 * 示例：0 7 * * * cd /path/to/基金分析 && node --env-file=.env scripts/scheduled-refresh.mjs
 *
 * 授权：.env 里配了 DATA_REFRESH_TOKEN 时随请求带 x-refresh-token；
 * 未配置时服务端只接受本机直连（127.0.0.1 且未经反代）的刷新请求。
 */
const port = process.env.PORT || "5173";
const base = (process.env.APP_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
const token = process.env.DATA_REFRESH_TOKEN || "";

const res = await fetch(`${base}/api/funds?refresh=1`, {
  method: "GET",
  headers: token ? { "x-refresh-token": token } : {},
  signal: AbortSignal.timeout(Number(process.env.REFRESH_TIMEOUT_MS || 30 * 60 * 1000)),
});
if (!res.ok) {
  const text = await res.text().catch(() => "");
  console.error(`刷新失败 HTTP ${res.status}`, text.slice(0, 200));
  process.exit(1);
}
const data = await res.json();
if (data.refreshSkipped) {
  console.log(`服务端刚刷新过（${data.refreshSkipped}），本次跳过；页面展示更新时间 ${data.fetchedAtText || "--"}`);
} else {
  console.log(`刷新完成：${data.total} 只基金，页面展示更新时间 ${data.fetchedAtText || "--"}`);
}
