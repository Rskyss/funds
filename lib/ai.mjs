import { card } from "./agent/rules.mjs";

// 接口地址（OpenAI 兼容协议）。默认百炼官方地址；若 key 来自其它网关/中转平台，
// 在 .env 配 DASHSCOPE_BASE_URL 指向该平台的 Base URL 即可（不要带末尾斜杠）。
const BASE_URL = (process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/+$/, "");
const ENDPOINT = `${BASE_URL}/chat/completions`;

const SYSTEM_PROMPT = card("card_blurb");
const SYSTEM_PROMPT_DETAIL = card("detail_blurb");

// ===== 模型链与自动降级 =====
// 全站 AI 调用共用这一条模型链：从上到下按顺序排，任一模型免费额度用完 / 过期 / 报错，
// 就自动顺位切到下一个，直到有一个能用。改模型只改 .env 的 DASHSCOPE_CHAT_MODELS。
const DEFAULT_CHAT_MODELS = [
  "qwen3.7-plus",
  "qwen-plus-2025-07-28",
  "qwen3-max",
  "qwen3.5-plus-2026-02-15",
];

export function modelChain() {
  const raw = String(process.env.DASHSCOPE_CHAT_MODELS || "").trim();
  if (raw) {
    const list = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (list.length) return [...new Set(list)];
  }
  return DEFAULT_CHAT_MODELS;
}

// 平台返回的"免费额度用完 / 过期"信号（403 AllocationQuota.FreeTierOnly、欠费、配额不足等）。
export function isQuotaExhausted(err) {
  return /AllocationQuota|FreeTier|Arrearage|insufficient[_\s-]?quota/i.test(String(err?.message || ""));
}

// 按模型链顺序跑 run(model)，任一模型报错就切下一个，全部失败才抛错。
export async function withModelFallback(run, { models, label = "ai" } = {}) {
  const chain = Array.isArray(models) && models.length ? models : modelChain();
  let lastErr = null;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    try {
      return await run(model, i);
    } catch (err) {
      if (err?.name === "AbortError") throw err;
      lastErr = err;
      console.warn(
        `[${label}] 模型 ${model} 失败（${isQuotaExhausted(err) ? "免费额度用完/过期" : "其他错误"}）` +
          (i < chain.length - 1 ? `，切到下一个：${chain[i + 1]}` : "，已无更多备用") +
          `：${err.message}`
      );
    }
  }
  throw lastErr;
}

