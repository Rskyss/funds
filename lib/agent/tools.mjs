import { getAllFunds, getAllHoldings, getFundDetail as getFundDetailRow, getAiSummary, getNavHistory } from "../store.mjs";
import { supabaseAdmin } from "../supabase.mjs";
import { embedText } from "../embedding.mjs";
import { detectThematicHints, mergeFilterWithHints } from "./thematic.mjs";

let fundsCache = { data: null, at: 0 };
const FUNDS_TTL_MS = 60_000;

async function loadFundsCached() {
  const now = Date.now();
  if (fundsCache.data && now - fundsCache.at < FUNDS_TTL_MS) return fundsCache.data;
  const data = await getAllFunds();
  fundsCache = { data, at: now };
  return data;
}

let holdingsCache = { data: null, at: 0 };
const HOLDINGS_TTL_MS = 300_000;

async function loadHoldingsCached() {
  const now = Date.now();
  if (holdingsCache.data && now - holdingsCache.at < HOLDINGS_TTL_MS) return holdingsCache.data;
  const data = await getAllHoldings();
  holdingsCache = { data, at: now };
  return data;
}

export function invalidateFundsCache() {
  fundsCache = { data: null, at: 0 };
  holdingsCache = { data: null, at: 0 };
}

// 结构化精确匹配：在全库持仓里找股票名/代码包含查询词的基金（兜底 RAG 漏召回）
export async function matchFundsByHolding(stockQuery) {
  const q = String(stockQuery || "").trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/[\s,，、]+/).filter((t) => t.length >= 2);
  if (!terms.length) return [];
  const all = await loadHoldingsCached();
  const matches = [];
  for (const row of all) {
    let best = null;
    for (const h of row.holdings) {
      const name = String(h.stockName || "").toLowerCase();
      const sc = String(h.stockCode || "").toLowerCase();
      if (terms.some((t) => name.includes(t) || (t.length >= 3 && sc.includes(t)))) {
        if (!best || (h.ratio ?? 0) > (best.ratio ?? 0)) {
          best = { stockName: h.stockName, stockCode: h.stockCode, ratio: h.ratio, rank: h.rank };
        }
      }
    }
    if (best) matches.push({ code: row.code, reportDate: row.reportDate, hit: best });
  }
  matches.sort((a, b) => (b.hit.ratio ?? 0) - (a.hit.ratio ?? 0));
  return matches;
}

const SORT_KEYS = {
  score: "score",
  return1y: "return1y",
  return6m: "return6m",
  return3m: "return3m",
  returnYtd: "returnYtd",
  ratingMorningstar: "ratingMorningstar",
  sharpe1y: "sharpe1y",
  aumBillion: "aumBillion",
  discountFee: "discountFee",
};

function matchEnum(fundValue, allowedList) {
  if (!allowedList || !allowedList.length) return true;
  if (!fundValue) return false;
  return allowedList.includes(fundValue);
}

function applyFilter(funds, f) {
  if (!f) return funds;
  return funds.filter((fund) => {
    if (!matchEnum(fund.region, f.region)) return false;
    if (!matchEnum(fund.theme, f.theme)) return false;
    if (!matchEnum(fund.role, f.role)) return false;
    if (!matchEnum(fund.fundType, f.fundType)) return false;
    if (!matchEnum(fund.risk, f.risk)) return false;
    if (f.return1yMin !== null && f.return1yMin !== undefined) {
      if (fund.return1y === null || fund.return1y < f.return1yMin) return false;
    }
    if (f.return3mMin !== null && f.return3mMin !== undefined) {
      if (fund.return3m === null || fund.return3m < f.return3mMin) return false;
    }
    if (f.returnYtdMin !== null && f.returnYtdMin !== undefined) {
      if (fund.returnYtd === null || fund.returnYtd < f.returnYtdMin) return false;
    }
    if (f.discountFeeMax !== null && f.discountFeeMax !== undefined) {
      if (fund.discountFee === null || fund.discountFee > f.discountFeeMax) return false;
    }
    if (f.ageYearsMin !== null && f.ageYearsMin !== undefined) {
      if (fund.ageYears === null || fund.ageYears < f.ageYearsMin) return false;
    }
    if (f.ageYearsMax !== null && f.ageYearsMax !== undefined) {
      if (fund.ageYears === null || fund.ageYears > f.ageYearsMax) return false;
    }
    if (f.ratingMin !== null && f.ratingMin !== undefined) {
      if (fund.ratingMorningstar === null || fund.ratingMorningstar < f.ratingMin) return false;
    }
    if (f.purchaseLimitYuanMin !== null && f.purchaseLimitYuanMin !== undefined) {
      const st = fund.purchaseStatus;
      if (st === "暂停" || st === "封闭" || st === "场内交易") return false;
      if (st === "限购") {
        const limit = fund.purchaseLimitYuan ?? 0;
        if (limit < f.purchaseLimitYuanMin) return false;
      }
      // "开放" 始终通过
    }
    return true;
  });
}

