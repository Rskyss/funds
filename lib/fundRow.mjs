// funds 表 ↔ JS 对象的字段映射（DB snake_case ↔ JS camelCase）。纯函数、不连库，便于单测。
// 新增字段要三处同步：supabase/migrations/ + 这里 + 调用点（见 CLAUDE.md）。

export function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseDate(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function fundToRow(fund) {
  return {
    code: fund.code,
    name: fund.name,
    pinyin: fund.pinyin || null,
    category: fund.category || null,
    region: fund.region || null,
    theme: fund.theme || null,
    fund_type: fund.fundType || null,
    role: fund.role || null,
    risk: fund.risk || null,
    inception: parseDate(fund.inception),
    age_years: fund.ageYears,
    buy_fee: fund.buyFee,
    discount_fee: fund.discountFee,
    // 没有净值日期的净值一律当缺失：东财"基本信息"接口对无净值的份额会回占位值 1（2026-09-02：003244/003245）
    nav: parseDate(fund.date) ? fund.nav : null,
    accum_nav: parseDate(fund.date) ? fund.accumNav : null,
    nav_date: parseDate(fund.date),
    return_1d: fund.return1d,
    return_1w: fund.return1w,
    return_1m: fund.return1m,
    return_3m: fund.return3m,
    return_6m: fund.return6m,
    return_1y: fund.return1y,
    return_2y: fund.return2y,
    return_3y: fund.return3y,
    return_ytd: fund.returnYtd,
    return_since: fund.returnSince,
    score: fund.score,
    score_label: fund.label,
    rating_morningstar: fund.ratingMorningstar ?? null,
    rating_date: fund.ratingDate || null,
    aum_billion: fund.aumBillion ?? null,
    aum_date: fund.aumDate || null,
    sharpe_1y: fund.sharpe1y ?? null,
    volatility_1y: fund.volatility1y ?? null,
    max_drawdown_1y: fund.maxDrawdown1y ?? null,
    manager_names: fund.managerNames || null,
    purchase_status: fund.purchaseStatus || null,
    purchase_limit_yuan: fund.purchaseLimitYuan ?? null,
    redeem_status: fund.redeemStatus || null,
    status_fetched_at: fund.statusFetchedAt || null,
    source: fund.source || null,
    updated_at: new Date().toISOString(),
  };
}

export function rowToFund(row) {
  return {
    code: row.code,
    name: row.name,
    pinyin: row.pinyin || "",
    category: row.category || "",
    region: row.region || "",
    theme: row.theme || "",
    fundType: row.fund_type || "",
    role: row.role || "",
    risk: row.risk || "",
    inception: row.inception || "",
    ageYears: row.age_years,
    buyFee: row.buy_fee,
    discountFee: row.discount_fee,
    nav: row.nav_date ? row.nav : null,          // 无日期的净值当缺失（覆盖库里已有的占位值）
    accumNav: row.nav_date ? row.accum_nav : null,
    date: row.nav_date || "",
    return1d: row.return_1d,
    return1w: row.return_1w,
    return1m: row.return_1m,
    return3m: row.return_3m,
    return6m: row.return_6m,
    return1y: row.return_1y,
    return2y: row.return_2y,
    return3y: row.return_3y,
    returnYtd: row.return_ytd,
    returnSince: row.return_since,
    score: row.score ?? null,
    label: row.score_label || "",
    updatedAt: row.updated_at || null,
    ratingMorningstar: row.rating_morningstar ?? null,
    ratingDate: row.rating_date || null,
    aumBillion: toNum(row.aum_billion),
    aumDate: row.aum_date || null,
    sharpe1y: toNum(row.sharpe_1y),
    volatility1y: toNum(row.volatility_1y),
    maxDrawdown1y: toNum(row.max_drawdown_1y),
    managerNames: row.manager_names || "",
    purchaseStatus: row.purchase_status || null,
    purchaseLimitYuan: row.purchase_limit_yuan !== null && row.purchase_limit_yuan !== undefined ? Number(row.purchase_limit_yuan) : null,
    redeemStatus: row.redeem_status || null,
    statusFetchedAt: row.status_fetched_at || null,
    source: row.source || "",
    spark: Array.isArray(row.spark_json) ? row.spark_json : null,
  };
}
