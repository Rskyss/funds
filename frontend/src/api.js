/* 统一请求层：超时、取消、JSON 解析、错误文案、401 自动登出，全站一处维护 */
import { getToken, handleUnauthorized } from "./auth.js";

export class ApiError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * api(path, { method, body, auth, timeout, signal, headers })
 * - 返回解析后的 JSON（非 JSON 响应返回 null）
 * - 非 2xx 抛 ApiError（message 优先取服务端 { error }）
 * - 超时 / 取消 / 网络错误统一成可读中文
 */
export async function api(path, { method = "GET", body, auth = false, timeout = DEFAULT_TIMEOUT_MS, signal, headers } = {}) {
  const h = new Headers(headers || {});
  if (body !== undefined && !h.has("content-type")) h.set("content-type", "application/json");
  if (auth) {
    const token = getToken();
    if (token) h.set("authorization", `Bearer ${token}`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort("timeout"), timeout);
  const onOuterAbort = () => ctrl.abort("cancelled");
  if (signal) {
    if (signal.aborted) onOuterAbort();
    else signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  let res;
  try {
    res = await fetch(path, {
      method,
      headers: h,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    if (ctrl.signal.aborted) {
      throw new ApiError(0, ctrl.signal.reason === "timeout" ? "请求超时，请检查网络后重试" : "已取消");
    }
    throw new ApiError(0, "网络异常，请稍后重试");
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onOuterAbort);
  }

  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("json")) {
    try { data = await res.json(); } catch { data = null; }
  }
  if (res.status === 401 && auth) handleUnauthorized();
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `HTTP ${res.status}`, data);
  return data;
}