function sortFunds(funds, sortKey, order) {
  const key = SORT_KEYS[sortKey] || "score";
  const dir = order === "asc" ? 1 : -1;
  const naFallback = dir === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  return [...funds].sort((a, b) => {
    const av = a[key] ?? naFallback;
    const bv = b[key] ?? naFallback;
    if (av === bv) return a.code.localeCompare(b.code);
    return (av - bv) * dir;
  });
}

function projectFund(fund) {
  return {
    code: fund.code,
    name: fund.name,
    region: fund.region,
    theme: fund.theme,
    role: fund.role,
    risk: fund.risk,
    fundType: fund.fundType,
    inception: fund.inception || null,
    ageYears: fund.ageYears,
    nav: fund.nav,
    navDate: fund.date || null,
    return1m: fund.return1m,
    return3m: fund.return3m,
    return6m: fund.return6m,
    return1y: fund.return1y,
    returnYtd: fund.returnYtd,
    return3y: fund.return3y,
    discountFee: fund.discountFee,
    score: fund.score,
    scoreLabel: fund.label,
    ratingMorningstar: fund.ratingMorningstar,
    aumBillion: fund.aumBillion,
    sharpe1y: fund.sharpe1y,
    volatility1y: fund.volatility1y,
    maxDrawdown1y: fund.maxDrawdown1y,
    managerNames: fund.managerNames || null,
    purchaseStatus: fund.purchaseStatus || null,
    purchaseLimitYuan: fund.purchaseLimitYuan ?? null,
  };
}

export async function filterFunds(filter) {
  const all = await loadFundsCached();
  const matched = applyFilter(all, filter);
  const sorted = sortFunds(matched, filter?.sort, filter?.order);
  const limited = sorted.slice(0, filter?.limit || 8);
  return {
    total: matched.length,
    returned: limited.length,
    funds: limited.map(projectFund),
  };
}

export async function getFundsByCodes(codes) {
  if (!Array.isArray(codes) || !codes.length) return { funds: [] };
  const all = await loadFundsCached();
  const map = new Map(all.map((f) => [f.code, f]));
  const ordered = codes.map((c) => map.get(c)).filter(Boolean);
  return { funds: ordered.map(projectFund) };
}

export async function getFundContext(code) {
  const [detailRow, aiRow, nav] = await Promise.all([
    getFundDetailRow(code).catch(() => null),
    getAiSummary(code).catch(() => null),
    getNavHistory(code, 90).catch(() => []),
  ]);
  return {
    code,
    goal: detailRow?.goal || null,
    scope: detailRow?.scope || null,
    benchmark: detailRow?.benchmark || null,
    detailUrl: detailRow?.detail_url || `https://fundf10.eastmoney.com/jbgk_${code}.html`,
    aiSummary: aiRow?.summary || null,
    navPoints: Array.isArray(nav) ? nav.length : 0,
  };
}

