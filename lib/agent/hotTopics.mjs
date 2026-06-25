// ============================================================
// AI 热议推荐：当板块发生重大异动时，让 AI 生成 2 条贴合行情的推荐问题
// 触发条件：任一板块当日 |avg1d| > 2.5%，或距上次成功生成 > 30 天
// 兜底：AI 调用失败时静默降级，前端只显示固定问题
// ============================================================

import { supabaseAdmin } from "../supabase.mjs";
import { chatCompletion, withModelFallback } from "../ai.mjs";
import { webSearchEvent } from "./tools.mjs";

const BOARD_EXCLUDE = new Set(["综合配置"]);
const EVENT_THRESHOLD = 2.5;     // 板块异动阈值（绝对值百分比）
const FALLBACK_DAYS = 30;        // 距上次生成超过此天数也触发
const MAX_QUESTIONS = 2;

let inflight = null; // 同进程内只跑一次，避免并发

// 计算各板块当日平均涨跌（与前端 computeBoards 逻辑一致）
export function computeBoards(funds) {
  const g = new Map();
  for (const f of funds || []) {
    const theme = f.theme;
    if (!theme || BOARD_EXCLUDE.has(theme)) continue;
    let e = g.get(theme);
    if (!e) { e = { theme, count: 0, sum: 0, valued: 0 }; g.set(theme, e); }
    e.count += 1;
    if (typeof f.return1d === "number") { e.sum += f.return1d; e.valued += 1; }
  }
  return [...g.values()]
    .map((e) => ({ theme: e.theme, count: e.count, avg1d: e.valued ? +(e.sum / e.valued).toFixed(2) : 0 }))
    .sort((a, b) => b.count - a.count);
}

