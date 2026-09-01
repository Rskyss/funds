import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

import {
  fetchQdiiFunds,
  fetchFundDetail,
  fetchFundProfile,
  fetchManagerProfile,
  fetchNavHistory,
  fetchRatingsConcurrently,
  fetchProfilesAndMetricsConcurrently,
  fetchFundHoldings,
  fetchAssetAllocation,
  fetchFundFees,
  buildStructuredAnalysis,
  enrichFallbackFunds,
  applyPercentileScores,
  computeMaxDrawdown,
} from "./lib/eastmoney.mjs";
import {
  upsertFunds,
  appendNavHistory,
  saveNavHistoryRows,
  getAllFunds,
  getLastUpdatedAt,
  getFundDetail,
  saveFundDetail,
  saveFundManagers,
  saveFundFees,
  saveFundHoldingsCache,
  getNavHistory,
  updateFundMetric,
  backfillMaxDrawdownForCodes,
  backfillSparkForCodes,
  getFavorites,
  addFavorite,
  removeFavorite,
  insertEvents,
  getEventsSince,
  getAllAiSummaries,
  getAiSummary,
  saveAiSummary,
  getUserProfile,
  saveUserProfile,
  saveUserAiConfig,
  clearUserAiConfig,
  findInviteCode,
  claimInviteCode,
  releaseInviteCode,
  attachInviteCodeUser,
  createInviteCodes,
} from "./lib/store.mjs";
import { generateWithRetry, validateAiCredentials, generateFundSummary, generateFundDetailSummary } from "./lib/ai.mjs";
import { encryptSecret, decryptSecret, maskSecret } from "./lib/crypto.mjs";
import { publicConfig, supabaseAdmin } from "./lib/supabase.mjs";
import { verifyToken } from "./lib/auth.mjs";
import { HttpError, clientIp, isLoopbackDirect, resolvePublicPath, safeEqual, isUuid } from "./lib/http.mjs";
import { signInWithEmailPassword, translateAuthError } from "./lib/authSignIn.mjs";
import { plan as planAgent } from "./lib/agent/planner.mjs";
import { runPlan } from "./lib/agent/tools.mjs";
import { synthesize, synthesizeStream, pickCards } from "./lib/agent/synth.mjs";
import { loadSession, saveSession, appendTurn, updateLast, randomUUID } from "./lib/agent/session.mjs";
import { logChatTurn, rateLimit } from "./lib/agent/metrics.mjs";
import { suggestionTemplates } from "./lib/agent/rules.mjs";
import { getActiveHotSuggestions, maybeRefreshHotSuggestions } from "./lib/agent/hotTopics.mjs";
import { formatDataUpdateDisplay, scheduledUpdateBefore } from "./lib/dataSchedule.mjs";
import { mergeShareClassCards } from "./lib/agent/shareClass.mjs";
import { fillMissingForAll } from "./lib/mergeMetrics.mjs";

// 读取登录用户的聊天凭证（apiKey + 投问模型）；未配置/解密失败返回 null。
async function loadChatCreds(userId) {
  if (!userId) return null;
  const p = await getUserProfile(userId).catch(() => null);
  if (!p?.ai_api_key_cipher || !p?.ai_chat_model) return null;
  try { return { apiKey: decryptSecret(p.ai_api_key_cipher), model: p.ai_chat_model }; }
  catch { return null; }
}

// 读取用户的点评凭证（apiKey + 短/长评模型）。
async function loadReviewCreds(userId) {
  if (!userId) return null;
  const p = await getUserProfile(userId).catch(() => null);
  if (!p?.ai_api_key_cipher || !p?.ai_review_model) return null;
  try { return { apiKey: decryptSecret(p.ai_api_key_cipher), model: p.ai_review_model }; }
  catch { return null; }
}

const PORT = Number(process.env.PORT || 5173);
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const APP_VERSION = await readFile(path.join(ROOT, "package.json"), "utf8")
  .then((s) => JSON.parse(s).version)
  .catch(() => "unknown");
const STARTED_AT = Date.now();
// 数据刷新授权：配了 token 则请求需带 x-refresh-token；未配置时只放行本机直连（cron 打 127.0.0.1）
const DATA_REFRESH_TOKEN = process.env.DATA_REFRESH_TOKEN || "";
const REFRESH_COOLDOWN_MS = Number(process.env.DATA_REFRESH_COOLDOWN_MS || 10 * 60 * 1000);
const MAX_CHAT_MESSAGE_CHARS = 2000;
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

// ----- Admin auth -----
const adminTokens = new Map(); // token -> expiry ms
function checkAdminToken(req) {
  const t = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "").trim();
  if (!t) return false;
  const exp = adminTokens.get(t);
  if (!exp) return false;
  if (Date.now() > exp) { adminTokens.delete(t); return false; }
  return true;
}

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

async function fundsPayload(funds, fetchedAtIso) {
  const lastUpdated = fetchedAtIso || (await getLastUpdatedAt());
  const { fetchedAt, fetchedAtText } = formatDataUpdateDisplay(lastUpdated);
  return {
    fetchedAt,
    fetchedAtText,
    total: funds.length,
    funds,
  };
}

