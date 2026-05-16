import { getAllFunds, getAllAiSummaries, saveAiSummary } from "../lib/store.mjs";
import { generateWithRetry } from "../lib/ai.mjs";

const CONCURRENCY = Number(process.env.AI_CONCURRENCY || 5);
const FORCE = process.argv.includes("--force");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i > -1 ? Number(process.argv[i + 1]) : null;
})();

function progressLine(done, total, ok, fail, latestName) {
  const pct = ((done / total) * 100).toFixed(1).padStart(5);
  const bar = "█".repeat(Math.floor((done / total) * 30)).padEnd(30, "░");
  const tail = latestName ? ` · ${latestName.slice(0, 24)}` : "";
  process.stdout.write(`\r${bar} ${pct}%  ${done}/${total}  成功 ${ok} 失败 ${fail}${tail}              `);
}

async function runQueue(items, worker) {
  let done = 0;
  let ok = 0;
  let fail = 0;
  const total = items.length;
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await worker(item);
        ok++;
      } catch (err) {
        fail++;
        console.error(`\n× ${item.code} ${item.name} → ${err.message}`);
      } finally {
        done++;
        progressLine(done, total, ok, fail, item.name);
      }
    }
  });
  await Promise.all(workers);
  return { ok, fail };
}

async function main() {
  if (!process.env.DASHSCOPE_API_KEY) {
    console.error("缺少 DASHSCOPE_API_KEY，请在 .env 配置");
    process.exit(1);
  }
  console.log(`百炼模型：${process.env.DASHSCOPE_MODEL || "qwen-plus"}`);
  console.log(`并发：${CONCURRENCY}${FORCE ? " · 强制重生成" : ""}${LIMIT ? " · 限制 " + LIMIT + " 只" : ""}\n`);

  console.log("加载基金列表与已有点评...");
  const [funds, existing] = await Promise.all([getAllFunds(), getAllAiSummaries()]);
  console.log(`基金总数：${funds.length} · 已有点评：${existing.size}`);

  let targets = FORCE ? funds : funds.filter((f) => !existing.has(f.code));
  if (LIMIT) targets = targets.slice(0, LIMIT);
  console.log(`需要生成：${targets.length} 只\n`);

  if (!targets.length) {
    console.log("✓ 全部基金都已有点评，无需生成。加 --force 可重新生成全部。");
    return;
  }

  const start = Date.now();
  const result = await runQueue(targets, async (fund) => {
    const { summary, model } = await generateWithRetry(fund);
    await saveAiSummary(fund.code, summary, model);
  });
  process.stdout.write("\n");
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n完成：成功 ${result.ok} · 失败 ${result.fail} · 用时 ${seconds}s`);
}

main().catch((err) => {
  console.error("\n致命错误：", err);
  process.exit(1);
});