function cleanFreeText(raw) {
  let cleaned = String(raw || "").trim();
  cleaned = cleaned.replace(/[（(]\s*\d+\s*字\s*[)）]\s*$/g, "").trim();
  const headQuote = /^[“”‘’「『"']+/;
  const tailQuote = /[“”‘’」』"']+$/;
  for (let i = 0; i < 3; i++) {
    const before = cleaned;
    cleaned = cleaned.replace(headQuote, "").replace(tailQuote, "").trim();
    if (cleaned === before) break;
  }
  return cleaned;
}

function fmtPct(v) {
  return v === null || v === undefined ? "暂无" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`;
}

// 开头角度轮换：每只基金都是独立生成、互相不知道写过啥，
// 所以靠按代码取模分配一个固定的"开头方式"，强制跨基金错开，避免一窝蜂同一句开头。
const OPENING_ANGLES = [
  "用最该当心的那个风险开头，先泼盆冷水再说别的",
  "从「什么样的人适合拿它」切入，别先讲投什么",
  "用一个生活化的比喻起头（像点外卖、坐过山车这种），别直白报数据",
  "从它具体重仓了什么/投向哪切入，落到具体公司或板块",
  "用一个反问句开头，把用户最关心的疑虑先抛出来",
  "从它最突出的一个亮点切入（费率、规模、评级、经理，挑一个），别从收益说起",
  "先给一句带态度的大白话总评定调，再展开",
  "从它和同类的差别切入，点出它特别在哪",
];

function pickAngle(code) {
  const s = String(code || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return OPENING_ANGLES[h % OPENING_ANGLES.length];
}

function buildUserPrompt(fund) {
  const lines = [
    `基金：${fund.name}（${fund.code}）`,
    `分类：${fund.region} · ${fund.theme} · ${fund.fundType} · ${fund.role} · ${fund.risk}风险`,
    `成立：${fund.inception || "未知"}（${fund.ageYears ?? "?"} 年）`,
    `近1月 ${fmtPct(fund.return1m)}，近3月 ${fmtPct(fund.return3m)}，近1年 ${fmtPct(fund.return1y)}，今年以来 ${fmtPct(fund.returnYtd)}`,
  ];
  if (fund.discountFee !== null && fund.discountFee !== undefined) lines.push(`申购费打折后 ${fund.discountFee}%`);
  if (fund.score) lines.push(`本工具综合评分 ${fund.score}/100（${fund.label}）`);
  lines.push("");
  lines.push(`【本条开头方式（必须遵守）】${pickAngle(fund.code)}。`);
  lines.push("绝对不要用「这基金最近涨得有点猛」「主投」这类开头，每条都要不一样。");
  return lines.join("\n");
}

export async function generateFundSummary(fund, { model, signal } = {}) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const modelName = model || process.env.DASHSCOPE_MODEL || "qwen-plus";
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY 未配置");

  const body = {
    model: modelName,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(fund) },
    ],
    temperature: 0.95,
    max_tokens: 220,
    top_p: 0.92,
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DashScope ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("DashScope 未返回内容");
  const summary = cleanFreeText(raw);
  if (!summary) throw new Error("DashScope 返回为空");
  return {
    summary,
    model: modelName,
    usage: data.usage || null,
  };
}

export async function generateWithRetry(fund, { model, signal } = {}) {
  const models = model ? [model] : modelChain();
  return withModelFallback((m) => generateFundSummary(fund, { model: m, signal }), {
    models,
    label: "summary",
  });
}

function buildDetailUserPrompt(fund, cardSummary) {
  const lines = [
    `基金：${fund.name}（${fund.code}）`,
    `分类：${fund.region} · ${fund.theme} · ${fund.fundType} · ${fund.role} · ${fund.risk}风险`,
    `成立：${fund.inception || "未知"}（${fund.ageYears ?? "?"} 年）`,
    `近1月 ${fmtPct(fund.return1m)}，近3月 ${fmtPct(fund.return3m)}，近1年 ${fmtPct(fund.return1y)}，今年以来 ${fmtPct(fund.returnYtd)}`,
  ];
  if (typeof fund.sharpe === "number") lines.push(`夏普 ${fund.sharpe.toFixed(2)}，最大回撤 ${fmtPct(fund.drawdown)}`);
  if (fund.discountFee !== null && fund.discountFee !== undefined) lines.push(`申购费打折后 ${fund.discountFee}%`);
  if (fund.score) lines.push(`本工具综合评分 ${fund.score}/100（${fund.label}）`);
  if (cardSummary) {
    lines.push("");
    lines.push(`【卡片上已经写过的那一句话（不要重复同一句，要展开补足）】`);
    lines.push(cardSummary);
  }
  lines.push("");
  lines.push(`请输出 250-350 字、分 3-4 个自然段（用空行分段）的详情扩展点评。`);
  return lines.join("\n");
}

export async function generateFundDetailSummary(fund, { model, cardSummary, signal } = {}) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const modelName = model || process.env.DASHSCOPE_MODEL_STRONG || process.env.DASHSCOPE_MODEL || "qwen-plus";
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY 未配置");

  const body = {
    model: modelName,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_DETAIL },
      { role: "user", content: buildDetailUserPrompt(fund, cardSummary) },
    ],
    temperature: 0.85,
    max_tokens: 900,
    top_p: 0.9,
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DashScope ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error("DashScope 未返回内容");
  const detail = cleanFreeText(raw);
  if (!detail) throw new Error("DashScope 返回为空");
  return {
    detail,
    model: modelName,
    usage: data.usage || null,
  };
}

export async function generateDetailWithRetry(fund, { model, cardSummary, signal } = {}) {
  const models = model ? [model] : modelChain();
  return withModelFallback((m) => generateFundDetailSummary(fund, { model: m, cardSummary, signal }), {
    models,
    label: "detail",
  });
}

export async function chatCompletion({
  model,
  messages,
  temperature = 0.4,
  topP = 0.8,
  maxTokens = 1024,
  json = false,
  enableThinking = false,
  thinkingBudget = null,
  signal,
} = {}) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY 未配置");
  if (!Array.isArray(messages) || !messages.length) throw new Error("messages 不能为空");
  const modelName = model || process.env.DASHSCOPE_MODEL || "qwen-plus";

  const body = {
    model: modelName,
    messages,
    temperature,
    top_p: topP,
    max_tokens: maxTokens,
  };
  if (json) body.response_format = { type: "json_object" };
  if (enableThinking) {
    body.enable_thinking = true;
    if (Number.isFinite(Number(thinkingBudget)) && Number(thinkingBudget) > 0) {
      body.thinking_budget = Number(thinkingBudget);
    }
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DashScope ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) throw new Error("DashScope 未返回内容");

  let parsed = null;
  if (json) {
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new Error(`DashScope 返回不是合法 JSON: ${err.message}; head=${cleaned.slice(0, 120)}`);
    }
  }

  return {
    content: raw,
    json: parsed,
    model: modelName,
    usage: data.usage || null,
    finish: data?.choices?.[0]?.finish_reason || null,
  };
}

export async function chatCompletionWithRetry(options = {}, { retries = 2 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await chatCompletion(options);
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function chatCompletionStream({
  model,
  messages,
  temperature = 0.4,
  topP = 0.8,
  maxTokens = 1024,
  enableThinking = false,
  thinkingBudget = null,
  signal,
  onDelta,
  onReasoningDelta,
} = {}) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY 未配置");
  if (!Array.isArray(messages) || !messages.length) throw new Error("messages 不能为空");
  const modelName = model || process.env.DASHSCOPE_MODEL || "qwen-plus";

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: modelName,
      messages,
      temperature,
      top_p: topP,
      max_tokens: maxTokens,
      stream: true,
      ...(enableThinking
        ? {
            enable_thinking: true,
            ...(Number.isFinite(Number(thinkingBudget)) && Number(thinkingBudget) > 0
              ? { thinking_budget: Number(thinkingBudget) }
              : {}),
          }
        : {}),
    }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DashScope ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.body) throw new Error("DashScope 未返回流");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  let reasoningFull = "";
  let usage = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || !line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        const deltaObj = chunk?.choices?.[0]?.delta || {};
        const reasoningDelta = deltaObj.reasoning_content;
        if (typeof reasoningDelta === "string" && reasoningDelta) {
          reasoningFull += reasoningDelta;
          if (typeof onReasoningDelta === "function") onReasoningDelta(reasoningDelta, reasoningFull);
        }
        const delta = deltaObj.content;
        if (typeof delta === "string" && delta) {
          full += delta;
          if (typeof onDelta === "function") onDelta(delta, full);
        }
        if (chunk?.usage) usage = chunk.usage;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }

  return { content: full, reasoning: reasoningFull, model: modelName, usage };
}
