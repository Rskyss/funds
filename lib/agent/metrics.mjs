import { supabaseAdmin } from "../supabase.mjs";

export function logChatTurn(row) {
  const payload = {
    session_id: row.sessionId || null,
    user_id: row.userId || null,
    ip: row.ip || null,
    intent: row.intent || null,
    user_message: (row.userMessage || "").slice(0, 500),
    reply_preview: (row.reply || "").slice(0, 600),
    tools_json: row.tools || null,
    plan_json: row.plan || null,
    cards_count: row.cardsCount ?? 0,
    sources_count: row.sourcesCount ?? 0,
    latency_ms: row.latencyMs ?? null,
    ok: row.ok !== false,
    degraded: !!row.degraded,
    error: row.error || null,
  };
  supabaseAdmin
    .from("chat_logs")
    .insert(payload)
    .then(({ error }) => {
      if (error) console.warn("chat_logs insert failed:", error.message);
    })
    .catch((err) => console.warn("chat_logs error:", err.message));
}

// 限流实现在 lib/rateLimit.mjs（纯函数、可单测）；这里保留导出以兼容旧调用方。
export { rateLimit } from "../rateLimit.mjs";
