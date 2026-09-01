// 刷新时的“指标回退”：某只基金这次抓取失败（字段为空）时，沿用库里上次的值，
// 而不是把好数据刷成空。纯函数，便于单测。
//
// 背景：每日全量刷新对每只基金要打 3~4 个东财页面，偶发超时/限流很正常；
// 之前 upsertFunds 无条件覆盖，一次抖动就把规模/夏普/经理刷成 null，前端再显示成 0。
export const STICKY_METRIC_FIELDS = [
  "aumBillion", "aumDate",
  "managerNames",
  "sharpe1y", "volatility1y",
  "ratingMorningstar", "ratingDate",
  "purchaseStatus", "purchaseLimitYuan", "redeemStatus", "statusFetchedAt",
  "maxDrawdown1y",
  "inception", "ageYears",
];

function isMissing(v) {
  return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
}

/**
 * 返回新对象；next 里缺失、prev 里有值的字段用 prev 补上。
 * @returns {{ fund: object, restored: string[] }} restored 为被回退的字段名
 */
export function fillMissingFromPrevious(next, prev, fields = STICKY_METRIC_FIELDS) {
  if (!prev || typeof prev !== "object") return { fund: next, restored: [] };
  const fund = { ...next };
  const restored = [];
  for (const key of fields) {
    if (isMissing(fund[key]) && !isMissing(prev[key])) {
      fund[key] = prev[key];
      restored.push(key);
    }
  }
  return { fund, restored };
}

/** 批量：funds 为本次抓取结果，prevByCode 为库里现有数据（Map<code, fund>）。 */
export function fillMissingForAll(funds, prevByCode, fields = STICKY_METRIC_FIELDS) {
  let restoredFields = 0;
  let restoredFunds = 0;
  const out = funds.map((f) => {
    const { fund, restored } = fillMissingFromPrevious(f, prevByCode.get(f.code), fields);
    if (restored.length) { restoredFields += restored.length; restoredFunds += 1; }
    return fund;
  });
  return { funds: out, restoredFields, restoredFunds };
}
