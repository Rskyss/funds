// 购买引导（去哪里买）：按申购状态 + 基金公司算出「能不能买、去哪买」，纯函数，详情接口直接返回给页面。
// 合规口径（用户 2026-09-03 拍板）：本站不销售基金，只给渠道入口，不出现「购买 / 立即买入」等销售动作词。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DISCLAIMER = "本站不销售基金，以上为第三方销售平台 / 基金公司页面，跳转后与本站无关；投资有风险，请自行核实。";

const TABLE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "data", "fund-companies.json");
let cachedTable = null;

/** 官网对照表 lib/data/fund-companies.json（{ verifiedAt, companies: { 东财公司id: { name, site } } }）；缺文件按空表处理 */
export function loadCompanyTable(filePath = TABLE_PATH) {
  const useCache = filePath === TABLE_PATH;
  if (useCache && cachedTable) return cachedTable;
  let table = {};
  try {
    const json = JSON.parse(readFileSync(filePath, "utf8"));
    table = json?.companies && typeof json.companies === "object" ? json.companies : {};
  } catch {
    table = {};
  }
  if (useCache) cachedTable = table;
  return table;
}

/** 回填脚本用：哪些公司还没有可用的官网对照（不在表里，或 site 不是 https），按基金数降序 */
export function companiesMissingSite(rows, table) {
  const counts = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = String(r?.company_id || "").trim();
    if (!id) continue;
    const cur = counts.get(id) || { id, name: r.company_name || null, funds: 0 };
    cur.funds += 1;
    counts.set(id, cur);
  }
  return [...counts.values()]
    .filter((c) => !/^https:\/\//.test(String(table?.[c.id]?.site || "")))
    .sort((a, b) => b.funds - a.funds);
}

/** 天天基金的基金页（有购买 / 定投按钮、不用登录），比直接下单页稳定 */
export function ttfundUrl(code) {
  return `https://fund.eastmoney.com/${code}.html`;
}

// 与列表卡片 formatPurchaseLimitLabel 同一口径：100 → 100元，10000 → 1万
function fmtLimitYuan(yuan) {
  const n = Number(yuan);
  if (yuan == null || !Number.isFinite(n)) return null;
  return n >= 10000 ? `${n / 10000}万` : `${n}元`;
}

// 状态取值来自 lib/eastmoney.mjs normalizePurchaseStatus（认不出的原文会原样透传，如「认购期」）
const MODES = {
  "开放": { mode: "open", canBuy: true, note: () => "开放申购，可通过以下渠道申购" },
  "认购期": { mode: "subscribe", canBuy: true, note: () => "认购期内，可通过以下渠道认购" },
  "限购": { mode: "limit", canBuy: true, note: ({ purchaseLimitYuan }) => {
    const lim = fmtLimitYuan(purchaseLimitYuan);
    return lim ? `限购 ${lim}/日，可通过以下渠道申购` : "大额限购，可通过以下渠道申购";
  } },
  "场内交易": { mode: "exchange", canBuy: true, note: ({ code }) => `场内基金，请在券商 App 输入代码 ${code} 买卖；以下链接仅供查看资料` },
  "暂停": { mode: "paused", canBuy: false, note: () => "当前暂停申购，暂不能买入" },
  "封闭": { mode: "closed", canBuy: false, note: () => "封闭期内暂不能申购" },
};
// 没数据和"有数据但不认识"分开说：后者原样告诉用户（raw 已在 normalizePurchaseStatus 截到 8 字）
const UNKNOWN = { mode: "unknown", canBuy: true, note: ({ raw }) => (raw ? `当前状态「${raw}」，请以渠道页面为准` : "申购状态暂无数据，请以渠道页面为准") };

/**
 * @param {{code:string, purchaseStatus?:string|null, purchaseLimitYuan?:number|null, companyId?:string|null, companyName?:string|null}} input
 * @param {Record<string,{name?:string, site?:string|null}>} [table] 官网对照表，默认读 lib/data/fund-companies.json
 * @returns {null | {mode, canBuy, note, channels:[{key,label,url}], officialHint, disclaimer}}
 */
export function buildPurchaseGuide(input, table = loadCompanyTable()) {
  const code = String(input?.code ?? "");
  if (!/^\d{6}$/.test(code)) return null;
  const raw = String(input.purchaseStatus || "").trim();
  const spec = MODES[raw] || UNKNOWN;
  const channels = [{ key: "ttfund", label: "天天基金", url: ttfundUrl(code) }];
  const entry = input.companyId ? table?.[String(input.companyId)] : null;
  // 只接受对照表里的 https 绝对地址——这是下发外链的唯一守卫，东财/库里的文本进不了 href
  const site = typeof entry?.site === "string" && /^https:\/\/[^\s"'<>]+$/.test(entry.site) ? entry.site : null;
  const companyName = String(entry?.name || input.companyName || "").trim() || null;
  let officialHint = null;
  if (site) channels.push({ key: "official", label: `${companyName || "基金公司"}官网`, url: site });
  else if (companyName) officialHint = `基金公司官网：请搜索「${companyName}」`;
  return {
    mode: spec.mode,
    canBuy: spec.canBuy,
    note: spec.note({ code, raw, purchaseLimitYuan: input.purchaseLimitYuan }),
    channels,
    officialHint,
    disclaimer: DISCLAIMER,
  };
}
