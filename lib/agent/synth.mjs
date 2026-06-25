import { chatCompletion, chatCompletionStream, modelChain, isQuotaExhausted } from "../ai.mjs";
import { SYNTH_SYSTEM, buildPersonaDirective } from "./prompts.mjs";
import { mergeShareClassCards } from "./shareClass.mjs";

function trimText(s, max = 400) {
  if (!s) return "";
  const t = String(s).trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

function fundLine(f) {
  const pct = (v) => (v === null || v === undefined ? "?" : `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`);
  const parts = [
    `${f.code} ${f.name}`,
    `${f.region || "?"}·${f.theme || "?"}·${f.role || "?"}`,
    `近3月 ${pct(f.return3m)} 近1年 ${pct(f.return1y)} 今年以来 ${pct(f.returnYtd)}`,
    `观察分 ${f.score ?? "?"}/${f.scoreLabel || "?"}`,
  ];
  if (f.discountFee !== null && f.discountFee !== undefined) parts.push(`申购费打折后 ${f.discountFee}%`);
  if (f.ratingMorningstar) parts.push(`晨星 ${f.ratingMorningstar}星`);
  if (f.aumBillion !== null && f.aumBillion !== undefined) parts.push(`规模 ${f.aumBillion}亿`);
  if (f.sharpe1y !== null && f.sharpe1y !== undefined) parts.push(`夏普 ${f.sharpe1y}`);
  if (f.maxDrawdown1y !== null && f.maxDrawdown1y !== undefined) parts.push(`近1年最大回撤 ${f.maxDrawdown1y}%`);
  return "・" + parts.join(" | ");
}

function buildToolContext(state) {
  const blocks = [];
  if (state.funds && state.funds.length) {
    blocks.push(`# 候选基金（${state.funds.length}）\n` + state.funds.map(fundLine).join("\n"));
  }
  if (state.fundContexts && state.fundContexts.length) {
    const lines = state.fundContexts.map((c) => {
      const bits = [`code=${c.code}`];
      if (c.goal) bits.push(`目标:${trimText(c.goal, 160)}`);
      if (c.scope) bits.push(`范围:${trimText(c.scope, 220)}`);
      if (c.benchmark) bits.push(`基准:${trimText(c.benchmark, 140)}`);
      if (c.aiSummary) bits.push(`点评:${trimText(c.aiSummary, 120)}`);
      return "・" + bits.join("\n  ");
    });
    blocks.push(`# F10 资料 / AI 点评\n${lines.join("\n")}`);
  }
  if (state.holdingsContext && state.holdingsContext.length) {
    const lines = state.holdingsContext.map((c) => {
      const date = c.reportDate ? `（持仓截至 ${c.reportDate}）` : "（持仓截止日期未知）";
      const m = c.matched ? `命中持仓：${c.matched}` : "（该股未在前十大，或为语义召回）";
      return `・${c.code} ${date} ${m}`;
    });
    blocks.push(
      `# 持仓精确匹配结果（按"${state._holdingQuery || state.plan?.holdingQuery || ""}"在真实持仓中检索）\n` +
        `这些基金的前十大重仓股里确实出现了相关个股。引用时必须带上各自的"持仓截至"日期；只能说前十大重仓，不要外推全部持仓。\n` +
        lines.join("\n")
    );
  }
  if (state.holdingsNoMatch) {
    blocks.push(
      `# 持仓精确匹配结果\n在全库 502 只有持仓数据的基金里，前十大重仓股均未检索到"${state.holdingsNoMatch}"。` +
        `必须如实说明"未在已披露的前十大重仓股中找到持有该股的 QDII 基金"，不要编造，可建议换主题或行业角度再找。`
    );
  }
  if (state.ragHits && state.ragHits.length) {
    const lines = state.ragHits.slice(0, 6).map((h) => {
      const tag = h.source ? `[${h.source}]` : "";
      return `・${h.code} ${tag} sim=${h.similarity ?? "?"}：${trimText(h.content, 200)}`;
    });
    blocks.push(`# 语义检索（pgvector，来自 F10/AI 点评/持仓真实原文）\n${lines.join("\n")}`);
  }
  if (state.concept) {
    blocks.push(`# 概念题\n用户原问：${state.concept.query}`);
  }
  if (state.funds && state.funds.length && state.event?.degraded) {
    blocks.push(`# 行情检索\n状态：未接入或失败（${state.event.reason || "unknown"}）；已有候选基金列表。`);
  } else if (state.event) {
    if (state.event.degraded) {
      blocks.push(`# 行情检索\n查询：${state.plan?.eventQuery || ""}\n状态：未接入或失败（${state.event.reason || "unknown"}）。`);
    } else {
      const refs = state.event.results.map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${trimText(r.snippet, 220)}`).join("\n");
      blocks.push(`# 行情检索\n查询：${state.event.query}\n摘要：${trimText(state.event.answer || "(无)", 360)}\n来源：\n${refs}`);
    }
  }
  if (!blocks.length) blocks.push("# 无工具结果");
  return blocks.join("\n\n");
}

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function thinkingOptions(model) {
  const enableThinking = envFlag("DASHSCOPE_ENABLE_THINKING") && /^qwen3[-.]/i.test(String(model || ""));
  return {
    enableThinking,
    thinkingBudget: enableThinking ? process.env.DASHSCOPE_THINKING_BUDGET || 1200 : null,
  };
}

export async function synthesize({ user, history = [], state, profile = null } = {}) {
  const toolContext = buildToolContext(state);
  const models = modelChain();
  const recentTurns = (Array.isArray(history) ? history : []).slice(-6);

  const messages = [
    { role: "system", content: SYNTH_SYSTEM + buildPersonaDirective(profile) },
    ...recentTurns.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: `用户本轮问题：\n${user}\n\n以下是后端工具调用结果：\n\n${toolContext}\n\n现在请给出答复。`,
    },
  ];

  let lastErr = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    try {
      const r = await chatCompletion({
        model,
        messages,
        temperature: 0.5,
        topP: 0.85,
        maxTokens: 900,
        ...thinkingOptions(model),
      });
      return {
        reply: r.content.trim(),
        model: r.model,
        ok: true,
        ...(i > 0 ? { fallbackFrom: models[0], fallbackReason: isQuotaExhausted(lastErr) ? "quota" : "error" } : {}),
      };
    } catch (err) {
      lastErr = err;
      console.warn(
        `[synth] 模型 ${model} 失败（${isQuotaExhausted(err) ? "免费额度用完" : "其他错误"}）：${err.message}` +
          (i < models.length - 1 ? `，切到下一个：${models[i + 1]}` : "，已无更多备用")
      );
      // 选项 B：任何报错都顺位切到下一个模型，直到链尾。
    }
  }

  return {
    reply: "我这边模型暂时调不通，先稍后再问一次试试。",
    model: models[models.length - 1] || models[0],
    ok: false,
    error: lastErr?.message,
    tried: models,
  };
}

