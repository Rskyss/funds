import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../supabase.mjs";

const MAX_MESSAGES = 20;

function emptyState() {
  return { lastCodes: [], lastFilters: null, messages: [] };
}

export async function loadSession(sessionId) {
  if (!sessionId) return { sessionId: randomUUID(), state: emptyState(), isNew: true };
  const { data, error } = await supabaseAdmin
    .from("chat_sessions")
    .select("session_id, user_id, state, created_at, updated_at")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw new Error(`loadSession 失败: ${error.message}`);
  if (!data) return { sessionId, state: emptyState(), isNew: true };
  const state = data.state && typeof data.state === "object" ? data.state : emptyState();
  if (!Array.isArray(state.messages)) state.messages = [];
  if (!Array.isArray(state.lastCodes)) state.lastCodes = [];
  return { sessionId: data.session_id, userId: data.user_id || null, state, isNew: false };
}

export async function saveSession({ sessionId, userId, state }) {
  const row = {
    session_id: sessionId,
    user_id: userId || null,
    state: state || emptyState(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin
    .from("chat_sessions")
    .upsert(row, { onConflict: "session_id" });
  if (error) throw new Error(`saveSession 失败: ${error.message}`);
}

export function appendTurn(state, role, content, extras = null) {
  state.messages = state.messages || [];
  const turn = { role, content, ts: Date.now() };
  if (extras && typeof extras === "object") {
    if (Array.isArray(extras.cards) && extras.cards.length) turn.cards = extras.cards;
    if (Array.isArray(extras.sources) && extras.sources.length) turn.sources = extras.sources;
    if (extras.plan && typeof extras.plan === "object") turn.plan = extras.plan;
  }
  state.messages.push(turn);
  if (state.messages.length > MAX_MESSAGES) {
    state.messages = state.messages.slice(state.messages.length - MAX_MESSAGES);
  }
  return state;
}

export function updateLast(state, { codes, filter }) {
  if (Array.isArray(codes) && codes.length) state.lastCodes = codes.slice(0, 12);
  if (filter && typeof filter === "object") state.lastFilters = filter;
  return state;
}

export { randomUUID };
