/**
 * 补全 funds 表的专业指标：规模 + 基金经理（F10 基本概况页）、夏普 / 波动率（F10 特色数据页）、
 * 近 1 年最大回撤（由 nav_history 计算）。只写抓到的非空字段，抓不到的保持原值。
 * 用法：
 *   npm run data:metrics                 只补缺（规模 / 夏普 / 波动率 / 经理任一为空的基金）
 *   npm run data:metrics -- --all        全部重抓
 *   npm run data:metrics -- --code 513310
 *   npm run data:metrics -- --skip-nav   跳过净值历史补抓
 */
import { fetchFundProfile, fetchFundRiskMetrics, fetchNavHistory, withRetry } from "../lib/eastmoney.mjs";
import {
  getAllFunds,
  getNavHistory,
  saveNavHistoryRows,
  backfillMaxDrawdownForCodes,
  updateFundMetric,
} from "../lib/store.mjs";

const codeArg = process.argv.find((a, i) => process.argv[i - 1] === "--code");
const refetchAll = process.argv.includes("--all") || process.argv.includes("--all-aum");
const skipNav = process.argv.includes("--skip-nav");
const minNavRows = 60;
// 东财对突发请求会回 HTTP 514 限流：并发别开太大，每只基金之间留一点间隔
const CONCURRENCY = Number(process.env.METRICS_CONCURRENCY || 3);
const DELAY_MS = Number(process.env.METRICS_DELAY_MS || 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function needsMetrics(fund) {
  if (!fund) return true;
  return fund.aumBillion == null || fund.sharpe1y == null || fund.volatility1y == null || !fund.managerNames;
}

async function backfillProfileMetrics(codes, fundsByCode) {
  const queue = codes.slice();
  let done = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, async () => {
    while (queue.length) {
      const code = queue.shift();
      const fund = fundsByCode.get(code);
      if (!refetchAll && !needsMetrics(fund)) {
        done++; skipped++;
        continue;
      }
      try {
        const [profile, risk] = await Promise.all([
          withRetry(() => fetchFundProfile(code)).catch((err) => { console.warn(`  ${code} 基本概况失败: ${err.message}`); return null; }),
          withRetry(() => fetchFundRiskMetrics(code)).catch((err) => { console.warn(`  ${code} 特色数据失败: ${err.message}`); return null; }),
        ]);
        const fields = {};
        if (profile?.aumBillion != null) { fields.aum_billion = profile.aumBillion; fields.aum_date = profile.aumDate; }
        if (profile?.managerNames) fields.manager_names = profile.managerNames;
        if (risk?.sharpe1y != null) fields.sharpe_1y = risk.sharpe1y;
        if (risk?.volatility1y != null) fields.volatility_1y = risk.volatility1y;
        if (Object.keys(fields).length) {
          await updateFundMetric(code, fields);
          updated++;
          console.log(`  ${code} ✓ ${Object.keys(fields).join(", ")}`);
        } else {
          failed++;
          console.warn(`  ${code} 两个页面都没拿到指标`);
        }
      } catch (err) {
        failed++;
        console.warn(`  ${code} 写库失败: ${err.message}`);
      } finally {
        done++;
        if (done % 50 === 0 || done === codes.length) {
          console.log(`指标进度 ${done}/${codes.length}，已更新 ${updated}，跳过 ${skipped}，失败 ${failed}`);
        }
        if (DELAY_MS > 0) await sleep(DELAY_MS);
      }
    }
  });
  await Promise.all(workers);
  return { updated, skipped, failed };
}

async function backfillNavHistory(codes) {
  const queue = codes.slice();
  let done = 0;
  let fetched = 0;
  const concurrency = 8;
  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
    while (queue.length) {
      const code = queue.shift();
      try {
        const existing = await getNavHistory(code);
        if (existing.length >= minNavRows) {
          done++;
          continue;
        }
        const rows = await withRetry(() => fetchNavHistory(code, 240));
        if (rows.length) {
          await saveNavHistoryRows(code, rows);
          fetched++;
        }
      } catch (err) {
        console.warn(`  ${code} 净值历史失败: ${err.message}`);
      } finally {
        done++;
        if (done % 50 === 0 || done === codes.length) {
          console.log(`净值历史进度 ${done}/${codes.length}，新抓取 ${fetched}`);
        }
      }
    }
  });
  await Promise.all(workers);
  return fetched;
}

async function main() {
  const funds = await getAllFunds();
  const codes = codeArg ? [codeArg] : funds.map((f) => f.code);
  const fundsByCode = new Map(funds.map((f) => [f.code, f]));
  const targets = codeArg ? codes.length : (refetchAll ? codes.length : codes.filter((c) => needsMetrics(fundsByCode.get(c))).length);
  console.log(`补指标：候选 ${codes.length} 只，需要抓取 ${targets} 只（${refetchAll ? "全部重抓" : "只补缺"}），并发 ${CONCURRENCY}，间隔 ${DELAY_MS}ms`);
  const stats = await backfillProfileMetrics(codes, fundsByCode);

  if (!skipNav) {
    console.log(`补净值历史（不足 ${minNavRows} 条则抓 240 日）${codes.length} 只...`);
    const navFetched = await backfillNavHistory(codes);
    console.log(`净值历史补全：新抓取 ${navFetched} 只`);
  }

  console.log(`补近1年最大回撤 ${codes.length} 只...`);
  const ddMap = await backfillMaxDrawdownForCodes(codes, {
    concurrency: 12,
    onProgress: (done, total) => {
      if (done === total || done % 100 === 0) console.log(`回撤进度 ${done}/${total}`);
    },
  });
  const ddFilled = [...ddMap.values()].filter((v) => v !== null).length;
  console.log(`完成：指标更新 ${stats.updated} 只（失败 ${stats.failed}），回撤有值 ${ddFilled}/${codes.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