// 针对"某只基金有没有相关新闻"——用它的重仓股 + 行业标签拼搜索词，
// 而不是拿基金全名去搜（全名在中文网上基本只有它自己的股吧页）。
// 拿不到持仓时返回 null，调用方回退到原始 eventQuery。
async function buildFundNewsQuery(code) {
  if (!code) return null;
  try {
    const all = await loadHoldingsCached();
    const row = all.find((r) => r.code === code);
    const topStocks = (row?.holdings || [])
      .slice()
      .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
      .map((h) => String(h.stockName || "").trim())
      .filter((n) => n && !/^[0-9A-Za-z.\- ]+$/.test(n)) // 去掉纯代码/纯英文票，保留中文票名更利于中文搜索
      .slice(0, 2); // 只取前 2 大重仓，名字太多反而稀释搜索结果
    let themeWords = [];
    const byCode = await getFundsByCodes([code]);
    const f = byCode?.funds?.[0];
    if (f) {
      themeWords = [...(Array.isArray(f.theme) ? f.theme : []), ...(Array.isArray(f.region) ? f.region : [])]
        .filter((t) => t && !["底仓候选", "综合配置"].includes(t))
        .slice(0, 2);
    }
    const parts = [...topStocks, ...themeWords].filter(Boolean);
    if (!parts.length) return null;
    return `${parts.join(" ")} 最新新闻 行情走势`;
  } catch {
    return null;
  }
}

// 联网搜索结果去重：同一网页只留一条，同一域名最多 2 条，最终最多 5 条。
// 解决 Tavily 对某只基金常把同一个东方财富股吧页拆成多条返回的问题。
function dedupeSources(list, maxPerDomain = 2, maxTotal = 5) {
  const seenUrl = new Set();
  const domainCount = new Map();
  const out = [];
  const sorted = list.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const r of sorted) {
    if (!r.url) continue;
    let key = r.url;
    let host = "";
    try {
      const u = new URL(r.url);
      key = (u.hostname + u.pathname).replace(/\/+$/, "").toLowerCase();
      host = u.hostname.replace(/^www\./, "").toLowerCase();
    } catch { /* 非法 URL 用原串当 key */ }
    if (seenUrl.has(key)) continue;
    const c = domainCount.get(host) || 0;
    if (host && c >= maxPerDomain) continue;
    seenUrl.add(key);
    domainCount.set(host, c + 1);
    out.push(r);
    if (out.length >= maxTotal) break;
  }
  return out;
}

export async function webSearchEvent(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return { degraded: true, reason: "TAVILY_API_KEY 未配置", results: [], answer: null };
  if (!query || !query.trim()) return { degraded: true, reason: "empty query", results: [], answer: null };

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: query.trim(),
        topic: "news", // finance 主题只返回报价/标签页；news 才返回真新闻文章
        days: 30, // 偏向最近一个月，匹配"最新/最近"语义
        search_depth: "basic",
        max_results: 8,
        include_answer: true,
        chunks_per_source: 2,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { degraded: true, reason: `Tavily ${res.status}: ${text.slice(0, 200)}`, results: [], answer: null };
    }
    const data = await res.json();
    const results = dedupeSources(
      Array.isArray(data?.results)
        ? data.results.map((r) => ({
            title: r.title || "",
            url: r.url || "",
            snippet: (r.content || "").slice(0, 360),
            publishedAt: r.published_date || null,
            score: r.score ?? null,
          }))
        : [],
    );
    return {
      degraded: false,
      answer: data?.answer || null,
      query: query.trim(),
      results,
    };
  } catch (err) {
    return { degraded: true, reason: `Tavily error: ${err.message}`, results: [], answer: null };
  }
}

export async function conceptKnowledge(query) {
  return { query: query || "", note: "MVP 概念题不依赖外部知识库，由合成层用通用金融常识回答。" };
}

export async function retrieveDocs({ query, codes, topK = 6 } = {}) {
  if (!query || !query.trim()) return { hits: [], degraded: true, reason: "empty query" };
  let embedding;
  try {
    embedding = await embedText(query);
  } catch (err) {
    return { hits: [], degraded: true, reason: `embed failed: ${err.message}` };
  }
  if (!embedding) return { hits: [], degraded: true, reason: "no embedding" };

  const codeFilter = Array.isArray(codes) && codes.length ? codes : null;
  const { data, error } = await supabaseAdmin.rpc("search_fund_doc_chunks", {
    query_embedding: embedding,
    match_count: Math.max(1, Math.min(20, topK)),
    code_filter: codeFilter,
  });
  if (error) return { hits: [], degraded: true, reason: error.message };
  const hits = (data || []).map((r) => ({
    code: r.code,
    source: r.source,
    chunkIndex: r.chunk_index,
    content: r.content,
    similarity: typeof r.similarity === "number" ? Number(r.similarity.toFixed(3)) : null,
  }));
  return { hits, degraded: false, query };
}

