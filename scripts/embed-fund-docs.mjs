// 把 fund_details 与 fund_ai_summary 切块并写入 fund_doc_chunks。
// 用法：npm run data:embed
// 选项：FORCE=1（重写）、EMBED_BATCH=8（embedding 单次输入条数）、EMBED_DELAY_MS=200

import { supabaseAdmin } from "../lib/supabase.mjs";
import { embedTexts } from "../lib/embedding.mjs";

const FORCE = process.env.FORCE === "1";
const BATCH = Number(process.env.EMBED_BATCH || 8);
const DELAY = Number(process.env.EMBED_DELAY_MS || 150);

function chunkText(source, code, raw) {
  if (!raw || typeof raw !== "string") return [];
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return [];
  const MAX = 280;
  const chunks = [];
  let i = 0;
  let idx = 0;
  while (i < text.length) {
    const end = Math.min(i + MAX, text.length);
    chunks.push({ code, source, chunk_index: idx, content: text.slice(i, end) });
    i = end;
    idx++;
  }
  return chunks;
}

function buildHoldingsText(holdings, reportDate) {
  if (!Array.isArray(holdings) || !holdings.length) return "";
  const items = holdings
    .filter((h) => h && h.stockName)
    .sort((a, b) => (a.rank || 99) - (b.rank || 99))
    .map((h) => {
      const ratio = h.ratio !== null && h.ratio !== undefined ? `${h.ratio}%` : "";
      const codePart = h.stockCode ? `（${h.stockCode}）` : "";
      return `${h.stockName}${codePart} ${ratio}`.trim();
    });
  if (!items.length) return "";
  const datePrefix = reportDate ? `截至 ${reportDate}` : "持仓截止日期未知";
  return `${datePrefix}，前十大重仓股：${items.join("、")}。`;
}

async function loadAllDetails() {
  const all = [];
  let from = 0;
  const size = 500;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("fund_details")
      .select("code, goal, scope, benchmark, holdings_json, holdings_report_date")
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return all;
}

async function loadAllAi() {
  const all = [];
  let from = 0;
  const size = 500;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("fund_ai_summary")
      .select("code, summary")
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < size) break;
    from += size;
  }
  return all;
}

async function loadExistingKeys() {
  const set = new Set();
  let from = 0;
  const size = 1000;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("fund_doc_chunks")
      .select("code, source, chunk_index")
      .range(from, from + size - 1);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    for (const r of data) set.add(`${r.code}|${r.source}|${r.chunk_index}`);
    if (data.length < size) break;
    from += size;
  }
  return set;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function flushBatch(rows) {
  if (!rows.length) return 0;
  const inputs = rows.map((r) => r.content);
  const vectors = await embedTexts(inputs);
  const payload = rows.map((r, i) => ({
    code: r.code,
    source: r.source,
    chunk_index: r.chunk_index,
    content: r.content,
    embedding: vectors[i],
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabaseAdmin
    .from("fund_doc_chunks")
    .upsert(payload, { onConflict: "code,source,chunk_index" });
  if (error) throw new Error(`upsert chunks 失败: ${error.message}`);
  return payload.length;
}

(async () => {
  console.log(`Embedding 脚本启动 batch=${BATCH} delay=${DELAY}ms force=${FORCE}`);
  const [details, ais] = await Promise.all([loadAllDetails(), loadAllAi()]);
  console.log(`fund_details=${details.length} fund_ai_summary=${ais.length}`);

  const allChunks = [];
  for (const d of details) {
    allChunks.push(...chunkText("f10_goal", d.code, d.goal));
    allChunks.push(...chunkText("f10_scope", d.code, d.scope));
    allChunks.push(...chunkText("f10_benchmark", d.code, d.benchmark));
    allChunks.push(...chunkText("holdings", d.code, buildHoldingsText(d.holdings_json, d.holdings_report_date)));
  }
  for (const a of ais) {
    allChunks.push(...chunkText("ai_summary", a.code, a.summary));
  }
  console.log(`待入库分片总数 ${allChunks.length}`);

  let toWrite = allChunks;
  if (!FORCE) {
    const existing = await loadExistingKeys();
    console.log(`已有分片 ${existing.size} 条，跳过这些`);
    toWrite = allChunks.filter((c) => !existing.has(`${c.code}|${c.source}|${c.chunk_index}`));
  }
  console.log(`实际需要 embedding 的分片 ${toWrite.length}`);

  let done = 0;
  let written = 0;
  const start = Date.now();
  for (let i = 0; i < toWrite.length; i += BATCH) {
    const batch = toWrite.slice(i, i + BATCH);
    try {
      const n = await flushBatch(batch);
      written += n;
    } catch (err) {
      console.warn(`batch ${i} 失败 跳过: ${err.message}`);
    }
    done += batch.length;
    if (done % 200 === 0 || done >= toWrite.length) {
      console.log(`  进度 ${done}/${toWrite.length} 已写入 ${written}`);
    }
    if (DELAY > 0) await sleep(DELAY);
  }
  console.log(`完成 用时 ${((Date.now() - start) / 1000).toFixed(1)}s 写入 ${written} 条`);
  process.exit(0);
})();
