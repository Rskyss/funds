// 数据完整性统计：每次刷新 / 每次装载列表后数一遍关键字段的空值，写日志并暴露在 /api/health。
//
// 背景（2026-09-01）：申购状态 740/743 为空、成立日期 519 为空的问题藏了两个月没人发现——
// 刷新日志只统计规模和夏普两个字段，其它字段空了没有任何地方变红。这里把全部关键字段一起数。
export const QUALITY_FIELDS = {
  nav: "净值",
  aumBillion: "规模",
  managerNames: "经理",
  sharpe1y: "夏普",
  volatility1y: "波动率",
  ratingMorningstar: "评级",
  purchaseStatus: "申购状态",
  inception: "成立日",
};

// 空值比例超过阈值就告警。评级不设阈值：六成 QDII 本来就没有晨星评级。
export const QUALITY_WARN_RATIO = {
  nav: 0.1,
  aumBillion: 0.3,
  managerNames: 0.3,
  sharpe1y: 0.5,
  volatility1y: 0.5,
  purchaseStatus: 0.5,
  inception: 0.5,
};

function isMissing(v) {
  return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
}

export function summarizeDataQuality(funds, { now = Date.now() } = {}) {
  const list = Array.isArray(funds) ? funds : [];
  const total = list.length;
  const missing = {};
  for (const k of Object.keys(QUALITY_FIELDS)) missing[k] = 0;
  for (const f of list) {
    for (const k of Object.keys(QUALITY_FIELDS)) {
      if (isMissing(f?.[k])) missing[k] += 1;
    }
  }
  const warnings = [];
  if (total) {
    for (const [k, ratio] of Object.entries(QUALITY_WARN_RATIO)) {
      if (missing[k] / total > ratio) {
        warnings.push(`${QUALITY_FIELDS[k]}缺失 ${missing[k]}/${total}（${Math.round((missing[k] / total) * 100)}%）`);
      }
    }
  }
  return { computedAt: new Date(now).toISOString(), total, missing, warnings };
}

/** 日志用：「规模 3 只，夏普 65 只」 */
export function formatMissingLine(quality) {
  const parts = Object.entries(quality?.missing || {})
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${QUALITY_FIELDS[k] || k} ${n} 只`);
  return parts.length ? parts.join("，") : "无";
}

// ---- 东财已不再返回的基金（"僵尸"基金）----
// 每日刷新会给抓到的每只基金写 updated_at；东财列表里消失的基金 updated_at 就停在最后一次出现那天。
// 比最新一批晚 3 天以上没更新 → 视为已下架/清盘/改类，从列表、评分、Agent 里隐藏（库里的行与净值历史保留，重新出现会自动回来）。
export const DELIST_GRACE_MS = 3 * 24 * 3600_000;

export function splitDelisted(funds, { graceMs = DELIST_GRACE_MS } = {}) {
  const list = Array.isArray(funds) ? funds : [];
  const ts = (f) => {
    const t = f?.updatedAt ? new Date(f.updatedAt).getTime() : NaN;
    return Number.isFinite(t) ? t : null;
  };
  let latest = null;
  for (const f of list) {
    const t = ts(f);
    if (t !== null && (latest === null || t > latest)) latest = t;
  }
  if (latest === null) return { active: list.slice(), delisted: [] };
  const active = [];
  const delisted = [];
  for (const f of list) {
    const t = ts(f);
    (t !== null && latest - t > graceMs ? delisted : active).push(f);
  }
  return { active, delisted };
}