export async function runPlan(plan) {
  const trace = [];
  const out = { plan, funds: [], detail: null, sources: [], event: null, concept: null };

  async function recorded(name, fn) {
    const start = Date.now();
    try {
      const result = await fn();
      trace.push({ name, ok: true, ms: Date.now() - start });
      return result;
    } catch (err) {
      trace.push({ name, ok: false, ms: Date.now() - start, error: err.message });
      return null;
    }
  }

  if (plan.holdingQuery) {
    const hq = plan.holdingQuery;
    const limit = Math.max(1, Math.min(12, plan.filter?.limit || 8));
    const result = await recorded("matchFundsByHolding", async () => {
      const [structured, docRes] = await Promise.all([
        matchFundsByHolding(hq),
        retrieveDocs({ query: hq, topK: 12 }).catch(() => ({ hits: [] })),
      ]);
      const ragHoldingHits = (docRes.hits || []).filter((h) => h.source === "holdings");
      const orderedCodes = [];
      const seen = new Set();
      for (const m of structured) {
        if (!seen.has(m.code)) { orderedCodes.push(m.code); seen.add(m.code); }
      }
      for (const h of ragHoldingHits) {
        if (h.code && !seen.has(h.code)) { orderedCodes.push(h.code); seen.add(h.code); }
      }
      let codes = orderedCodes;
      if (plan.codes?.length) codes = codes.filter((c) => plan.codes.includes(c));
      codes = codes.slice(0, limit);
      const byCode = await getFundsByCodes(codes);
      const sMap = new Map(structured.map((m) => [m.code, m]));
      const holdingsContext = byCode.funds.map((f) => {
        const m = sMap.get(f.code);
        return {
          code: f.code,
          reportDate: m?.reportDate || null,
          matched: m ? `${m.hit.stockName}${m.hit.stockCode ? `（${m.hit.stockCode}）` : ""} ${m.hit.ratio ?? "?"}%` : null,
        };
      });
      return { funds: byCode.funds, ragHits: ragHoldingHits, holdingsContext, structuredCount: structured.length };
    });
    if (result?.funds?.length) {
      out.funds = result.funds;
      out.ragHits = result.ragHits || [];
      out.holdingsContext = result.holdingsContext || [];
      out.filterTotal = result.structuredCount ?? result.funds.length;
      out._holdingQuery = hq;
    } else {
      out.holdingsNoMatch = hq;
    }
  }

  // 防御：规划层把"针对某只已点名基金的咨询"误判成 filter 时，filter 条件会全空。
  // 此时若已有指定 codes，只回该基金，绝不返回按评分排的通用榜单（避免答案底部冒出一堆无关基金）。
  const filterHasCriteria = (f) =>
    !!f &&
    (f.region?.length || f.theme?.length || f.role?.length || f.fundType?.length || f.risk?.length ||
      f.return1yMin != null || f.return3mMin != null || f.returnYtdMin != null ||
      f.discountFeeMax != null || f.ageYearsMin != null || f.ageYearsMax != null ||
      f.ratingMin != null || f.purchaseLimitYuanMin != null);

  if (
    (plan.intent === "filter" || plan.intent === "mixed") &&
    !plan.holdingQuery &&
    plan.codes.length &&
    !filterHasCriteria(plan.filter) &&
    !detectThematicHints(plan._userMessage || "")
  ) {
    const r = await recorded("getFundsByCodes(named)", () => getFundsByCodes(plan.codes));
    if (r) out.funds = r.funds;
  } else if ((plan.intent === "filter" || plan.intent === "mixed") && !plan.holdingQuery) {
    const userMsg = plan._userMessage || "";
    const hints = detectThematicHints(userMsg);
    const mergedFilter = mergeFilterWithHints(plan.filter, hints);
    const wantsFunds = /找|推荐|筛|哪些|几只|列出|关注.*基金|基金/.test(userMsg);

    if (hints && wantsFunds) {
      const rag = await recorded("retrieveDocs(thematic)", async () => {
        const docRes = await retrieveDocs({ query: hints.ragQuery || userMsg, topK: 10 });
        if (!docRes.hits?.length) return { funds: [], ragHits: [] };
        const codes = Array.from(new Set(docRes.hits.map((h) => h.code).filter(Boolean))).slice(0, 10);
        const byCode = await getFundsByCodes(codes);
        return { funds: byCode.funds, ragHits: docRes.hits };
      });
      if (rag?.funds?.length) {
        out.funds = rag.funds;
        out.ragHits = rag.ragHits || [];
        out.filterTotal = rag.funds.length;
        out._thematic = true;
      }
    }

    if (!out.funds.length) {
      const r = await recorded("filterFunds", () => filterFunds(mergedFilter));
      if (r) {
        out.funds = r.funds;
        out.filterTotal = r?.total ?? 0;
      }
    } else if (hints?.theme?.length || hints?.region?.length) {
      const r = await recorded("filterFunds(refine)", () => filterFunds(mergedFilter));
      if (r?.funds?.length) {
        const seen = new Set(out.funds.map((f) => f.code));
        for (const f of r.funds) {
          if (!seen.has(f.code) && out.funds.length < (mergedFilter.limit || 8)) {
            out.funds.push(f);
            seen.add(f.code);
          }
        }
      }
    }
  }

  if (plan.intent === "compare" && plan.codes.length) {
    const r = await recorded("getFundsByCodes", () => getFundsByCodes(plan.codes));
    if (r) out.funds = r.funds;
  }

  if ((plan.intent === "compare" || plan.intent === "mixed") && plan.needF10 && out.funds.length) {
    const ctxs = await Promise.all(out.funds.slice(0, 6).map((f) => recorded(`getFundContext(${f.code})`, () => getFundContext(f.code))));
    out.fundContexts = ctxs.filter(Boolean);
  }

  // RAG 只在"涉及具体基金且需要 F10 原文"时启用；概念题不带 RAG（避免被无关基金代码污染）
  if (plan.needF10 && (out.funds.length || plan.codes.length)) {
    const ragQuery = plan._userMessage || plan.conceptQuery || plan.eventQuery || "";
    const ragCodes = out.funds.length ? out.funds.slice(0, 6).map((f) => f.code) : plan.codes.slice(0, 6);
    if (ragQuery && ragCodes.length) {
      const r = await recorded("retrieveDocs", () => retrieveDocs({ query: ragQuery, codes: ragCodes, topK: 6 }));
      if (r) out.ragHits = r.hits || [];
    }
  }

  if (plan.intent === "concept" || (plan.intent === "mixed" && plan.conceptQuery)) {
    const r = await recorded("conceptKnowledge", () => conceptKnowledge(plan.conceptQuery));
    if (r) out.concept = r;
    // 针对某只已点名基金的咨询（如"这只怎么买"）：带上该基金真实数据，让回答具体（申购费/限购等）
    if (!out.funds.length && plan.codes.length) {
      const byCode = await recorded("getFundsByCodes(concept)", () => getFundsByCodes(plan.codes));
      if (byCode?.funds?.length) out.funds = byCode.funds;
    }
  }

  if (plan.intent === "event" || (plan.intent === "mixed" && plan.eventQuery)) {
    let eq = plan.eventQuery;
    if (Array.isArray(plan.codes) && plan.codes.length) {
      const better = await buildFundNewsQuery(plan.codes[0]);
      if (better) eq = better;
    }
    const r = await recorded("webSearchEvent", () => webSearchEvent(eq));
    if (r) {
      out.event = r;
      if (Array.isArray(r.results)) out.sources = r.results;
    }
    // 事件题也加载基金库，让合成层能点名具体基金
    if (!out.funds.length) {
      const msg = plan._userMessage || plan.eventQuery || "";
      const hints = detectThematicHints(msg);
      const baseFilter = hints
        ? { region: hints.region || [], theme: hints.theme || [], sort: "score", order: "desc", limit: 8 }
        : { sort: "score", order: "desc", limit: 8 };
      const f = await recorded("filterFunds(event-ctx)", () => filterFunds(baseFilter));
      if (f?.funds?.length) out.funds = f.funds;
    }
  }

  out.trace = trace;
  return out;
}
