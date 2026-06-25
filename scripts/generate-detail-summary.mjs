import { getAllFunds, getAllAiSummaries, saveAiDetailSummary } from "../lib/store.mjs";
import { generateDetailWithRetry, modelChain } from "../lib/ai.mjs";

const CONCURRENCY = Number(process.env.AI_CONCURRENCY || 3);
const FORCE = process.argv.includes("--force");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i > -1 ? Number(process.argv[i + 1]) : null;
})();
const ONLY_CODE = (() => {
  const i = process.argv.indexOf("--code");
  return i > -1 ? String(process.argv[i + 1]).trim() : null;
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
        if (total > 1) progressLine(done, total, ok, fail, item.name);
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
  console.log(`百炼模型链（按序自动降级）：${modelChain().join(" → ")}（详情扩展点评）`);
  console.log(
    `并发：${CONCURRENCY}` +
      `${FORCE ? " · 强制重生成" : ""}` +
      `${LIMIT ? " · 限制 " + LIMIT + " 只" : ""}` +
      `${ONLY_CODE ? " · 仅 " + ONLY_CODE : ""}\n`
  );

  console.log("加载基金列表与已有点评...");
  const [funds, existing] = await Promise.all([getAllFunds(), getAllAiSummaries()]);
  console.log(`基金总数：${funds.length} · 已有 detail：${[...existing.values()].filter((r) => r.detail_summary).length}`);

  let targets;
  if (ONLY_CODE) {
    const hit = funds.find((f) => f.code === ONLY_CODE);
    if (!hit) {
      console.error(`找不到基金代码 ${ONLY_CODE}`);
      process.exit(1);
    }
    targets = [hit];
  } else {
    targets = FORCE
      ? funds
      : funds.filter((f) => {
          const row = existing.get(f.code);
          return !row || !row.detail_summary;
        });
  }
  if (LIMIT) targets = targets.slice(0, LIMIT);
  console.log(`需要生成：${targets.length} 只\n`);

  if (!targets.length) {
    console.log("✓ 全部基金都已有 detail 点评，无需生成。加 --force 可重新生成全部。");
    return;
  }

  const start = Date.now();
  const result = await runQueue(targets, async (fund) => {
    const existingRow = existing.get(fund.code);
    const cardSummary = existingRow?.summary || fund.aiSummary || null;
    const { detail, model } = await generateDetailWithRetry(fund, { cardSummary });
    await saveAiDetailSummary(fund.code, detail, model);
    if (targets.length === 1) {
      console.log(`\n--- ${fund.code} ${fund.name} ---`);
      console.log(detail);
      console.log(`---\n字数：${detail.length} · 模型：${model}`);
    }
  });
  if (targets.length > 1) process.stdout.write("\n");
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n完成：成功 ${result.ok} · 失败 ${result.fail} · 用时 ${seconds}s`);
}

main().catch((err) => {
  console.error("\n致命错误：", err);
  process.exit(1);
});
