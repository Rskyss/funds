import { createClient } from "@supabase/supabase-js";

const STORAGE_KEY = "qdii-compass-session";
let supabase = null;
let session = null;
const listeners = new Set();

/** 将 Supabase 英文错误转为用户可读中文 */
export function translateAuthError(message) {
  const m = (message || "").trim();
  const map = {
    "Invalid login credentials": "邮箱或密码不正确，请检查后重试",
    "Email not confirmed": "邮箱尚未验证，请联系管理员",
    "User already registered": "该邮箱已注册，请直接登录",
  };
  if (map[m]) return map[m];
  if (/invalid login credentials/i.test(m)) return map["Invalid login credentials"];
  return m || "操作失败，请稍后重试";
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// 隐私模式 / 存储满 / 被禁用时 localStorage 会抛错；登录态退化为“仅本次页面有效”，不能让登录流程崩掉
function saveSession(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
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

/** 服务端返回 401 或本地判断 token 已过期时统一走这里：清登录态并广播 */
export function handleUnauthorized() {
  if (!session) return;
  session = null;
  saveSession(null);
  emit();
}

function isExpired(s) {
  const exp = Number(s?.expires_at);
  return Number.isFinite(exp) && exp > 0 && exp * 1000 < Date.now();
}

export function getToken() {
  if (!session?.access_token) return null;
  if (isExpired(session)) {
    handleUnauthorized();
    return null;
  }
  return session.access_token;
}

export async function init() {
  // 先恢复本地登录态，再拉配置：配置接口偶发失败不应让已登录用户“看起来没登录”
  session = loadSession();
  if (session && isExpired(session)) session = null;
  emit();
  try {
    const res = await fetch("/api/config", { signal: AbortSignal.timeout(10000) });
    const config = await res.json();
    if (!config.url || !config.publishableKey) {
      console.warn("Supabase 未配置，认证功能不可用");
      return null;
    }
    supabase = createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (err) {
    console.warn("读取 /api/config 失败：", err?.message || err);
  }
  return supabase;
}

async function postJson(url, payload) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error("网络异常或超时，请稍后重试");
  }
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function signUp(email, password) {
  const normalizedEmail = (email || "").trim().toLowerCase();
  const { res, data } = await postJson("/api/auth/signup", { email: normalizedEmail, password });
  if (!res.ok) throw new Error(translateAuthError(data.error) || "注册失败");
  return await signIn(normalizedEmail, password);
}

export async function signIn(email, password) {
  const { res, data } = await postJson("/api/auth/signin", { email, password });
  if (!res.ok) throw new Error(translateAuthError(data.error) || "登录失败");
  if (!data.session) throw new Error("登录失败：未返回会话");
  session = data.session;
  saveSession(session);
  emit();
  return session;
}

export async function signOut() {
  session = null;
  saveSession(null);
  emit();
}

/** 带登录态的 fetch（返回原始 Response，供需要自行处理状态码的调用方使用）；默认 20s 超时 */
export async function authedFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  let res;
  try {
    res = await fetch(url, { ...options, headers, signal: options.signal || AbortSignal.timeout(20000) });
  } catch (err) {
    throw new Error(err?.name === "TimeoutError" ? "请求超时，请检查网络后重试" : "网络异常，请稍后重试");
  }
  if (res.status === 401) handleUnauthorized();
  return res;
}
