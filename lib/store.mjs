import { supabaseAdmin } from "./supabase.mjs";
import { computeMaxDrawdown } from "./eastmoney.mjs";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function fundToRow(fund) {
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
    nav: fund.nav,
    accum_nav: fund.accumNav,
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

function rowToFund(row) {
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
    nav: row.nav,
    accumNav: row.accum_nav,
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
    score: row.score ?? 0,
    label: row.score_label || "",
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

// 把净值历史降采样成约 N 个点的精简曲线（用于列表卡片走势图）
export function downsampleNav(navHistory, points = 40) {
  const nav = (navHistory || [])
    .map((p) => Number(p.nav))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (nav.length < 2) return null;
  if (nav.length <= points) return nav.map((v) => +v.toFixed(4));
  const out = [];
  const step = (nav.length - 1) / (points - 1);
  for (let i = 0; i < points; i++) {
    out.push(+nav[Math.round(i * step)].toFixed(4));
  }
  return out;
}

export async function backfillSparkForCodes(codes, { concurrency = 12, onProgress } = {}) {
  const queue = [...new Set(codes)];
  const results = new Map();
  let done = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
    while (queue.length) {
      const code = queue.shift();
      try {
        const navHistory = await getNavHistory(code);
        const spark = downsampleNav(navHistory, 40);
        results.set(code, spark);
        if (spark) await updateFundMetric(code, { spark_json: spark });
      } catch {
        results.set(code, null);
      } finally {
        done++;
        if (onProgress) onProgress(done, codes.length);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function upsertFunds(funds) {
  if (!funds || !funds.length) return { count: 0 };
  const rows = funds.map(fundToRow);
  const chunkSize = 200;
  let total = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabaseAdmin.from("funds").upsert(chunk, { onConflict: "code" });
    if (error) throw new Error(`upsert funds 失败: ${error.message}`);
    total += chunk.length;
  }
  return { count: total };
}

export async function appendNavHistory(funds) {
  const rows = funds
    .filter((f) => f.nav !== null && f.nav !== undefined)
    .map((f) => ({
      code: f.code,
      nav_date: parseDate(f.date),
      nav: f.nav,
      accum_nav: f.accumNav,
    }))
    .filter((row) => row.nav_date);
  if (!rows.length) return { count: 0 };
  const chunkSize = 200;
  let total = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabaseAdmin
      .from("nav_history")
      .upsert(chunk, { onConflict: "code,nav_date", ignoreDuplicates: false });
    if (error) throw new Error(`upsert nav_history 失败: ${error.message}`);
    total += chunk.length;
  }
  return { count: total };
}

export async function saveNavHistoryRows(code, rows) {
  if (!rows || !rows.length) return { count: 0 };
  const data = rows
    .filter((r) => r.nav_date && r.nav !== null && r.nav !== undefined)
    .map((r) => ({ code, nav_date: r.nav_date, nav: r.nav, accum_nav: r.accum_nav ?? null }));
  if (!data.length) return { count: 0 };
  const { error } = await supabaseAdmin
    .from("nav_history")
    .upsert(data, { onConflict: "code,nav_date", ignoreDuplicates: false });
  if (error) throw new Error(`saveNavHistoryRows 失败: ${error.message}`);
  return { count: data.length };
}

export async function getAllFunds() {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("funds")
      .select("*")
      .order("score", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`getAllFunds 失败: ${error.message}`);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all.map(rowToFund);
}

export async function getAllHoldings() {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("fund_details")
      .select("code, holdings_json, holdings_report_date")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`getAllHoldings 失败: ${error.message}`);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all
    .filter((r) => Array.isArray(r.holdings_json) && r.holdings_json.length)
    .map((r) => ({
      code: r.code,
      reportDate: r.holdings_report_date || null,
      holdings: r.holdings_json,
    }));
}

export async function getLastUpdatedAt() {
  const { data, error } = await supabaseAdmin
    .from("funds")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`getLastUpdatedAt 失败: ${error.message}`);
  return data?.[0]?.updated_at || null;
}

export async function getFundDetail(code) {
  const { data, error } = await supabaseAdmin
    .from("fund_details")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(`getFundDetail 失败: ${error.message}`);
  return data;
}

export async function saveFundDetail(detail) {
  const row = {
    code: detail.code,
    goal: detail.goal || null,
    scope: detail.scope || null,
    benchmark: detail.benchmark || null,
    detail_url: detail.detailUrl || null,
    fetched_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("fund_details").upsert(row, { onConflict: "code" });
  if (error) throw new Error(`saveFundDetail 失败: ${error.message}`);
}

export async function saveFundHoldingsCache(code, holdingsResult, assetAllocation) {
  const row = {
    code,
    holdings_json: holdingsResult?.holdings || [],
    holdings_report_date: holdingsResult?.reportDate || null,
    asset_allocation_json: assetAllocation || [],
    holdings_fetched_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("fund_details").upsert(row, { onConflict: "code" });
  if (error) throw new Error(`saveFundHoldingsCache 失败: ${error.message}`);
}

export async function saveFundFees(code, buyFees, redeemFees, operatingFees = null) {
  const row = {
    code,
    buy_fees_json: Array.isArray(buyFees) ? buyFees : [],
    redeem_fees_json: Array.isArray(redeemFees) ? redeemFees : [],
    operating_fees_json: operatingFees && typeof operatingFees === "object" ? operatingFees : null,
    fees_fetched_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("fund_details").upsert(row, { onConflict: "code" });
  if (error) throw new Error(`saveFundFees 失败: ${error.message}`);
}

export async function saveFundManagers(code, managers) {
  const row = {
    code,
    managers_json: Array.isArray(managers) ? managers : [],
    managers_fetched_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from("fund_details").upsert(row, { onConflict: "code" });
  if (error) throw new Error(`saveFundManagers 失败: ${error.message}`);
}

export async function getNavHistory(code, limit = 500) {
  const { data, error } = await supabaseAdmin
    .from("nav_history")
    .select("nav_date, nav, accum_nav")
    .eq("code", code)
    .order("nav_date", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`getNavHistory 失败: ${error.message}`);
  return (data || []).map((row) => ({
    date: row.nav_date,
    nav: Number(row.nav),
    accumNav: row.accum_nav !== null ? Number(row.accum_nav) : null,
  }));
}

export async function updateFundMetric(code, fields) {
  if (!code || !fields || !Object.keys(fields).length) return;
  const { error } = await supabaseAdmin.from("funds").update(fields).eq("code", code);
  if (error) throw new Error(`updateFundMetric(${code}) 失败: ${error.message}`);
}

export async function backfillMaxDrawdownForCodes(codes, { concurrency = 12, onProgress } = {}) {
  const queue = [...new Set(codes)];
  const results = new Map();
  let done = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
    while (queue.length) {
      const code = queue.shift();
      try {
        const navHistory = await getNavHistory(code);
        const dd = computeMaxDrawdown(navHistory);
        results.set(code, dd);
        if (dd !== null) await updateFundMetric(code, { max_drawdown_1y: dd });
      } catch {
        results.set(code, null);
      } finally {
        done++;
        if (onProgress) onProgress(done, codes.length);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function getUserProfile(userId) {
  if (!userId) return null;
  const { data, error } = await supabaseAdmin
    .from("user_profile")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function saveUserProfile(userId, profile) {
  if (!userId) throw new Error("userId 必填");
  const row = {
    user_id: userId,
    risk_pref: profile.riskPref || null,
    horizon: profile.horizon || null,
    regions: Array.isArray(profile.regions) ? profile.regions : [],
    amount_band: profile.amountBand || null,
    fund_years: profile.fundYears || null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin
    .from("user_profile")
    .upsert(row, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return row;
}

export async function findInviteCode(code) {
  if (!code) return null;
  const { data, error } = await supabaseAdmin
    .from("invite_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function claimInviteCode(code) {
  const { data, error } = await supabaseAdmin
    .from("invite_codes")
    .update({ status: "used", used_at: new Date().toISOString() })
    .eq("code", code)
    .eq("status", "unused")
    .select();
  if (error) throw new Error(error.message);
  return data && data.length ? data[0] : null;
}

export async function releaseInviteCode(code) {
  await supabaseAdmin
    .from("invite_codes")
    .update({ status: "unused", used_at: null, used_by: null })
    .eq("code", code);
}

export async function attachInviteCodeUser(code, userId) {
  await supabaseAdmin
    .from("invite_codes")
    .update({ used_by: userId })
    .eq("code", code);
}

export async function createInviteCodes(rows) {
  if (!rows || !rows.length) return [];
  const { data, error } = await supabaseAdmin
    .from("invite_codes")
    .insert(rows)
    .select("code");
  if (error) throw new Error(error.message);
  return data || [];
}

const AI_SUMMARY_COLS = "code, summary, model, generated_at, detail_summary, detail_model, detail_generated_at";

export async function getAllAiSummaries() {
  const pageSize = 1000;
  let from = 0;
  const map = new Map();
  while (true) {
    const { data, error } = await supabaseAdmin
      .from("fund_ai_summary")
      .select(AI_SUMMARY_COLS)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`getAllAiSummaries 失败: ${error.message}`);
    if (!data || !data.length) break;
    for (const row of data) map.set(row.code, row);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

export async function getAiSummary(code) {
  const { data, error } = await supabaseAdmin
    .from("fund_ai_summary")
    .select(AI_SUMMARY_COLS)
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(`getAiSummary 失败: ${error.message}`);
  return data;
}

export async function saveAiSummary(code, summary, model) {
  const { error } = await supabaseAdmin
    .from("fund_ai_summary")
    .upsert({ code, summary, model: model || null, generated_at: new Date().toISOString() }, { onConflict: "code" });
  if (error) throw new Error(`saveAiSummary 失败: ${error.message}`);
}

export async function saveAiDetailSummary(code, detail, model) {
  const { error } = await supabaseAdmin
    .from("fund_ai_summary")
    .upsert(
      {
        code,
        detail_summary: detail,
        detail_model: model || null,
        detail_generated_at: new Date().toISOString(),
      },
      { onConflict: "code" }
    );
  if (error) throw new Error(`saveAiDetailSummary 失败: ${error.message}`);
}

export async function getFavorites(userId) {
  const { data, error } = await supabaseAdmin
    .from("favorites")
    .select("code, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getFavorites 失败: ${error.message}`);
  return data || [];
}

export async function addFavorite(userId, code) {
  const { error } = await supabaseAdmin
    .from("favorites")
    .upsert({ user_id: userId, code }, { onConflict: "user_id,code" });
  if (error) throw new Error(`addFavorite 失败: ${error.message}`);
}

export async function removeFavorite(userId, code) {
  const { error } = await supabaseAdmin
    .from("favorites")
    .delete()
    .eq("user_id", userId)
    .eq("code", code);
  if (error) throw new Error(`removeFavorite 失败: ${error.message}`);
}

export async function updateFundRatings(ratingsMap) {
  if (!ratingsMap || !ratingsMap.size) return { count: 0 };
  const rows = [];
  for (const [code, rating] of ratingsMap) {
    if (!code) continue;
    rows.push({
      code,
      rating_morningstar: rating?.star ?? null,
      rating_date: rating?.date ?? null,
      updated_at: new Date().toISOString(),
    });
  }
  if (!rows.length) return { count: 0 };
  const chunkSize = 200;
  let total = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabaseAdmin.from("funds").upsert(chunk, { onConflict: "code" });
    if (error) {
      console.warn(`updateFundRatings 跳过：${error.message}`);
      return { count: total, skipped: true };
    }
    total += chunk.length;
  }
  return { count: total };
}

export function fundsRowMapper() {
  return { fundToRow, rowToFund };
}
