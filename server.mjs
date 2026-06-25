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
import { signInWithEmailPassword, translateAuthError } from "./lib/authSignIn.mjs";
import { plan as planAgent } from "./lib/agent/planner.mjs";
import { runPlan } from "./lib/agent/tools.mjs";
import { synthesize, synthesizeStream, pickCards } from "./lib/agent/synth.mjs";
import { loadSession, saveSession, appendTurn, updateLast, randomUUID } from "./lib/agent/session.mjs";
import { logChatTurn, rateLimit } from "./lib/agent/metrics.mjs";
import { suggestionTemplates } from "./lib/agent/rules.mjs";
import { getActiveHotSuggestions, maybeRefreshHotSuggestions } from "./lib/agent/hotTopics.mjs";
import { formatDataUpdateDisplay, scheduledUpdateBefore } from "./lib/dataSchedule.mjs";

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

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        req.destroy();
        reject(new Error("请求体过大"));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

async function refreshFunds() {
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
    const metrics = await fetchProfilesAndMetricsConcurrently(codes, {
      concurrency: 10,
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
  if (refresh) {
    const snapshot = await refreshFunds();
    const withAi = await attachAiSummaries(snapshot.funds);
    rememberFundsSnapshot(withAi);
    const lastUpdated = await getLastUpdatedAt();
    const { fetchedAt, fetchedAtText } = formatDataUpdateDisplay(lastUpdated);
    return { ...snapshot, funds: withAi, fetchedAt, fetchedAtText };
  }
  const funds = await getAllFunds();
  if (funds.length) {
    applyPercentileScores(funds);
    const [withAi, lastUpdated] = await Promise.all([attachAiSummaries(funds), getLastUpdatedAt()]);
    rememberFundsSnapshot(withAi);
    const { fetchedAt, fetchedAtText } = formatDataUpdateDisplay(lastUpdated);
    return {
      fetchedAt,
      fetchedAtText,
      total: withAi.length,
      funds: withAi,
    };
  }
  const snapshot = await refreshFunds();
  const withAi = await attachAiSummaries(snapshot.funds);
  rememberFundsSnapshot(withAi);
  const lastUpdated = await getLastUpdatedAt();
  const { fetchedAt, fetchedAtText } = formatDataUpdateDisplay(lastUpdated);
  return { ...snapshot, funds: withAi, fetchedAt, fetchedAtText };
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
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const ext = path.extname(filePath);
    const body = await readFile(filePath);
    // 带内容哈希的构建产物可永久缓存；HTML 入口必须每次校验，否则刷新拿不到新代码
    const isHashedAsset = safePath.startsWith("/assets/");
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
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
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
      const refresh = url.searchParams.get("refresh") === "1";
      const snapshot = await loadOrRefresh(refresh);
      json(res, 200, snapshot);
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
      const profile = await fetchManagerProfile(managerMatch[1]);
      json(res, 200, profile);
      return;
    }

    const regenMatch = url.pathname.match(/^\/api\/fund\/(\d{6})\/ai-summary$/);
    if (regenMatch && req.method === "POST") {
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
      if (error) {
        json(res, 500, { error: error.message });
        return;
      }
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
      json(res, 200, {
        profile: {
          ...profile,
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
      const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").toString().split(",")[0].trim();
      const session = await loadSession(body.sessionId);
      const sessionId = session.sessionId || randomUUID();
      const rl = rateLimit(`chat:${sessionId}:${ip}`);
      if (!rl.allowed) {
        const retrySec = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
        res.setHeader("Retry-After", String(retrySec));
        json(res, 429, { error: `请求太频繁，${retrySec}s 后再试`, limit: rl.limit });
        return;
      }
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
          send("error", { message: err.message });
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
      const body = await readBody(req);
      try {
        const session = await signInWithEmailPassword(body.email, body.password);
        json(res, 200, { session });
      } catch (err) {
        json(res, err.code || 401, { error: err.message || translateAuthError("Invalid login credentials") });
      }
      return;
    }

    if (url.pathname === "/api/auth/signup" && req.method === "POST") {
      const body = await readBody(req);
      const email = (body.email || "").trim().toLowerCase();
      const password = body.password || "";
      const inviteCode = (body.inviteCode || "").trim();
      if (!email || !email.includes("@")) {
        json(res, 400, { error: "邮箱格式不正确" });
        return;
      }
      if (password.length < 6) {
        json(res, 400, { error: "密码至少 6 位" });
        return;
      }
      if (!inviteCode) {
        json(res, 400, { error: "请输入邀请码" });
        return;
      }
      const invite = await findInviteCode(inviteCode);
      if (!invite) {
        json(res, 400, { error: "邀请码无效" });
        return;
      }
      if (invite.status !== "unused") {
        json(res, 400, { error: "邀请码已被使用" });
        return;
      }
      if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
        json(res, 400, { error: "邀请码已过期" });
        return;
      }
      const claimed = await claimInviteCode(inviteCode);
      if (!claimed) {
        json(res, 400, { error: "邀请码已被使用" });
        return;
      }
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error) {
        await releaseInviteCode(inviteCode);
        const msg = error.message || "注册失败";
        const code = msg.includes("already") || msg.includes("registered") ? 409 : 400;
        json(res, code, { error: msg.includes("already") ? "该邮箱已注册" : msg });
        return;
      }
      const newUserId = data?.user?.id || null;
      if (newUserId) await attachInviteCodeUser(inviteCode, newUserId);
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

    // ===== Admin API =====
    if (url.pathname === "/api/admin/login" && req.method === "POST") {
      const body = await readBody(req);
      const pw = process.env.ADMIN_PASSWORD;
      if (!pw) { json(res, 503, { error: "ADMIN_PASSWORD 未配置" }); return; }
      if (!body.password || body.password !== pw) { json(res, 401, { error: "密码错误" }); return; }
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
      const [usersRes, invitesRes, chatsRes] = await Promise.all([
        supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
        supabaseAdmin.from("invite_codes").select("status"),
        supabaseAdmin.from("chat_logs").select("id", { count: "exact", head: true }),
      ]);
      const invites = invitesRes.data || [];
      json(res, 200, {
        totalUsers: usersRes.data?.users?.length || 0,
        unusedInvites: invites.filter(i => i.status === "unused").length,
        usedInvites: invites.filter(i => i.status === "used").length,
        totalChats: chatsRes.count || 0,
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
      const limit = 30;
      let query = supabaseAdmin
        .from("chat_logs")
        .select("id, session_id, user_id, intent, user_message, reply_preview, ok, degraded, error, latency_ms, created_at")
        .order("created_at", { ascending: false })
        .range(page * limit, page * limit + limit - 1);
      if (userId) query = query.eq("user_id", userId);
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
    console.error(error);
    json(res, 500, { error: error.message || "Unknown error" });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`QDII Fund Compass running at http://localhost:${PORT}`);
  // 启动后自检：数据若早于"最近一个定时更新时刻"，后台补刷一次（不阻塞服务启动）
  catchUpRefreshOnBoot();
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
    const snapshot = await refreshFunds();
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
