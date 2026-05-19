import { createClient } from "@supabase/supabase-js";

const STORAGE_KEY = "qdii-compass-session";
let supabase = null;
let session = null;
const listeners = new Set();

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(value) {
  if (value) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function emit() {
  for (const fn of listeners) fn(session);
}

export function onAuthChange(fn) {
  listeners.add(fn);
  fn(session);
  return () => listeners.delete(fn);
}

export function getSession() {
  return session;
}

export function getToken() {
  return session?.access_token || null;
}

export async function init() {
  const res = await fetch("/api/config");
  const config = await res.json();
  if (!config.url || !config.publishableKey) {
    console.warn("Supabase 未配置，认证功能不可用");
    return null;
  }
  supabase = createClient(config.url, config.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  session = loadSession();
  emit();
  return supabase;
}

export async function signUp(email, password, inviteCode) {
  const res = await fetch("/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, inviteCode }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "注册失败");
  return await signIn(email, password);
}

export async function signIn(email, password) {
  if (!supabase) throw new Error("Supabase 未初始化");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("登录失败：未返回会话");
  session = {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: { id: data.user.id, email: data.user.email },
  };
  saveSession(session);
  emit();
  return session;
}

export async function signOut() {
  session = null;
  saveSession(null);
  emit();
}

export async function authedFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    session = null;
    saveSession(null);
    emit();
  }
  return res;
}