// 读最近一条生效中的热议
export async function getActiveHotSuggestions() {
  try {
    const { data, error } = await supabaseAdmin
      .from("chat_hot_suggestions")
      .select("questions, trigger_reason, created_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return null;
    if (!data) return null;
    return {
      questions: Array.isArray(data.questions) ? data.questions : [],
      triggerReason: data.trigger_reason || "",
      createdAt: data.created_at,
    };
  } catch {
    return null;
  }
}

async function deactivateOldRows() {
  try {
    await supabaseAdmin
      .from("chat_hot_suggestions")
      .update({ is_active: false })
      .eq("is_active", true);
  } catch {
    // 旧数据未失活不影响主流程
  }
}

async function insertHotSuggestions(questions, triggerReason, contextSnippet) {
  await deactivateOldRows();
  const { error } = await supabaseAdmin
    .from("chat_hot_suggestions")
    .insert([{
      questions,
      trigger_reason: triggerReason,
      context_snippet: contextSnippet || null,
      is_active: true,
    }]);
  if (error) throw new Error(`保存热议失败：${error.message}`);
}

// 判定本次是否需要重新生成
function detectTrigger(boards, lastCreatedAt) {
  const extreme = (boards || [])
    .filter((b) => Math.abs(b.avg1d) > EVENT_THRESHOLD)
    .sort((a, b) => Math.abs(b.avg1d) - Math.abs(a.avg1d))[0];

  if (extreme) {
    const dir = extreme.avg1d >= 0 ? "+" : "";
    return { trigger: true, reason: `板块异动：${extreme.theme} ${dir}${extreme.avg1d}%`, extremeBoard: extreme };
  }

  if (!lastCreatedAt) {
    return { trigger: true, reason: "首次生成（无历史热议）", extremeBoard: null };
  }
  const ageDays = (Date.now() - new Date(lastCreatedAt).getTime()) / (24 * 3600 * 1000);
  if (ageDays > FALLBACK_DAYS) {
    return { trigger: true, reason: `${FALLBACK_DAYS} 天兜底刷新（已 ${Math.round(ageDays)} 天未更新）`, extremeBoard: null };
  }
  return { trigger: false, reason: "板块涨跌平稳且热议未过期", extremeBoard: null };
}

// 用 Tavily 拉点市场背景，给 LLM 生成问题做"接地气"的素材
async function fetchMarketContext(extremeBoard) {
  const queries = [];
  if (extremeBoard) {
    queries.push(`${extremeBoard.theme} QDII 基金 最近 走势`);
  }
  queries.push("QDII 基金 海外市场 最近 热点");

  for (const q of queries) {
    const res = await webSearchEvent(q);
    if (!res.degraded && (res.answer || res.results?.length)) {
      const lines = [];
      if (res.answer) lines.push(`概览：${res.answer}`);
      for (const r of (res.results || []).slice(0, 4)) {
        lines.push(`- ${r.title}：${r.snippet}`);
      }
      return lines.join("\n");
    }
  }
  return "";
}

// 让 LLM 基于市场背景写 2 条推荐问题
async function generateQuestionsByLLM({ trigger, extremeBoard, contextSnippet }) {
  const sysPrompt = [
    "你是 QDII 基金 AI 投顾的'推荐问题撰写人'。",
    "请输出最近最值得用户问的 2 个问题，要求：",
    "1. 紧扣最近真实发生的市场事件或行情（基于提供的市场背景）；",
    "2. 用普通投资者能听懂的口语化中文，避免艰深术语；",
    "3. 每条 8~20 个汉字，单句疑问句；",
    "4. 不要出现具体股票代码/基金代码，可以用'纳指''美股''A股科技 QDII'等通俗指称；",
    "5. 不能含投资建议性话术（如'现在该不该全仓'），保持中性求知。",
    "返回 JSON：{ \"questions\": [\"...\", \"...\"] }",
  ].join("\n");

  const userBlocks = [
    `本次触发原因：${trigger}`,
    extremeBoard ? `异动板块：${extremeBoard.theme}（当日平均 ${extremeBoard.avg1d}%）` : "无单一板块异动，例行刷新",
    contextSnippet ? `市场背景：\n${contextSnippet}` : "市场背景：（未拉取到搜索结果，请基于常识写两条最近通用的 QDII 投资者关心的问题）",
  ];

  const { json } = await withModelFallback(
    (model) =>
      chatCompletion({
        model,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userBlocks.join("\n\n") },
        ],
        temperature: 0.7,
        maxTokens: 512,
        json: true,
      }),
    { label: "hotTopics" }
  );

  const questions = Array.isArray(json?.questions) ? json.questions : [];
  return questions
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter((s) => s && s.length >= 6 && s.length <= 60)
    .slice(0, MAX_QUESTIONS);
}

// 主入口：检查事件 → 调 AI → 落库；外部仅需关心 funds 列表
export async function maybeRefreshHotSuggestions(funds) {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const boards = computeBoards(funds);
      const last = await getActiveHotSuggestions();
      const { trigger, reason, extremeBoard } = detectTrigger(boards, last?.createdAt);
      if (!trigger) {
        console.log(`[热议推荐] 跳过：${reason}`);
        return { skipped: true, reason };
      }
      console.log(`[热议推荐] 触发生成：${reason}`);
      const contextSnippet = await fetchMarketContext(extremeBoard).catch(() => "");
      const questions = await generateQuestionsByLLM({ trigger: reason, extremeBoard, contextSnippet });
      if (questions.length < MAX_QUESTIONS) {
        console.warn(`[热议推荐] AI 仅返回 ${questions.length} 条合规问题，本次放弃落库`);
        return { skipped: true, reason: "AI 输出不足 2 条" };
      }
      await insertHotSuggestions(questions, reason, contextSnippet.slice(0, 800));
      console.log(`[热议推荐] 已更新 ✓ ${questions.join(" / ")}`);
      return { saved: true, questions, reason };
    } catch (err) {
      console.error("[热议推荐] 生成失败（静默降级）：", err?.message || err);
      return { skipped: true, reason: `error: ${err?.message || err}` };
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