const MAX_BODY_BYTES = 1_000_000;
async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let overflow = false;
    req.on("data", (chunk) => {
      if (overflow) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        // 不直接 destroy：先让上层回 413，响应结束后 Node 会因请求体未读完而关闭连接
        overflow = true;
        req.pause();
        reject(new HttpError(413, "请求体过大"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (overflow) return;
      if (!bytes) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function refreshFunds() {
  // 先把库里现有指标读出来：本次抓失败的字段回退到上次的值（见 lib/mergeMetrics.mjs）
  const prevByCode = new Map();
  try {
    for (const f of await getAllFunds()) prevByCode.set(f.code, f);
  } catch (err) {
    console.warn(`读取现有基金指标失败，本次不做回退：${err.message}`);
  }
  const snapshot = await fetchQdiiFunds();
  const fallbackCount = snapshot.funds.filter((f) => f.source === "东方财富基金代码库").length;
  console.log(`主通道抓取完成：${snapshot.total} 只（兜底通道占 ${fallbackCount} 只，需要补全）`);

  if (fallbackCount > 0) {
    const enrichStart = Date.now();
    const stats = await enrichFallbackFunds(snapshot.funds, {
      concurrency: 8,
      onProgress: (done, total) => {
        if (done === total || done % 50 === 0) {
          console.log(`  补全进度 ${done}/${total}`);
        }
      },
    });
    console.log(`兜底通道补全完成：成功 ${stats.enriched} / 失败 ${stats.failed}，用时 ${((Date.now() - enrichStart) / 1000).toFixed(1)}s`);
    applyPercentileScores(snapshot.funds);
  }

  const codes = snapshot.funds.map((f) => f.code);
  const ratingStart = Date.now();
  console.log(`抓取晨星评级 ${codes.length} 只...`);
  try {
    const ratings = await fetchRatingsConcurrently(codes, {
      concurrency: 8,
      onProgress: (done, total) => {
        if (done === total || done % 100 === 0) {
          console.log(`  评级进度 ${done}/${total}`);
        }
      },
    });
    snapshot.funds = snapshot.funds.map((f) => {
      const r = ratings.get(f.code);
      return r ? { ...f, ratingMorningstar: r.star, ratingDate: r.date } : f;
    });
    console.log(`评级抓取完成，用时 ${((Date.now() - ratingStart) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.warn(`评级抓取跳过：${err.message}`);
  }

  const metricsStart = Date.now();
  console.log(`抓取规模/经理/夏普/波动率 ${codes.length} 只...`);
  try {
    // 并发 10 会触发东财 HTTP 514 限流（2026-09-01 实测：约 20% 基金抓空），降到 5 并配合 withRetry 的限流退避
    const metrics = await fetchProfilesAndMetricsConcurrently(codes, {
      concurrency: Number(process.env.METRICS_REFRESH_CONCURRENCY || 5),
      onProgress: (done, total) => {
        if (done === total || done % 100 === 0) {
          console.log(`  专业指标进度 ${done}/${total}`);
        }
      },
    });
    snapshot.funds = snapshot.funds.map((f) => {
      const m = metrics.get(f.code);
      return m
        ? {
            ...f,
            aumBillion: m.aumBillion,
            aumDate: m.aumDate,
            aumCurrency: m.aumCurrency,
            managerNames: m.managerNames,
            sharpe1y: m.sharpe1y,
            volatility1y: m.volatility1y,
            purchaseStatus: m.purchaseStatus,
            purchaseLimitYuan: m.purchaseLimitYuan,
            redeemStatus: m.redeemStatus,
            statusFetchedAt: m.statusFetchedAt,
          }
        : f;
    });
    console.log(`专业指标抓取完成，用时 ${((Date.now() - metricsStart) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.warn(`专业指标抓取跳过：${err.message}`);
  }

  // 指标回退 + 缺失统计：让“今天有多少只没抓到规模/夏普”在日志里看得见
  if (prevByCode.size) {
    const merged = fillMissingForAll(snapshot.funds, prevByCode);
    snapshot.funds = merged.funds;
    if (merged.restoredFunds) {
      console.log(`指标回退：${merged.restoredFunds} 只基金共 ${merged.restoredFields} 个字段本次抓取为空，沿用上次值`);
    }
  }
  const missingAum = snapshot.funds.filter((f) => f.aumBillion === null || f.aumBillion === undefined).length;
  const missingSharpe = snapshot.funds.filter((f) => f.sharpe1y === null || f.sharpe1y === undefined).length;
  console.log(`指标缺失（回退后）：规模 ${missingAum} 只，夏普 ${missingSharpe} 只 / 共 ${snapshot.funds.length} 只`);

  await upsertFunds(snapshot.funds);
  await appendNavHistory(snapshot.funds);

  const ddStart = Date.now();
  console.log(`根据净值历史计算近1年最大回撤 ${codes.length} 只...`);
  try {
    const ddMap = await backfillMaxDrawdownForCodes(codes, {
      concurrency: 12,
      onProgress: (done, total) => {
        if (done === total || done % 100 === 0) {
          console.log(`  回撤进度 ${done}/${total}`);
        }
      },
    });
    let filled = 0;
    snapshot.funds = snapshot.funds.map((f) => {
      const dd = ddMap.get(f.code);
      if (dd === null || dd === undefined) return f;
      filled++;
      return { ...f, maxDrawdown1y: dd };
    });
    console.log(`最大回撤计算完成：${filled} 只有值，用时 ${((Date.now() - ddStart) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.warn(`最大回撤计算跳过：${err.message}`);
  }

  const sparkStart = Date.now();
  console.log(`根据净值历史生成列表精简曲线 ${codes.length} 只...`);
  try {
    const sparkMap = await backfillSparkForCodes(codes, {
      concurrency: 12,
      onProgress: (done, total) => {
        if (done === total || done % 100 === 0) {
          console.log(`  曲线进度 ${done}/${total}`);
        }
      },
    });
    let sFilled = 0;
    sparkMap.forEach((v) => { if (v) sFilled++; });
    console.log(`列表曲线生成完成：${sFilled} 只有值，用时 ${((Date.now() - sparkStart) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.warn(`列表曲线生成跳过：${err.message}`);
  }

  return snapshot;
}

// 全量刷新单飞：同一时刻只跑一份，并发触发（cron + 启动自检 + 手动）共用同一个 Promise。
let refreshInflight = null;
let lastRefreshOkAt = 0;
function runRefreshOnce() {
  if (refreshInflight) return refreshInflight;
  refreshInflight = refreshFunds()
    .then((snap) => { lastRefreshOkAt = Date.now(); return snap; })
    .finally(() => { refreshInflight = null; });
  return refreshInflight;
}

function refreshAuthorized(req) {
  if (DATA_REFRESH_TOKEN) {
    const supplied = req.headers["x-refresh-token"];
    if (typeof supplied === "string" && safeEqual(supplied, DATA_REFRESH_TOKEN)) return true;
  }
  if (checkAdminToken(req)) return true;
  if (!DATA_REFRESH_TOKEN && isLoopbackDirect(req)) return true;
  return false;
}

async function attachAiSummaries(funds) {
  const map = await getAllAiSummaries();
  return funds.map((f) => {
    const row = map.get(f.code);
    return row
      ? { ...f, aiSummary: row.summary, aiSummaryModel: row.model, aiSummaryAt: row.generated_at }
      : { ...f, aiSummary: null };
  });
}

/** 列表快照，供详情页同类对比复用，避免每次打开抽屉都查全表 */
let fundsListSnapshot = null;

function rememberFundsSnapshot(funds) {
  if (Array.isArray(funds) && funds.length) {
    fundsListSnapshot = funds;
  }
}

async function getFundsSnapshot() {
  if (fundsListSnapshot?.length) return fundsListSnapshot;
  const funds = await getAllFunds();
  if (funds.length) applyPercentileScores(funds);
  rememberFundsSnapshot(funds);
  return funds;
}

async function loadOrRefresh(refresh) {
  // 列表响应折叠同基金多份额（主份额出卡、其余进 altShares）；
  // 内存快照 rememberFundsSnapshot 保留全量，详情同类对比与聊天 Agent 不受影响
  if (refresh) {
    const snapshot = await runRefreshOnce();
    const withAi = await attachAiSummaries(snapshot.funds);
    rememberFundsSnapshot(withAi);
    const merged = mergeShareClassCards(withAi);
    const lastUpdated = await getLastUpdatedAt();
    const { fetchedAt, fetchedAtText } = formatDataUpdateDisplay(lastUpdated);
    return { ...snapshot, funds: merged, total: merged.length, fetchedAt, fetchedAtText };
  }
  const funds = await getAllFunds();
  if (funds.length) {
    applyPercentileScores(funds);
    const [withAi, lastUpdated] = await Promise.all([attachAiSummaries(funds), getLastUpdatedAt()]);
    rememberFundsSnapshot(withAi);
    const merged = mergeShareClassCards(withAi);
    const { fetchedAt, fetchedAtText } = formatDataUpdateDisplay(lastUpdated);
    return {
      fetchedAt,
      fetchedAtText,
      total: merged.length,
      funds: merged,
    };
  }
  const snapshot = await runRefreshOnce();
  const withAi = await attachAiSummaries(snapshot.funds);
  rememberFundsSnapshot(withAi);
  const merged = mergeShareClassCards(withAi);
  const lastUpdated = await getLastUpdatedAt();
  const { fetchedAt, fetchedAtText } = formatDataUpdateDisplay(lastUpdated);
  return { ...snapshot, funds: merged, total: merged.length, fetchedAt, fetchedAtText };
}

async function loadFundDetailWithHistory(code, allFundsCache) {
  const [detailRow, navHistory, aiRow, funds] = await Promise.all([
    getFundDetail(code),
    getNavHistory(code),
    getAiSummary(code),
    allFundsCache?.length ? Promise.resolve(allFundsCache) : getFundsSnapshot(),
  ]);

  let detail = detailRow
    ? {
        code: detailRow.code,
        goal: detailRow.goal || "",
        scope: detailRow.scope || "",
        benchmark: detailRow.benchmark || "",
        detailUrl: detailRow.detail_url || `https://fundf10.eastmoney.com/jbgk_${code}.html`,
      }
    : null;

  if (!detail) {
    detail = {
      code,
      goal: "",
      scope: "",
      benchmark: "",
      detailUrl: `https://fundf10.eastmoney.com/jbgk_${code}.html`,
    };
    fetchFundDetail(code)
      .then((row) => saveFundDetail(row))
      .catch(() => {});
  }

  const fund = funds.find((item) => item.code === code);
  const analysis = fund ? buildStructuredAnalysis(fund, funds, detail) : null;

  const maxDrawdown1y = computeMaxDrawdown(navHistory);
  if (maxDrawdown1y !== null && (!fund || fund.maxDrawdown1y !== maxDrawdown1y)) {
    updateFundMetric(code, { max_drawdown_1y: maxDrawdown1y }).catch(() => {});
    if (fund) fund.maxDrawdown1y = maxDrawdown1y;
  }

  if (navHistory.length < 60) {
    fetchNavHistory(code, 240)
      .then((rows) => (rows.length ? saveNavHistoryRows(code, rows) : null))
      .catch(() => {});
  }

  let holdingsResult;
  let assetAllocation;
  if (detailRow?.holdings_fetched_at) {
    holdingsResult = Array.isArray(detailRow.holdings_json)
      ? { holdings: detailRow.holdings_json, reportDate: detailRow.holdings_report_date || null }
      : { holdings: [], reportDate: null };
    assetAllocation = Array.isArray(detailRow.asset_allocation_json) ? detailRow.asset_allocation_json : [];
  } else {
    holdingsResult = { holdings: [], reportDate: null };
    assetAllocation = [];
    Promise.all([
      fetchFundHoldings(code),
      fetchAssetAllocation(code).catch(() => []),
    ])
      .then(([fetched, fetchedAlloc]) => {
        saveFundHoldingsCache(code, fetched, fetchedAlloc || []).catch(() => {});
      })
      .catch(() => {});
  }

  let managers = [];
  if (Array.isArray(detailRow?.managers_json) && detailRow.managers_json.length) {
    managers = detailRow.managers_json;
  } else {
    // 库里没有经理数据：先用基金表里的姓名兜底秒回，后台异步补抓并落库
    const fundRow = funds.find((item) => item.code === code);
    if (fundRow?.managerNames) {
      managers = fundRow.managerNames.split(/[、,，]/).map((name) => ({ id: null, name: name.trim() })).filter((m) => m.name);
    }
    if (!detailRow?.managers_fetched_at) {
      fetchFundProfile(code)
        .then((profile) => saveFundManagers(code, profile.managers || []))
        .catch(() => {});
    }
  }

  let buyFees = Array.isArray(detailRow?.buy_fees_json) ? detailRow.buy_fees_json : [];
  let redeemFees = Array.isArray(detailRow?.redeem_fees_json) ? detailRow.redeem_fees_json : [];
  let operatingFees = detailRow?.operating_fees_json && typeof detailRow.operating_fees_json === "object"
    ? detailRow.operating_fees_json
    : null;
  if (!detailRow?.fees_fetched_at || !operatingFees?.management) {
    fetchFundFees(code)
      .then((fees) => {
        const nextBuy = fees.buyFees?.length ? fees.buyFees : buyFees;
        const nextRedeem = fees.redeemFees?.length ? fees.redeemFees : redeemFees;
        const nextOp = fees.operatingFees || operatingFees;
        saveFundFees(code, nextBuy, nextRedeem, nextOp).catch(() => {});
      })
      .catch(() => {});
  }

  return {
    ...detail,
    managers,
    navHistory,
    analysis,
    maxDrawdown1y,
    holdings: holdingsResult.holdings,
    holdingsReportDate: holdingsResult.reportDate,
    assetAllocation,
    holdingsFromCache: Boolean(detailRow?.holdings_fetched_at),
    holdingsFetchedAt: detailRow?.holdings_fetched_at || null,
    buyFees,
    redeemFees,
    operatingFees,
    aiSummary: aiRow?.summary || null,
    aiSummaryModel: aiRow?.model || null,
    aiSummaryAt: aiRow?.generated_at || null,
    aiDetail: aiRow?.detail_summary || null,
    aiDetailModel: aiRow?.detail_model || null,
    aiDetailAt: aiRow?.detail_generated_at || null,
  };
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  // 路径守卫：任何越界（../、编码的 ..%2f、同前缀兄弟目录）一律 404，不暴露目录结构
  const filePath = resolvePublicPath(PUBLIC_DIR, url.pathname);
  if (!filePath) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  try {
    const ext = path.extname(filePath);
    const body = await readFile(filePath);
    // 带内容哈希的构建产物可永久缓存；HTML 入口必须每次校验，否则刷新拿不到新代码
    const isHashedAsset = filePath.startsWith(path.join(PUBLIC_DIR, "assets") + path.sep);
    const cacheControl = isHashedAsset
      ? "public, max-age=31536000, immutable"
      : "no-cache";
    res.writeHead(200, {
      "content-type": mimeTypes[ext] || "application/octet-stream",
      "cache-control": cacheControl,
    });
    res.end(body);
  } catch {
    // SPA fallback：对于不存在的路径（如 /admin）统一返回 index.html
    try {
      const body = await readFile(path.join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  }
}

async function requireUser(req, res) {
  const result = await verifyToken(req.headers["authorization"]);
  if (!result) {
    json(res, 401, { error: "请先登录" });
    return null;
  }
  return result;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  try {
    if (url.pathname === "/api/health" && req.method === "GET") {
      let db = "ok";
      let dataUpdatedAt = null;
      try {
        dataUpdatedAt = await Promise.race([
          getLastUpdatedAt(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("db timeout")), 3000)),
        ]);
      } catch {
        db = "error";
      }
      const ok = db === "ok";
      json(res, ok ? 200 : 503, {
        ok,
        version: APP_VERSION,
        uptimeSec: Math.round((Date.now() - STARTED_AT) / 1000),
        db,
        dataUpdatedAt,
        refreshing: Boolean(refreshInflight),
      });
      return;
    }

    if (url.pathname === "/api/config") {
      json(res, 200, publicConfig);
      return;
    }

    if (url.pathname === "/api/chat/suggestions" && req.method === "GET") {
      const base = suggestionTemplates();
      const hot = await getActiveHotSuggestions().catch(() => null);
      json(res, 200, {
        ...base,
        hot: hot?.questions || [],
        hotMeta: hot ? { reason: hot.triggerReason, createdAt: hot.createdAt } : null,
      });
      return;
    }

    if (url.pathname === "/api/funds" && req.method === "GET") {
      let refresh = url.searchParams.get("refresh") === "1";
      let refreshSkipped = null;
      if (refresh) {
        // 全量重抓要打上千次外部请求，不能让匿名访客随手触发：需要 token / 后台登录 / 本机直连
        if (!refreshAuthorized(req)) throw new HttpError(401, "刷新数据需要授权（x-refresh-token 或后台登录）");
        if (!refreshInflight && Date.now() - lastRefreshOkAt < REFRESH_COOLDOWN_MS) {
          refresh = false;
          refreshSkipped = "cooldown";
        }
      }
      const snapshot = await loadOrRefresh(refresh);
      json(res, 200, refreshSkipped ? { ...snapshot, refreshSkipped } : snapshot);
      // 每次"刷新数据"后（含每日 07:00 定时刷新）顺带检查一次热议是否需要更新；
      // 后台异步、失败静默，不影响响应；模块内部有 inflight 去重与触发条件判断
      if (refresh && snapshot?.funds?.length) {
        setTimeout(() => { maybeRefreshHotSuggestions(snapshot.funds); }, 1500);
      }
      return;
    }

    const detailMatch = url.pathname.match(/^\/api\/fund\/(\d{6})$/);
    if (detailMatch && req.method === "GET") {
      const detail = await loadFundDetailWithHistory(detailMatch[1], fundsListSnapshot);
      json(res, 200, detail);
      return;
    }

    const managerMatch = url.pathname.match(/^\/api\/manager\/(\d+)$/);
    if (managerMatch && req.method === "GET") {
      // 这是对东财的实时代理抓取，按 IP 限流，避免被当成跳板
      const rl = rateLimit(`manager:${clientIp(req)}`, { limit: 30 });
      if (!rl.allowed) throw new HttpError(429, "请求太频繁，请稍后再试");
      const profile = await fetchManagerProfile(managerMatch[1]);
      json(res, 200, profile);
      return;
    }

    const regenMatch = url.pathname.match(/^\/api\/fund\/(\d{6})\/ai-summary$/);
    if (regenMatch && req.method === "POST") {
      // 用平台 Key 重生成并覆盖全站共享点评：运营动作，仅限后台管理员
      if (!checkAdminToken(req)) throw new HttpError(403, "该操作仅限后台管理员");
      const code = regenMatch[1];
      const funds = await getAllFunds();
      const fund = funds.find((f) => f.code === code);
      if (!fund) {
        json(res, 404, { error: "未找到该基金" });
        return;
      }
      const { summary, model } = await generateWithRetry(fund);
      await saveAiSummary(code, summary, model);
      json(res, 200, { summary, model, generatedAt: new Date().toISOString() });
      return;
    }

    const previewMatch = url.pathname.match(/^\/api\/fund\/(\d{6})\/ai-summary\/preview$/);
    if (previewMatch && req.method === "POST") {
      const code = previewMatch[1];
      const tokenUser = await verifyToken(req.headers["authorization"]).catch(() => null);
      if (!tokenUser?.userId) { json(res, 401, { error: "请先登录" }); return; }
      const rlPreview = rateLimit(`ai:preview:${tokenUser.userId}`, { limit: 6 });
      if (!rlPreview.allowed) throw new HttpError(429, "重新生成太频繁，请稍后再试");
      const creds = await loadReviewCreds(tokenUser.userId);
      if (!creds) { json(res, 403, { error: "请先在「模型设置」中填写 API Key 与短/长评模型", code: "NO_AI_KEY" }); return; }
      const funds = await getAllFunds();
      const fund = funds.find((f) => f.code === code);
      if (!fund) { json(res, 404, { error: "未找到该基金" }); return; }
      const body = await readBody(req).catch(() => ({}));
      try {
        const card = await generateFundSummary(fund, { model: creds.model, apiKey: creds.apiKey });
        let detail = null;
        if (body.long === true) {
          const d = await generateFundDetailSummary(fund, { model: creds.model, apiKey: creds.apiKey, cardSummary: card.summary });
          detail = d.detail;
        }
        json(res, 200, { summary: card.summary, detail, model: creds.model, ephemeral: true });
      } catch (err) {
        json(res, 400, { error: `生成失败：${err.message}` });
      }
      return;
    }

    if (url.pathname === "/api/chat/sessions" && req.method === "GET") {
      const tokenUser = await verifyToken(req.headers["authorization"]).catch(() => null);
      if (!tokenUser?.userId) {
        json(res, 200, { sessions: [] });
        return;
      }
      const { data, error } = await supabaseAdmin
        .from("chat_sessions")
        .select("session_id, state, updated_at, created_at")
        .eq("user_id", tokenUser.userId)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(`chat_sessions 查询失败: ${error.message}`);
      const sessions = (data || []).map((row) => {
        const msgs = Array.isArray(row.state?.messages) ? row.state.messages : [];
        const firstUser = msgs.find((m) => m.role === "user");
        const title = (firstUser?.content || "新会话").trim().slice(0, 30) || "新会话";
        return {
          sessionId: row.session_id,
          title,
          updatedAt: row.updated_at,
          createdAt: row.created_at,
          count: msgs.length,
        };
      }).filter((s) => s.count > 0);
      json(res, 200, { sessions });
      return;
    }

    if (url.pathname === "/api/chat/history" && req.method === "GET") {
      const qSession = url.searchParams.get("sessionId");
      if (!qSession) {
        json(res, 400, { error: "缺少 sessionId" });
        return;
      }
      const loaded = await loadSession(qSession).catch(() => null);
      if (!loaded || loaded.isNew) {
        json(res, 200, { sessionId: qSession, messages: [] });
        return;
      }
      const tokenUser = await verifyToken(req.headers["authorization"]).catch(() => null);
      if (loaded.userId && (!tokenUser?.userId || tokenUser.userId !== loaded.userId)) {
        json(res, 403, { error: "无权访问该会话" });
        return;
      }
      const messages = Array.isArray(loaded.state.messages) ? loaded.state.messages : [];
      json(res, 200, {
        sessionId: loaded.sessionId,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ts: m.ts || null,
          cards: Array.isArray(m.cards) ? m.cards : [],
          sources: Array.isArray(m.sources) ? m.sources : [],
          plan: m.plan || null,
        })),
      });
      return;
    }

    if (url.pathname === "/api/profile" && req.method === "GET") {
      const tokenUser = await verifyToken(req.headers["authorization"]).catch(() => null);
      if (!tokenUser?.userId) {
        json(res, 401, { error: "请先登录" });
        return;
      }
      const profile = await getUserProfile(tokenUser.userId);
      let aiKeyMask = null;
      if (profile?.ai_api_key_cipher) {
        try { aiKeyMask = maskSecret(decryptSecret(profile.ai_api_key_cipher)); } catch { aiKeyMask = null; }
      }
      // 绝不把加密密文下发前端：剥掉 ai_api_key_cipher 再返回
      const { ai_api_key_cipher, ...safeProfile } = profile || {};
      json(res, 200, {
        profile: {
          ...safeProfile,
          aiChatModel: profile?.ai_chat_model || null,
          aiReviewModel: profile?.ai_review_model || null,
          aiKeyMask,
          aiConfigured: !!(profile?.ai_api_key_cipher && profile?.ai_chat_model),
        },
      });
      return;
    }

    if (url.pathname === "/api/profile/ai/validate" && req.method === "POST") {
      const tokenUser = await verifyToken(req.headers["authorization"]).catch(() => null);
      if (!tokenUser?.userId) { json(res, 401, { error: "请先登录" }); return; }
      const rlValidate = rateLimit(`ai:validate:${tokenUser.userId}`, { limit: 6 });
      if (!rlValidate.allowed) throw new HttpError(429, "校验太频繁，请稍后再试");
      const body = await readBody(req);
      const key = typeof body.aiApiKey === "string" ? body.aiApiKey.trim() : "";
      if (!key) { json(res, 400, { error: "请填写 API Key" }); return; }
      const check = await validateAiCredentials({ apiKey: key, model: "qwen-plus" });
      json(res, check.ok ? 200 : 400, check.ok ? { ok: true } : { ok: false, error: check.error });
      return;
    }

    if (url.pathname === "/api/profile" && req.method === "POST") {
      const tokenUser = await verifyToken(req.headers["authorization"]).catch(() => null);
      if (!tokenUser?.userId) {
        json(res, 401, { error: "请先登录" });
        return;
      }
      const rlProfile = rateLimit(`profile:${tokenUser.userId}`, { limit: 20 });
      if (!rlProfile.allowed) throw new HttpError(429, "操作太频繁，请稍后再试");
      const body = await readBody(req);
      if (body.clearAiKey === true) {
        await clearUserAiConfig(tokenUser.userId);
        json(res, 200, { ok: true, aiConfigured: false });
        return;
      }
      if (body.aiApiKey !== undefined || body.aiChatModel !== undefined || body.aiReviewModel !== undefined) {
        const chatModel = typeof body.aiChatModel === "string" ? body.aiChatModel.trim() : "";
        const reviewModel = typeof body.aiReviewModel === "string" ? body.aiReviewModel.trim() : "";
        if (!chatModel || !reviewModel) { json(res, 400, { error: "请填写投问模型与短/长评模型" }); return; }
        const existing = await getUserProfile(tokenUser.userId).catch(() => null);
        let cipher = existing?.ai_api_key_cipher || null;
        let plainKey = null;
        if (typeof body.aiApiKey === "string" && body.aiApiKey.trim()) {
          plainKey = body.aiApiKey.trim();
          cipher = encryptSecret(plainKey);
        } else if (cipher) {
          try { plainKey = decryptSecret(cipher); } catch { plainKey = null; }
        }
        if (!plainKey || !cipher) { json(res, 400, { error: "请先填写 API Key" }); return; }
        const check = await validateAiCredentials({ apiKey: plainKey, model: chatModel });
        if (!check.ok) { json(res, 400, { error: `投问模型校验失败：${check.error}` }); return; }
        if (reviewModel !== chatModel) {
          const checkReview = await validateAiCredentials({ apiKey: plainKey, model: reviewModel });
          if (!checkReview.ok) { json(res, 400, { error: `短/长评模型校验失败：${checkReview.error}` }); return; }
        }
        await saveUserAiConfig(tokenUser.userId, { cipher, chatModel, reviewModel });
        json(res, 200, { ok: true, aiConfigured: true, aiChatModel: chatModel, aiReviewModel: reviewModel, aiKeyMask: maskSecret(plainKey) });
        return;
      }
      const RISK = ["low", "mid", "high"];
      const HORIZON = ["short", "mid", "long"];
      const AMOUNT = ["<10w", "10-50w", "50-200w", ">200w"];
      const FUND_YEARS = ["none", "lt1", "1to3", "3to5", "gt5"];
      const REGIONS = ["美国", "欧洲", "日本", "印度", "港股", "亚太/新兴", "全球"];
      if (body.riskPref && !RISK.includes(body.riskPref)) { json(res, 400, { error: "riskPref 不合法" }); return; }
      if (body.horizon && !HORIZON.includes(body.horizon)) { json(res, 400, { error: "horizon 不合法" }); return; }
      if (body.amountBand && !AMOUNT.includes(body.amountBand)) { json(res, 400, { error: "amountBand 不合法" }); return; }
      if (body.fundYears && !FUND_YEARS.includes(body.fundYears)) { json(res, 400, { error: "fundYears 不合法" }); return; }
      const regions = Array.isArray(body.regions) ? body.regions.filter((r) => REGIONS.includes(r)) : [];
      const saved = await saveUserProfile(tokenUser.userId, {
        riskPref: body.riskPref || null,
        horizon: body.horizon || null,
        regions,
        amountBand: body.amountBand || null,
        fundYears: body.fundYears || null,
      });
      json(res, 200, { profile: saved });
      return;
    }

    if (url.pathname === "/api/chat" && req.method === "POST") {
      const body = await readBody(req);
      const userMessage = typeof body.message === "string" ? body.message.trim() : "";
      const wantStream = url.searchParams.get("stream") === "1" || body.stream === true;
      if (!userMessage) {
        json(res, 400, { error: "message 不能为空" });
        return;
      }
      const tokenUser = await verifyToken(req.headers["authorization"]).catch(() => null);
      const userId = tokenUser?.userId || null;
      const ip = clientIp(req);
      // 限流按登录用户（未登录按 IP）计数；旧实现把客户端可控的 sessionId 拼进 key，换个 id 就是新额度
      const rl = rateLimit(`chat:${userId || ip}`);
      if (!rl.allowed) {
        const retrySec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
        res.setHeader("Retry-After", String(retrySec));
        json(res, 429, { error: `请求太频繁，${retrySec}s 后再试`, limit: rl.limit });
        return;
      }
      if (userMessage.length > MAX_CHAT_MESSAGE_CHARS) {
        json(res, 400, { error: `问题太长了，请控制在 ${MAX_CHAT_MESSAGE_CHARS} 字以内` });
        return;
      }
      const session = await loadSession(isUuid(body.sessionId) ? body.sessionId : null);
      // 会话归属：别人的会话不能续写（/api/chat/history 早有这条校验，这里之前漏了）
      if (!session.isNew && session.userId && session.userId !== userId) {
        json(res, 403, { error: "无权访问该会话" });
        return;
      }
      const sessionId = session.sessionId || randomUUID();
      const history = Array.isArray(session.state.messages) ? session.state.messages : [];
      const userProfile = userId ? await getUserProfile(userId).catch(() => null) : null;
      const chatCreds = await loadChatCreds(userId);
      if (!chatCreds) {
        if (wantStream) {
          res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
          res.write(`event: error\ndata: ${JSON.stringify({ message: "请先在「模型设置」中填写你的百炼 API Key", code: "NO_AI_KEY" })}\n\n`);
          res.end();
        } else {
          json(res, 403, { error: "请先在「模型设置」中填写你的百炼 API Key", code: "NO_AI_KEY" });
        }
        return;
      }
      const turnStart = Date.now();

      if (wantStream) {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        const send = (event, data) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        let planResult = null;
        let state = null;
        let synth = null;
        let errMsg = null;
        try {
          send("session", { sessionId });
          planResult = await planAgent({
            user: userMessage,
            history,
            lastCodes: session.state.lastCodes || [],
            lastFilters: session.state.lastFilters || null,
            profile: userProfile,
            creds: chatCreds,
          });
          console.log("[plan]", JSON.stringify({
            intent: planResult.intent,
            filter: planResult.filter,
            codes: planResult.codes,
            holdingQuery: planResult.holdingQuery,
          }));
          send("plan", {
            intent: planResult.intent,
            codes: planResult.codes,
            filter: planResult.filter,
            holdingQuery: planResult.holdingQuery,
            needF10: planResult.needF10,
          });

          state = await runPlan(planResult);
          send("tools", state.trace || []);
          send("cards", pickCards(state));
          send("sources", state.sources || []);

          synth = await synthesizeStream({
            user: userMessage,
            history,
            state,
            profile: userProfile,
            onDelta: (delta) => send("delta", { text: delta }),
            onReasoningDelta: (delta) => send("thinking", { text: delta }),
            creds: chatCreds,
          });
          if (!synth.ok) {
            const fallback = synth.error?.includes("AllocationQuota.FreeTierOnly")
              ? "服务这边的高阶模型免费额度已经用完，需要开启百炼付费调用或切回普通模型后再试。"
              : "服务这边的模型暂时有点忙，先稍后再问一次吧。也可以换种说法重新提问。";
            send("delta", { text: fallback });
            synth = { ok: false, model: synth.model, reply: fallback, error: synth.error };
          }
          send("final", { reply: synth.reply, ok: synth.ok, model: synth.model });

          appendTurn(session.state, "user", userMessage);
          appendTurn(session.state, "assistant", synth.reply, {
            cards: pickCards(state),
            sources: state.sources || [],
            plan: { intent: planResult.intent },
          });
          const codesForNext = state.funds && state.funds.length ? state.funds.map((f) => f.code) : planResult.codes;
          updateLast(session.state, { codes: codesForNext, filter: planResult.filter });
          try {
            await saveSession({ sessionId, userId, state: session.state });
          } catch (err) {
            console.warn("saveSession 失败:", err.message);
          }
          send("done", {});
        } catch (err) {
          errMsg = err.message;
          console.error("[chat/stream]", err);
          send("error", { message: err instanceof HttpError ? err.message : "服务暂时不可用，请稍后再试" });
        } finally {
          logChatTurn({
            sessionId,
            userId,
            ip,
            intent: planResult?.intent || null,
            userMessage,
            reply: synth?.reply || "",
            tools: state?.trace || [],
            plan: planResult ? {
              intent: planResult.intent,
              codes: planResult.codes,
              filter: planResult.filter,
              holdingQuery: planResult.holdingQuery,
              needF10: planResult.needF10,
            } : null,
            cardsCount: state?.funds?.length || 0,
            sourcesCount: state?.sources?.length || 0,
            latencyMs: Date.now() - turnStart,
            ok: synth ? synth.ok !== false : false,
            degraded: state?.event ? !!state.event.degraded : false,
            error: errMsg || synth?.error || null,
          });
        }
        res.end();
        return;
      }

      const planResult = await planAgent({
        user: userMessage,
        history,
        lastCodes: session.state.lastCodes || [],
        lastFilters: session.state.lastFilters || null,
        profile: userProfile,
        creds: chatCreds,
      });

      const state = await runPlan(planResult);
      let synth = await synthesize({ user: userMessage, history, state, profile: userProfile, creds: chatCreds });
      if (!synth.ok) {
        synth = {
          ...synth,
          reply: synth.error?.includes("AllocationQuota.FreeTierOnly")
            ? "服务这边的高阶模型免费额度已经用完，需要开启百炼付费调用或切回普通模型后再试。"
            : "服务这边的模型暂时有点忙，先稍后再问一次吧。也可以换种说法重新提问。",
        };
      }

      appendTurn(session.state, "user", userMessage);
      appendTurn(session.state, "assistant", synth.reply, {
        cards: pickCards(state),
        sources: state.sources || [],
        plan: { intent: planResult.intent },
      });
      const codesForNext = state.funds && state.funds.length ? state.funds.map((f) => f.code) : planResult.codes;
      updateLast(session.state, { codes: codesForNext, filter: planResult.filter });

      try {
        await saveSession({ sessionId, userId, state: session.state });
      } catch (err) {
        console.warn("saveSession 失败:", err.message);
      }

      logChatTurn({
        sessionId,
        userId,
        ip,
        intent: planResult.intent,
        userMessage,
        reply: synth.reply,
        tools: state.trace,
        plan: { intent: planResult.intent, codes: planResult.codes, filter: planResult.filter, needF10: planResult.needF10 },
        cardsCount: state.funds?.length || 0,
        sourcesCount: state.sources?.length || 0,
        latencyMs: Date.now() - turnStart,
        ok: synth.ok !== false,
        degraded: state.event ? !!state.event.degraded : false,
        error: synth.error || null,
      });

      json(res, 200, {
        sessionId,
        reply: synth.reply,
        cards: pickCards(state),
        plan: {
          intent: planResult.intent,
          codes: planResult.codes,
          filter: planResult.filter,
          needF10: planResult.needF10,
        },
        sources: state.sources || [],
        tools: state.trace || [],
        meta: {
          plannerModel: planResult.model || null,
          synthModel: synth.model || null,
          ok: synth.ok,
          eventDegraded: state.event ? !!state.event.degraded : null,
        },
      });
      return;
    }

    if (url.pathname === "/api/auth/signin" && req.method === "POST") {
      const ip = clientIp(req);
      const body = await readBody(req);
      const emailKey = String(body.email || "").trim().toLowerCase();
      // 防暴力试密码：按 IP 与按邮箱各一道
      if (!rateLimit(`auth:signin:ip:${ip}`, { limit: 10 }).allowed || (emailKey && !rateLimit(`auth:signin:email:${emailKey}`, { limit: 5, windowMs: 5 * 60_000 }).allowed)) {
        throw new HttpError(429, "登录尝试太频繁，请稍后再试");
      }
      try {
        const session = await signInWithEmailPassword(body.email, body.password);
        json(res, 200, { session });
      } catch (err) {
        const status = [400, 401, 403, 422, 429].includes(err.code) ? err.code : 401;
        json(res, status, { error: err.message || translateAuthError("Invalid login credentials") });
      }
      return;
    }

    if (url.pathname === "/api/auth/signup" && req.method === "POST") {
      if (!rateLimit(`auth:signup:${clientIp(req)}`, { limit: 5, windowMs: 10 * 60_000 }).allowed) {
        throw new HttpError(429, "注册太频繁，请稍后再试");
      }
      const body = await readBody(req);
      const email = (body.email || "").trim().toLowerCase();
      const password = body.password || "";
      if (!email || !email.includes("@")) {
        json(res, 400, { error: "邮箱格式不正确" });
        return;
      }
      if (password.length < 6) {
        json(res, 400, { error: "密码至少 6 位" });
        return;
      }
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) {
        const msg = error.message || "注册失败";
        const code = msg.includes("already") || msg.includes("registered") ? 409 : 400;
        json(res, code, { error: msg.includes("already") ? "该邮箱已注册" : msg });
        return;
      }
      const newUserId = data?.user?.id || null;
      json(res, 200, { ok: true, userId: newUserId });
      return;
    }

    if (url.pathname === "/api/favorites" && req.method === "GET") {
      const user = await requireUser(req, res);
      if (!user) return;
      const favorites = await getFavorites(user.userId);
      json(res, 200, { favorites: favorites.map((f) => f.code) });
      return;
    }

    if (url.pathname === "/api/favorites" && req.method === "POST") {
      const user = await requireUser(req, res);
      if (!user) return;
      const body = await readBody(req);
      if (!body.code || !/^\d{6}$/.test(body.code)) {
        json(res, 400, { error: "code 必须是 6 位基金代码" });
        return;
      }
      await addFavorite(user.userId, body.code);
      json(res, 200, { ok: true });
      return;
    }

    const favDeleteMatch = url.pathname.match(/^\/api\/favorites\/(\d{6})$/);
    if (favDeleteMatch && req.method === "DELETE") {
      const user = await requireUser(req, res);
      if (!user) return;
      await removeFavorite(user.userId, favDeleteMatch[1]);
      json(res, 200, { ok: true });
      return;
    }

    // ===== 匿名行为事件采集（公开；匿名可写，登录则带 user_id）=====
    if (url.pathname === "/api/events" && req.method === "POST") {
      if (!rateLimit(`events:${clientIp(req)}`, { limit: 60 }).allowed) {
        json(res, 429, { ok: false, saved: 0 });
        return;
      }
      const body = await readBody(req);
      const list = Array.isArray(body.events) ? body.events : (body && body.type ? [body] : []);
      if (!list.length) { json(res, 200, { ok: true, saved: 0 }); return; }
      let userId = null;
      try { const u = await verifyToken(req.headers["authorization"]); userId = u?.userId || null; } catch {}
      const ALLOWED = new Set(["page_view", "fund_open", "search", "filter"]);
      const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : null);
      const rows = list.slice(0, 50)
        .filter((e) => e && ALLOWED.has(e.type))
        .map((e) => {
          // payload 只保留白名单字段，绝不存敏感信息
          let payload = null;
          if (e.payload && typeof e.payload === "object") {
            const p = {};
            if (typeof e.payload.q === "string") p.q = e.payload.q.slice(0, 80);
            if (typeof e.payload.label === "string") p.label = e.payload.label.slice(0, 40);
            if (Object.keys(p).length) payload = p;
          }
          return {
            anon_id: clip(e.anonId, 64),
            user_id: userId,
            type: e.type,
            code: clip(e.code, 12),
            payload,
          };
        });
      if (rows.length) {
        try { await insertEvents(rows); } catch (err) { console.warn("insertEvents 失败:", err.message); }
      }
      json(res, 200, { ok: true, saved: rows.length });
      return;
    }

    // ===== Admin API =====
    if (url.pathname === "/api/admin/login" && req.method === "POST") {
      if (!rateLimit(`admin:login:${clientIp(req)}`, { limit: 5, windowMs: 5 * 60_000 }).allowed) {
        throw new HttpError(429, "尝试太频繁，请 5 分钟后再试");
      }
      const body = await readBody(req);
      const pw = process.env.ADMIN_PASSWORD;
      if (!pw) { json(res, 503, { error: "ADMIN_PASSWORD 未配置" }); return; }
      if (typeof body.password !== "string" || !safeEqual(body.password, pw)) { json(res, 401, { error: "密码错误" }); return; }
      const token = randomBytes(32).toString("hex");
      adminTokens.set(token, Date.now() + 24 * 60 * 60 * 1000);
      json(res, 200, { token });
      return;
    }

    if (url.pathname === "/api/admin/verify" && req.method === "GET") {
      if (!checkAdminToken(req)) { json(res, 401, { error: "未授权" }); return; }
      json(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/admin/stats" && req.method === "GET") {
      if (!checkAdminToken(req)) { json(res, 401, { error: "未授权" }); return; }
      const [usersRes, invitesRes, chatCountRes, chatRowsRes, favRes, profileRes] = await Promise.all([
        supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
        supabaseAdmin.from("invite_codes").select("status"),
        supabaseAdmin.from("chat_logs").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("chat_logs")
          .select("user_id, intent, ok, degraded, latency_ms, cards_count, created_at")
          .order("created_at", { ascending: false })
          .limit(10000),
        supabaseAdmin.from("favorites").select("code"),
        supabaseAdmin.from("user_profile").select("ai_api_key_cipher, ai_chat_model"),
      ]);

      const users = usersRes.data?.users || [];
      const invites = invitesRes.data || [];
      const chatRows = chatRowsRes.data || [];
      const favRows = favRes.data || [];
      const profiles = profileRes.data || [];

      const now = Date.now();
      const DAY = 86400000;
      const dayKey = (d) => {
        const dt = new Date(d);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      };
      const days = [];
      for (let i = 13; i >= 0; i--) days.push(dayKey(now - i * DAY));
      const emptyDayMap = () => Object.fromEntries(days.map((d) => [d, 0]));

      // 注册趋势 + 近7天新增
      const regMap = emptyDayMap();
      let newUsers7d = 0;
      for (const u of users) {
        const k = dayKey(u.created_at);
        if (k in regMap) regMap[k] += 1;
        if (now - new Date(u.created_at).getTime() <= 7 * DAY) newUsers7d += 1;
      }

      // 对话趋势 / 活跃 / 意图 / 健康
      const chatMap = emptyDayMap();
      const activeByDay = Object.fromEntries(days.map((d) => [d, new Set()]));
      const intentCount = {};
      const chatUserIds = new Set();
      const active7d = new Set();
      let okCount = 0, degradedCount = 0, errorCount = 0;
      const latencies = [];
      let filterTotal = 0, filterZeroCard = 0;
      for (const c of chatRows) {
        const k = dayKey(c.created_at);
        if (k in chatMap) chatMap[k] += 1;
        if (c.user_id) {
          chatUserIds.add(c.user_id);
          if (activeByDay[k]) activeByDay[k].add(c.user_id);
          if (now - new Date(c.created_at).getTime() <= 7 * DAY) active7d.add(c.user_id);
        }
        const it = c.intent || "未知";
        intentCount[it] = (intentCount[it] || 0) + 1;
        if (c.ok === false) errorCount += 1; else okCount += 1;
        if (c.degraded) degradedCount += 1;
        if (typeof c.latency_ms === "number") latencies.push(c.latency_ms);
        if (c.intent === "filter") {
          filterTotal += 1;
          if ((c.cards_count || 0) === 0) filterZeroCard += 1;
        }
      }
      const loaded = chatRows.length;

      // 沉默用户（注册但从未对话）
      const silentUsers = users.filter((u) => !chatUserIds.has(u.id)).length;

      // 自带模型配置率
      const aiConfiguredUsers = profiles.filter((p) => p.ai_api_key_cipher && p.ai_chat_model).length;

      // 收藏 Top10
      const favCount = {};
      for (const f of favRows) favCount[f.code] = (favCount[f.code] || 0) + 1;
      const nameMap = {};
      try {
        const snap = await getFundsSnapshot();
        for (const f of snap) nameMap[f.code] = f.name;
      } catch {}
      const topFavorites = Object.entries(favCount)
        .map(([code, count]) => ({ code, count, name: nameMap[code] || code }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      latencies.sort((a, b) => a - b);
      const pct = (p) => (latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] : null);

      json(res, 200, {
        // 兼容旧字段
        totalUsers: users.length,
        totalChats: chatCountRes.count || 0,
        unusedInvites: invites.filter((i) => i.status === "unused").length,
        usedInvites: invites.filter((i) => i.status === "used").length,
        // 新增
        newUsers7d,
        activeUsers7d: active7d.size,
        silentUsers,
        aiConfiguredUsers,
        aiConfiguredRate: users.length ? +((aiConfiguredUsers / users.length) * 100).toFixed(1) : 0,
        days,
        registerTrend: days.map((d) => regMap[d]),
        chatTrend: days.map((d) => chatMap[d]),
        activeTrend: days.map((d) => activeByDay[d].size),
        intentDist: Object.entries(intentCount)
          .map(([intent, count]) => ({ intent, count }))
          .sort((a, b) => b.count - a.count),
        health: {
          sampleSize: loaded,
          okRate: loaded ? +((okCount / loaded) * 100).toFixed(1) : 100,
          degradedRate: loaded ? +((degradedCount / loaded) * 100).toFixed(1) : 0,
          errorCount,
          latencyP50: pct(0.5),
          latencyP95: pct(0.95),
          filterTotal,
          filterZeroCard,
          zeroCardFilterRate: filterTotal ? +((filterZeroCard / filterTotal) * 100).toFixed(1) : 0,
        },
        topFavorites,
      });
      return;
    }

    if (url.pathname === "/api/admin/behavior" && req.method === "GET") {
      if (!checkAdminToken(req)) { json(res, 401, { error: "未授权" }); return; }
      const DAY = 86400000;
      const now = Date.now();
      const sinceIso = new Date(now - 14 * DAY).toISOString();
      const [events, chatRes] = await Promise.all([
        getEventsSince(sinceIso),
        supabaseAdmin.from("chat_logs").select("user_id, created_at").gte("created_at", sinceIso).limit(20000),
      ]);
      const chatRows = chatRes.data || [];

      const dayKey = (d) => {
        const dt = new Date(d);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
      };
      const days = [];
      for (let i = 13; i >= 0; i--) days.push(dayKey(now - i * DAY));
      const emptyDayMap = () => Object.fromEntries(days.map((d) => [d, 0]));

      const typeTotals = { page_view: 0, fund_open: 0, search: 0, filter: 0 };
      const visitorsByDay = Object.fromEntries(days.map((d) => [d, new Set()]));
      const openByDay = emptyDayMap();
      const searchByDay = emptyDayMap();
      const fundOpenCount = {};
      const searchCount = {};
      const visitorsSet = new Set();
      const openedSet = new Set();
      const anonUser = new Map();   // anon_id -> user_id（登录过才有）
      const firstSeen = new Map();  // anon_id -> 最早出现日
      const daysSeen = new Map();   // anon_id -> Set(日期)

      for (const e of events) {
        const k = dayKey(e.created_at);
        if (e.type in typeTotals) typeTotals[e.type] += 1;
        if (e.anon_id) {
          visitorsSet.add(e.anon_id);
          if (visitorsByDay[k]) visitorsByDay[k].add(e.anon_id);
          if (e.user_id && !anonUser.has(e.anon_id)) anonUser.set(e.anon_id, e.user_id);
          if (!daysSeen.has(e.anon_id)) daysSeen.set(e.anon_id, new Set());
          daysSeen.get(e.anon_id).add(k);
          const fs = firstSeen.get(e.anon_id);
          if (!fs || k < fs) firstSeen.set(e.anon_id, k);
        }
        if (e.type === "fund_open") {
          if (k in openByDay) openByDay[k] += 1;
          if (e.anon_id) openedSet.add(e.anon_id);
          if (e.code) fundOpenCount[e.code] = (fundOpenCount[e.code] || 0) + 1;
        }
        if (e.type === "search") {
          if (k in searchByDay) searchByDay[k] += 1;
          const q = e.payload?.q;
          if (q) searchCount[q] = (searchCount[q] || 0) + 1;
        }
      }

      const nameMap = {};
      try { const snap = await getFundsSnapshot(); for (const f of snap) nameMap[f.code] = f.name; } catch {}
      const topViewedFunds = Object.entries(fundOpenCount)
        .map(([code, count]) => ({ code, count, name: nameMap[code] || code }))
        .sort((a, b) => b.count - a.count).slice(0, 10);
      const topSearches = Object.entries(searchCount)
        .map(([q, count]) => ({ q, count }))
        .sort((a, b) => b.count - a.count).slice(0, 10);

      // 转化漏斗：访问网站 → 打开基金详情 → 用了 AI 投顾（AI 需登录，用 user_id 关联）
      const chattedUsers = new Set(chatRows.map((c) => c.user_id).filter(Boolean));
      let aiVisitors = 0;
      for (const anon of visitorsSet) {
        const uid = anonUser.get(anon);
        if (uid && chattedUsers.has(uid)) aiVisitors += 1;
      }

      // 次日回访留存（匿名访客口径）：首见日不是今天的访客里，有没有在更晚的某天再来
      let cohort = 0, returned = 0;
      const todayKey = dayKey(now);
      for (const [anon, fs] of firstSeen) {
        if (fs === todayKey) continue;
        cohort += 1;
        const ds = daysSeen.get(anon);
        let came = false;
        for (const d of ds) { if (d > fs) { came = true; break; } }
        if (came) returned += 1;
      }

      json(res, 200, {
        days,
        typeTotals,
        visitorTrend: days.map((d) => visitorsByDay[d].size),
        openTrend: days.map((d) => openByDay[d]),
        searchTrend: days.map((d) => searchByDay[d]),
        topViewedFunds,
        topSearches,
        funnel: { visitors: visitorsSet.size, openedFund: openedSet.size, askedAI: aiVisitors },
        retention: { cohort, returned, rate: cohort ? +((returned / cohort) * 100).toFixed(1) : 0 },
      });
      return;
    }

    if (url.pathname === "/api/admin/users" && req.method === "GET") {
      if (!checkAdminToken(req)) { json(res, 401, { error: "未授权" }); return; }
      const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
      const users = authData?.users || [];
      const { data: chatRows } = await supabaseAdmin.from("chat_logs").select("user_id").not("user_id", "is", null);
      const chatMap = {};
      for (const c of chatRows || []) chatMap[c.user_id] = (chatMap[c.user_id] || 0) + 1;
      const { data: invCodes } = await supabaseAdmin.from("invite_codes").select("code, used_by").eq("status", "used");
      const invMap = {};
      for (const ic of invCodes || []) if (ic.used_by) invMap[ic.used_by] = ic.code;
      const result = users
        .map(u => ({ id: u.id, email: u.email, createdAt: u.created_at, lastSignIn: u.last_sign_in_at, chatCount: chatMap[u.id] || 0, inviteCode: invMap[u.id] || null }))
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      json(res, 200, { users: result });
      return;
    }

    if (url.pathname === "/api/admin/invites" && req.method === "GET") {
      if (!checkAdminToken(req)) { json(res, 401, { error: "未授权" }); return; }
      const { data, error } = await supabaseAdmin.from("invite_codes").select("*").order("created_at", { ascending: false });
      if (error) { json(res, 500, { error: error.message }); return; }
      json(res, 200, { invites: data || [] });
      return;
    }

    if (url.pathname === "/api/admin/invites" && req.method === "POST") {
      if (!checkAdminToken(req)) { json(res, 401, { error: "未授权" }); return; }
      const body = await readBody(req);
      const count = Math.max(1, Math.min(50, parseInt(body.count, 10) || 1));
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const rows = Array.from({ length: count }, () => {
        let s = ""; for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return { code: s, note: body.note || null };
      });
      const created = await createInviteCodes(rows);
      json(res, 200, { codes: created.map(r => r.code) });
      return;
    }

    if (url.pathname === "/api/admin/chats" && req.method === "GET") {
      if (!checkAdminToken(req)) { json(res, 401, { error: "未授权" }); return; }
      const page = Math.max(0, parseInt(url.searchParams.get("page") || "0", 10));
      const userId = url.searchParams.get("userId") || null;
      const issuesOnly = url.searchParams.get("issues") === "1";
      const limit = 30;
      let query = supabaseAdmin
        .from("chat_logs")
        .select("id, session_id, user_id, intent, user_message, reply_preview, ok, degraded, error, latency_ms, created_at")
        .order("created_at", { ascending: false })
        .range(page * limit, page * limit + limit - 1);
      if (userId) query = query.eq("user_id", userId);
      if (issuesOnly) query = query.or("ok.eq.false,degraded.eq.true");
      const { data, error } = await query;
      if (error) { json(res, 500, { error: error.message }); return; }
      // 批量取用户邮箱
      const uids = [...new Set((data || []).map(r => r.user_id).filter(Boolean))];
      const emailMap = {};
      if (uids.length) {
        const { data: authData } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
        for (const u of authData?.users || []) emailMap[u.id] = u.email;
      }
      const rows = (data || []).map(r => ({ ...r, userEmail: emailMap[r.user_id] || null }));
      json(res, 200, { chats: rows, page, hasMore: (data || []).length === limit });
      return;
    }

    const invDelMatch = url.pathname.match(/^\/api\/admin\/invites\/([A-Z0-9]{6,12})$/);
    if (invDelMatch && req.method === "DELETE") {
      if (!checkAdminToken(req)) { json(res, 401, { error: "未授权" }); return; }
      await supabaseAdmin.from("invite_codes").delete().eq("code", invDelMatch[1]).eq("status", "unused");
      json(res, 200, { ok: true });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    // 明确的客户端错误（HttpError）按其状态码回文案；其它异常只回通用文案 + 请求号，细节留在服务端日志
    if (error instanceof HttpError) {
      if (!res.headersSent) json(res, error.status, { error: error.message, ...(error.extra || {}) });
      else res.end();
      return;
    }
    const requestId = randomBytes(4).toString("hex");
    console.error(`[${requestId}] ${req.method} ${url.pathname} 未处理异常:`, error);
    if (!res.headersSent) json(res, 500, { error: "服务器内部错误，请稍后重试", requestId });
    else res.end();
  }
});

// 请求头/整体请求超时（SSE 是响应长、请求短，不受影响）
server.headersTimeout = 65_000;
server.requestTimeout = 120_000;

server.listen(PORT, "127.0.0.1", () => {
  console.log(`QDII Fund Compass v${APP_VERSION} running at http://localhost:${PORT}`);
  // 启动后自检：数据若早于"最近一个定时更新时刻"，后台补刷一次（不阻塞服务启动）
  catchUpRefreshOnBoot();
});

// ----- 进程级兜底：优雅退出 + 未捕获异常 -----
let shuttingDown = false;
function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] 收到 ${signal}，停止接收新连接…`);
  server.close(() => {
    console.log("[shutdown] 在途请求已处理完毕，退出");
    process.exit(exitCode);
  });
  // 兜底：SSE 长连接可能迟迟不结束，最多等 10s
  setTimeout(() => process.exit(exitCode), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] 进程状态不可信，退出交给 PM2 重启:", err);
  shutdown("uncaughtException", 1);
});

let bootRefreshing = false;
async function catchUpRefreshOnBoot() {
  if (bootRefreshing) return;
  bootRefreshing = true;
  let fundsForHot = null;
  try {
    const lastUpdated = await getLastUpdatedAt();
    const expectedSlot = scheduledUpdateBefore(new Date().toISOString());
    const stale = !lastUpdated || (expectedSlot && new Date(lastUpdated).getTime() < expectedSlot.getTime());
    if (!stale) {
      console.log("[启动自检] 数据已是最新，无需补刷");
      try { fundsForHot = await getFundsSnapshot(); } catch {}
      return;
    }
    console.log("[启动自检] 数据已过期，开始后台补刷…");
    const snapshot = await runRefreshOnce();
    const withAi = await attachAiSummaries(snapshot.funds);
    rememberFundsSnapshot(withAi);
    fundsForHot = withAi;
    const fresh = await getLastUpdatedAt();
    const { fetchedAtText } = formatDataUpdateDisplay(fresh);
    console.log(`[启动自检] 补刷完成 ✓ 展示更新时间 ${fetchedAtText}，共 ${snapshot.total} 只`);
  } catch (err) {
    console.error("[启动自检] 补刷失败（不影响服务运行）：", err?.message || err);
  } finally {
    bootRefreshing = false;
    // 后台异步跑热议事件检测，不影响主流程；失败由模块内部静默
    if (fundsForHot?.length) {
      setTimeout(() => { maybeRefreshHotSuggestions(fundsForHot); }, 1500);
    }
  }
}
