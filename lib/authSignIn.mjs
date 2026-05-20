import { createClient } from "@supabase/supabase-js";
import { publicConfig } from "./supabase.mjs";

let publicAuthClient = null;

function getPublicAuthClient() {
  if (!publicAuthClient) {
    if (!publicConfig.url || !publicConfig.publishableKey) {
      throw new Error("Supabase 未配置");
    }
    publicAuthClient = createClient(publicConfig.url, publicConfig.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return publicAuthClient;
}

export function normalizeAuthEmail(email) {
  return (email || "").trim().toLowerCase();
}

/** 去掉复制粘贴时常见的首尾空白，不改动密码中间字符 */
export function normalizeAuthPassword(password) {
  return String(password ?? "").replace(/^[\r\n\t]+|[\r\n\t]+$/g, "");
}

export function translateAuthError(message) {
  const m = (message || "").trim();
  const map = {
    "Invalid login credentials": "邮箱或密码不正确，请检查后重试",
    "Email not confirmed": "邮箱尚未验证，请联系管理员",
    "User already registered": "该邮箱已注册，请直接登录",
    "Signup requires a valid password": "密码至少 6 位",
    "Password should be at least 6 characters": "密码至少 6 位",
    "Unable to validate email address: invalid format": "邮箱格式不正确",
  };
  if (map[m]) return map[m];
  if (/invalid login credentials/i.test(m)) return map["Invalid login credentials"];
  if (/already.*registered/i.test(m)) return map["User already registered"];
  return m || "操作失败，请稍后重试";
}

export async function signInWithEmailPassword(email, password) {
  const normalizedEmail = normalizeAuthEmail(email);
  const normalizedPassword = normalizeAuthPassword(password);
  const { data, error } = await getPublicAuthClient().auth.signInWithPassword({
    email: normalizedEmail,
    password: normalizedPassword,
  });
  if (error) {
    const err = new Error(translateAuthError(error.message));
    err.code = error.status || 400;
    throw err;
  }
  if (!data.session) throw new Error("登录失败：未返回会话");
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: { id: data.user.id, email: data.user.email },
  };
}
