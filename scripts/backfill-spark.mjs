/**
 * 由 nav_history 生成 funds.spark_json（列表卡片精简净值曲线，约 40 点）
 * 数据库已有净值历史，无需重新抓取，仅做降采样回填。
 * 用法：node --env-file=.env scripts/backfill-spark.mjs
 *       node --env-file=.env scripts/backfill-spark.mjs --code 513310
 */
import { getAllFunds, backfillSparkForCodes } from "../lib/store.mjs";

const codeArg = process.argv.find((a, i) => process.argv[i - 1] === "--code");

async function main() {
  const funds = await getAllFunds();
  const codes = codeArg ? [codeArg] : funds.map((f) => f.code);
  console.log(`生成列表精简曲线 ${codes.length} 只...`);
  const map = await backfillSparkForCodes(codes, {
    concurrency: 12,
    onProgress: (done, total) => {
      if (done === total || done % 100 === 0) console.log(`曲线进度 ${done}/${total}`);
    },
  });
  const filled = [...map.values()].filter((v) => v).length;
  console.log(`完成：曲线有值 ${filled}/${codes.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
