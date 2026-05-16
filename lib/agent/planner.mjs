import { chatCompletion } from "../ai.mjs";
import { PLANNER_SYSTEM, PLANNER_FALLBACK } from "./prompts.mjs";

function normalizeFilter(raw) {
  if (!raw || typeof raw !== "object") return null;
  const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);
  const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  return {
    region: arr(raw.region),
    theme: arr(raw.theme),
    role: arr(raw.role),
    fundType: arr(raw.fundType),
    risk: arr(raw.risk),
    return1yMin: num(raw.return1yMin),
    return3mMin: num(raw.return3mMin),
    returnYtdMin: num(raw.returnYtdMin),
    discountFeeMax: num(raw.discountFeeMax),
    ageYearsMin: num(raw.ageYearsMin),
    ageYearsMax: num(raw.ageYearsMax),
    ratingMin: num(raw.ratingMin),
    purchaseLimitYuanMin: num(raw.purchaseLimitYuanMin),
    sort: typeof raw.sort === "string" && raw.sort ? raw.sort : "score",
    order: raw.order === "asc" ? "asc" : "desc",
    limit: Math.max(1, Math.min(20, Number.isFinite(Number(raw.limit)) ? Number(raw.limit) : 8)),
  };
}

function normalizeCodes(codes) {
  if (!Array.isArray(codes)) return [];
  return Array.from(new Set(codes.map((c) => String(c).trim()).filter((c) => /^\d{6}$/.test(c))));
}

function trimHistory(history, maxTurns = 6) {
  if (!Array.isArray(history)) return [];
  return history.slice(-maxTurns * 2);
}

export async function plan({ user, history = [], lastCodes = [], lastFilters = null, profile = null } = {}) {
  if (!user || typeof user !== "string" || !user.trim()) {
    return { ...PLANNER_FALLBACK, conceptQuery: "", _reason: "empty input" };
  }

  const contextLines = [];
  if (lastCodes.length) contextLines.push(`lastCodes=${JSON.stringify(lastCodes)}`);
  if (lastFilters) contextLines.push(`lastFilters=${JSON.stringify(lastFilters)}`);
  if (profile) {
    const bits = [];
    if (profile.risk_pref) bits.push(`风险偏好=${profile.risk_pref}`);
    if (profile.horizon) bits.push(`持有期=${profile.horizon}`);
    if (profile.regions && profile.regions.length) bits.push(`已配区域=${profile.regions.join(",")}`);
    if (profile.amount_band) bits.push(`金额=${profile.amount_band}`);
    if (bits.length) contextLines.push(`userProfile(软约束，仅当用户没有显式条件时参考)=${bits.join("; ")}`);
  }
  const contextBlock = contextLines.length ? `# 上下文\n${contextLines.join("\n")}\n\n` : "";

  const turns = trimHistory(history);
  const messages = [
    { role: "system", content: PLANNER_SYSTEM },
    ...turns.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: `${contextBlock}# 本轮用户消息\n${user}` },
  ];

  const fastModel = process.env.DASHSCOPE_MODEL_FAST || "qwen-turbo";
  try {
    const result = await chatCompletion({
      model: fastModel,
      messages,
      json: true,
      temperature: 0.1,
      topP: 0.7,
      maxTokens: 600,
    });
    const j = result.json || {};
    const intent = ["filter", "compare", "concept", "event", "mixed"].includes(j.intent) ? j.intent : "concept";
    const plan = {
      intent,
      filter: normalizeFilter(j.filter),
      codes: normalizeCodes(j.codes),
      conceptQuery: typeof j.conceptQuery === "string" ? j.conceptQuery.trim() : null,
      eventQuery: typeof j.eventQuery === "string" ? j.eventQuery.trim() : null,
      holdingQuery: typeof j.holdingQuery === "string" && j.holdingQuery.trim() ? j.holdingQuery.trim() : null,
      needF10: Boolean(j.needF10),
      rationale: typeof j.rationale === "string" ? j.rationale : "",
      model: result.model,
      _userMessage: user,
    };

    if (plan.intent === "compare" && !plan.codes.length && lastCodes.length) {
      plan.codes = lastCodes.slice(0, 6);
    }
    if (plan.intent === "filter" && !plan.filter) plan.filter = normalizeFilter({});
    if (plan.intent === "concept" && !plan.conceptQuery) plan.conceptQuery = user.trim();
    if (plan.intent === "event" && !plan.eventQuery) plan.eventQuery = user.trim();

    return plan;
  } catch (err) {
    return {
      ...PLANNER_FALLBACK,
      conceptQuery: user.trim(),
      _reason: `planner failed: ${err.message}`,
    };
  }
}