export async function synthesizeStream({ user, history = [], state, onDelta, onReasoningDelta, profile = null } = {}) {
  const toolContext = buildToolContext(state);
  const models = modelChain();
  const recentTurns = (Array.isArray(history) ? history : []).slice(-6);
  const messages = [
    { role: "system", content: SYNTH_SYSTEM + buildPersonaDirective(profile) },
    ...recentTurns.map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: `用户本轮问题：\n${user}\n\n以下是后端工具调用结果：\n\n${toolContext}\n\n现在请给出答复。`,
    },
  ];

  let lastErr = null;
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    // 标记：本模型是否已经开始往前端吐内容。一旦开始就不能再换模型（否则会重复显示）。
    let started = false;
    const wrappedDelta = (d, f) => {
      started = true;
      if (typeof onDelta === "function") onDelta(d, f);
    };
    const wrappedReasoning = (d, f) => {
      started = true;
      if (typeof onReasoningDelta === "function") onReasoningDelta(d, f);
    };
    try {
      const r = await chatCompletionStream({
        model,
        messages,
        temperature: 0.5,
        topP: 0.85,
        maxTokens: 900,
        onDelta: wrappedDelta,
        onReasoningDelta: wrappedReasoning,
        ...thinkingOptions(model),
      });
      return {
        reply: r.content.trim(),
        reasoning: r.reasoning || "",
        model: r.model,
        ok: true,
        ...(i > 0 ? { fallbackFrom: models[0], fallbackReason: isQuotaExhausted(lastErr) ? "quota" : "error" } : {}),
      };
    } catch (err) {
      lastErr = err;
      console.warn(
        `[synth:stream] 模型 ${model} 失败（${isQuotaExhausted(err) ? "免费额度用完" : "其他错误"}）：${err.message}`
      );
      // 已经开始吐字了，中途不能再换模型（会产生重复内容），直接停。
      if (started) break;
      // 选项 B：开口前的任何报错都顺位切到下一个模型。
    }
  }

  return {
    reply: "我这边模型暂时调不通，先稍后再问一次试试。",
    reasoning: "",
    model: models[0],
    ok: false,
    error: lastErr?.message,
  };
}

export function pickCards(state) {
  if (!state || !Array.isArray(state.funds)) return [];
  const raw = state.funds.slice(0, 12).map((f) => ({
    code: f.code,
    name: f.name,
    region: f.region,
    theme: f.theme,
    role: f.role,
    risk: f.risk,
    return1y: f.return1y,
    return3m: f.return3m,
    returnYtd: f.returnYtd,
    score: f.score,
    scoreLabel: f.scoreLabel,
    discountFee: f.discountFee,
    ratingMorningstar: f.ratingMorningstar,
    purchaseStatus: f.purchaseStatus || null,
    purchaseLimitYuan: f.purchaseLimitYuan ?? null,
  }));
  return mergeShareClassCards(raw);
}
