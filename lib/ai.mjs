import { card } from "./agent/rules.mjs";

const ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

const SYSTEM_PROMPT = card("card_blurb");

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
  const summary = raw.trim().replace(/^[「『"'"]+|[」』"'"]+$/g, "");
  if (!summary) throw new Error("DashScope 返回为空");
  return {
    summary,
    model: modelName,
    usage: data.usage || null,
  };
}

export async function generateWithRetry(fund, { retries = 2, model, signal } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await generateFundSummary(fund, { model, signal });
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
  }
  throw lastErr;
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
        const delta = chunk?.choices?.[0]?.delta?.content;
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

  return { content: full, model: modelName, usage };
}
