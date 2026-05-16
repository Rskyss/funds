// 批量回填 fund_details（F10：投资目标 / 投资范围 / 业绩比较基准）。
// 用法：
//   npm run data:f10
//   FORCE=1 npm run data:f10                       重抓所有
//   F10_CONCURRENCY=4 F10_DELAY_MS=300 npm run data:f10

import { fetchFundDetail } from "../lib/eastmoney.mjs";
import { getAllFunds, getFundDetail, saveFundDetail } from "../lib/store.mjs";

const CONCURRENCY = Number(process.env.F10_CONCURRENCY || 6);
const DELAY_MS = Number(process.env.F10_DELAY_MS || 200);
const FORCE = process.env.FORCE === "1";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processOne(code) {
  if (!FORCE) {
    const existing = await getFundDetail(code).catch(() => null);
    if (existing && (existing.goal || existing.scope || existing.benchmark)) {
      return { code, status: "skip" };
    }
  }
  try {
    const detail = await fetchFundDetail(code);
    await saveFundDetail(detail);
    const filled = [detail.goal, detail.scope, detail.benchmark].filter(Boolean).length;
    if (filled === 0) return { code, status: "empty" };
    return { code, status: "ok", filled };
  } catch (err) {
    return { code, status: "fail", error: err.message };
  }
}

async function runPool(items, worker) {
  let cursor = 0;
  let done = 0;
  const stats = { ok: 0, skip: 0, empty: 0, fail: 0 };
  const workers = new Array(Math.max(1, Math.min(CONCURRENCY, items.length)))
    .fill(null)
    .map(async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        const r = await worker(items[idx], idx);
        stats[r.status] = (stats[r.status] || 0) + 1;
        done++;
        if (done % 50 === 0 || done === items.length) {
          console.log(`  进度 ${done}/${items.length}  ok=${stats.ok} skip=${stats.skip} empty=${stats.empty} fail=${stats.fail}`);
        }
        if (DELAY_MS > 0) await sleep(DELAY_MS);
      }
    });
  await Promise.all(workers);
  return stats;
}

(async () => {
  console.log(`F10 回填脚本启动 concurrency=${CONCURRENCY} delay=${DELAY_MS}ms force=${FORCE}`);
  const funds = await getAllFunds();
  console.log(`基金总数 ${funds.length}`);
  const start = Date.now();
  const stats = await runPool(funds, (f) => processOne(f.code));
  console.log(`完成。用时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`汇总：ok=${stats.ok} skip=${stats.skip || 0} empty=${stats.empty || 0} fail=${stats.fail || 0}`);
  process.exit(stats.fail > funds.length * 0.3 ? 1 : 0);
})();
