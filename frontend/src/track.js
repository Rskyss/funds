// 匿名行为埋点：只上报匿名行为（页面浏览/打开基金/搜索/筛选）
// 用一个随机匿名编号把同一访客的行为串起来；不收集任何敏感信息。
import { authedFetch } from "./auth.js";

const ANON_KEY = "qdii-anon-id";

function getAnonId() {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = "a_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

const anonId = getAnonId();

export function track(type, opts = {}) {
  if (!type) return;
  const payload = {};
  if (opts.q) payload.q = opts.q;
  if (opts.label) payload.label = opts.label;
  const body = {
    type,
    anonId,
    code: opts.code || null,
    payload: Object.keys(payload).length ? payload : null,
  };
  try {
    authedFetch("/api/events", { method: "POST", body: JSON.stringify(body) }).catch(() => {});
  } catch {
    // 埋点失败永不影响主流程
  }
}

// 页面浏览：同一浏览器会话只记一次，避免刷屏
export function trackPageViewOnce() {
  try {
    const KEY = "qdii-pv-session";
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, "1");
  } catch {
    // ignore
  }
  track("page_view");
}

// 搜索：防抖 800ms，空词不记
let searchTimer = null;
export function trackSearch(q) {
  const v = (q || "").trim();
  if (!v) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => track("search", { q: v }), 800);
}
