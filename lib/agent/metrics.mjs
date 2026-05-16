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

const buckets = new Map();
const WINDOW_MS = 60_000;
const LIMIT = Number(process.env.AGENT_RATE_LIMIT || 20);

export function rateLimit(key) {
  const now = Date.now();
  const list = buckets.get(key) || [];
  const fresh = list.filter((t) => now - t < WINDOW_MS);
  if (fresh.length >= LIMIT) {
    const retryAfterMs = WINDOW_MS - (now - fresh[0]);
    return { allowed: false, retryAfterMs, limit: LIMIT };
  }
  fresh.push(now);
  buckets.set(key, fresh);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (!v.length || now - v[v.length - 1] > WINDOW_MS) buckets.delete(k);
    }
  }
  return { allowed: true, used: fresh.length, limit: LIMIT };
}
