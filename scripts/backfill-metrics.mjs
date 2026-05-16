/**
 * 补全 funds 表：规模（重新抓 F10）+ 近1年最大回撤（由 nav_history 计算）
 * 用法：node --env-file=.env scripts/backfill-metrics.mjs
 *       node --env-file=.env scripts/backfill-metrics.mjs --code 012921
 */
import { fetchFundProfile, fetchNavHistory } from "../lib/eastmoney.mjs";
import {
  getAllFunds,
  getNavHistory,
  saveNavHistoryRows,
  backfillMaxDrawdownForCodes,
  updateFundMetric,
} from "../lib/store.mjs";

const codeArg = process.argv.find((a, i) => process.argv[i - 1] === "--code");
const onlyMissingAum = !process.argv.includes("--all-aum");
const skipNav = process.argv.includes("--skip-nav");
const minNavRows = 60;

async function backfillAum(codes, fundsByCode) {
  const queue = codes.slice();
  let done = 0;
  let updated = 0;
  const concurrency = 10;
  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
    while (queue.length) {
      const code = queue.shift();
      const fund = fundsByCode.get(code);
      if (onlyMissingAum && fund?.aumBillion != null) {
        done++;
        continue;
      }
      try {
        const profile = await fetchFundProfile(code);
        if (profile.aumBillion != null) {
          await updateFundMetric(code, {
            aum_billion: profile.aumBillion,
            aum_date: profile.aumDate,
          });
          updated++;
          console.log(`  ${code} 规模 ${profile.aumBillion} ${profile.aumCurrency === "USD" ? "亿美元" : "亿元"}`);
        }
      } catch (err) {
        console.warn(`  ${code} 规模失败: ${err.message}`);
      } finally {
        done++;
        if (done % 50 === 0 || done === codes.length) {
          console.log(`规模进度 ${done}/${codes.length}，已更新 ${updated}`);
        }
      }
    }
  });
  await Promise.all(workers);
  return updated;
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
        const rows = await fetchNavHistory(code, 240);
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
  console.log(`补规模 ${codes.length} 只（${onlyMissingAum ? "仅缺规模" : "全部重抓"}）...`);
  const aumCount = await backfillAum(codes, fundsByCode);

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
  console.log(`完成：规模更新 ${aumCount} 只，回撤有值 ${ddFilled}/${codes.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
