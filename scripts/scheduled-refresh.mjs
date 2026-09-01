/**
 * 定时全量刷新（供 cron 调用，需本机服务已启动）
 * 示例：0 7 * * * cd /path/to/基金分析 && node --env-file=.env scripts/scheduled-refresh.mjs
 *
 * 授权：.env 里配了 DATA_REFRESH_TOKEN 时随请求带 x-refresh-token；
 * 未配置时服务端只接受本机直连（127.0.0.1 且未经反代）的刷新请求。
 *
 * 为什么不用 fetch：全量刷新要跑 5～10 分钟，服务端跑完才回响应；Node 内置 fetch（undici）
 * 默认最多等 5 分钟响应头（UND_ERR_HEADERS_TIMEOUT），2026-09-01 实测脚本先超时报"失败"、
 * 服务端其实成功。这里改用 node:http，只设整体空闲超时（默认 30 分钟）。
 */
import http from "node:http";
import https from "node:https";

const port = process.env.PORT || "5173";
const base = (process.env.APP_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/$/, "");
const token = process.env.DATA_REFRESH_TOKEN || "";
const timeoutMs = Number(process.env.REFRESH_TIMEOUT_MS || 30 * 60 * 1000);

function requestJson(url, { headers = {}, timeout = timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { method: "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* 非 JSON 原样带回 */ }
        resolve({ status: res.statusCode || 0, ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300, text, json });
      });
      res.on("error", reject);
    });
    req.setTimeout(timeout, () => req.destroy(new Error(`等待服务端响应超过 ${Math.round(timeout / 60000)} 分钟`)));
    req.on("error", reject);
    req.end();
  });
}

const started = Date.now();
let res;
try {
  res = await requestJson(`${base}/api/funds?refresh=1`, { headers: token ? { "x-refresh-token": token } : {} });
} catch (err) {
  console.error(`刷新失败：${err.message}`);
  process.exit(1);
}
const elapsed = ((Date.now() - started) / 1000).toFixed(0);
if (!res.ok) {
  console.error(`刷新失败 HTTP ${res.status}`, res.text.slice(0, 200));
  process.exit(1);
}
const data = res.json || {};
if (data.refreshSkipped) {
  console.log(`服务端刚刷新过（${data.refreshSkipped}），本次跳过；页面展示更新时间 ${data.fetchedAtText || "--"}`);
} else {
  console.log(`刷新完成：${data.total} 只基金，页面展示更新时间 ${data.fetchedAtText || "--"}，用时 ${elapsed}s`);
}
