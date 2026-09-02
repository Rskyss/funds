import { parseDate } from "./fundRow.mjs";

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

// ---- 净值停更（东财还列着、但净值不再更新的基金）----
// 与"僵尸基金"不同：东财列表里仍返回它，只是净值日期停住（典型：发起式基金三年到期清盘，如 018336 停在 2026-07-20）。
// 参照系是列表内最新的净值日期（不是今天）——全站一起放假不会误判，只有单只基金自己落后才算。
// 落后超过 14 天 → 打上 navStaleDays（整数天）；其余为 null。缺净值日期的不判（它们已因无收益走"数据不足"）。
// 读取时现算、不落库（天数每天在变，且只有拿到整个列表才算得准）。用户 2026-09-02 拍板：保留并标注，不隐藏。
export const STALE_NAV_GRACE_MS = 14 * 24 * 3600_000;

function navDateTs(f) {
  const iso = parseDate(f?.date); // 兼容 2026/7/20、2026-7-20 等写法，东财格式漂移时不静默失效
  if (!iso) return null;
  const t = new Date(`${iso}T00:00:00Z`).getTime();
  return Number.isFinite(t) ? t : null;
}

export function markStaleNav(funds, { graceMs = STALE_NAV_GRACE_MS } = {}) {
  const list = Array.isArray(funds) ? funds : [];
  let latest = null;
  for (const f of list) {
    const t = navDateTs(f);
    if (t !== null && (latest === null || t > latest)) latest = t;
  }
  for (const f of list) {
    const t = navDateTs(f);
    const behind = t === null || latest === null ? 0 : latest - t;
    f.navStaleDays = behind > graceMs ? Math.round(behind / 86400_000) : null;
    if (f.navStaleDays) {
      // 停更基金不打分、不占同类名次。这里就地清掉而不只靠 applyPercentileScores：
      // AI 投顾读库路径（getAllFunds）不重算评分，库里存的是上次刷新的旧分，不清会带着旧分进聊天。
      f.score = null;
      f.label = "净值停更";
      f.peerRank = null;
      f.peerCount = null;
    }
  }
  return list;
}

/** AI 投顾筛选/排行用：剔除净值停更的基金（点名查询仍能查到，见 lib/agent/tools.mjs getFundsByCodes） */
export function withoutStaleNav(funds) {
  const list = Array.isArray(funds) ? funds : [];
  return list.filter((f) => !f?.navStaleDays);
}
