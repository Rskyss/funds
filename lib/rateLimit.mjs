// 进程内滑动窗口限流（纯函数模块，无 IO 依赖，便于单测）。
// 单实例够用；多实例需换 Redis 之类的共享存储。
// key 由调用方决定：聊天按用户/IP，登录注册按 IP+邮箱，运营接口按 IP。
const buckets = new Map();
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = Number(process.env.AGENT_RATE_LIMIT || 20);

export function rateLimit(key, { limit = DEFAULT_LIMIT, windowMs = DEFAULT_WINDOW_MS } = {}) {
  const now = Date.now();
  const list = buckets.get(key) || [];
  const fresh = list.filter((t) => now - t < windowMs);
  if (fresh.length >= limit) {
    const retryAfterMs = windowMs - (now - fresh[0]);
    return { allowed: false, retryAfterMs, limit };
  }
  fresh.push(now);
  buckets.set(key, fresh);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (!v.length || now - v[v.length - 1] > windowMs) buckets.delete(k);
    }
  }
  return { allowed: true, used: fresh.length, limit };
}

/** 仅测试用：清空所有桶。 */
export function _resetRateLimits() {
  buckets.clear();
}
