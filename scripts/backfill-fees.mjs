// 批量回填买入/赎回费率（写入 fund_details.buy_fees_json / redeem_fees_json）。
// 用法：
//   npm run data:fees
//   FORCE=1 npm run data:fees                          重抓所有
//   FEE_CONCURRENCY=4 FEE_DELAY_MS=250 npm run data:fees

import { fetchFundFees } from "../lib/eastmoney.mjs";
import { getAllFunds, getFundDetail, saveFundFees } from "../lib/store.mjs";

const CONCURRENCY = Number(process.env.FEE_CONCURRENCY || 4);
const DELAY_MS = Number(process.env.FEE_DELAY_MS || 250);
const FORCE = process.env.FORCE === "1";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function processOne(code) {
  if (!FORCE) {
    const existing = await getFundDetail(code).catch(() => null);
    if (existing && existing.fees_fetched_at) return { code, status: "skip" };
  }
  try {
    const { buyFees, redeemFees, operatingFees } = await fetchFundFees(code);
    await saveFundFees(code, buyFees, redeemFees, operatingFees);
    return { code, status: buyFees.length || redeemFees.length ? "ok" : "empty" };
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
  console.log(`费率回填脚本启动 concurrency=${CONCURRENCY} delay=${DELAY_MS}ms force=${FORCE}`);
  const funds = await getAllFunds();
  console.log(`基金总数 ${funds.length}`);
  const start = Date.now();
  const stats = await runPool(funds, (f) => processOne(f.code));
  console.log(`完成。用时 ${((Date.now() - start) / 1000).toFixed(1)}s`);
  console.log(`汇总：ok=${stats.ok} skip=${stats.skip || 0} empty=${stats.empty || 0} fail=${stats.fail || 0}`);
  process.exit(stats.fail > funds.length * 0.3 ? 1 : 0);
})();
