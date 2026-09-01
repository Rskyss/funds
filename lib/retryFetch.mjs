// 给 Supabase 客户端用的"瞬时错误重试一次"fetch。
//
// 背景（2026-09-01 线上审计）：Supabase 网关偶发返回 401 "JWT issued at future"（其内部时钟偏差，
// 与本服务器无关），5 月以来 /api/funds 有 5.3% 的请求因此 500，埋点写入失败 56 次。
// 这类错误在请求被执行之前就被拒绝，所以任何方法都可以安全重发一次；
// 网络层瞬断（fetch failed / terminated）只对 GET/HEAD 重试，避免 POST 重复写入。
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function isTransientDbResponse(res) {
  if (!res || typeof res.status !== "number") return false;
  if ([502, 503, 504].includes(res.status)) return true;
  if (res.status !== 401) return false;
  try {
    const text = await res.clone().text();
    return /issued at future/i.test(text);
  } catch {
    return false;
  }
}

export function isTransientNetworkError(err) {
  if (!err || err.name === "AbortError" || err.name === "TimeoutError") return false;
  const text = `${err.message || ""} ${err.cause?.code || ""} ${err.cause?.message || ""}`;
  return /fetch failed|terminated|ECONNRESET|socket hang up|EPIPE|UND_ERR_SOCKET|ETIMEDOUT/i.test(text);
}

export function createRetryingFetch(baseFetch = globalThis.fetch, { retries = 1, delayMs = 300, onRetry } = {}) {
  return async function retryingFetch(input, init) {
    const method = String(init?.method || "GET").toUpperCase();
    const body = init?.body;
    const replayable = body === undefined || body === null || typeof body === "string" || body instanceof URLSearchParams;
    const idempotent = method === "GET" || method === "HEAD";
    let attempt = 0;
    for (;;) {
      try {
        const res = await baseFetch(input, init);
        if (attempt < retries && replayable && (await isTransientDbResponse(res))) {
          // 401 issued-at-future：请求未被执行，任何方法都可重发；网关 5xx 只重发幂等请求
          if (res.status === 401 || idempotent) {
            attempt++;
            onRetry?.({ reason: `HTTP ${res.status}`, method, url: String(input), attempt });
            await sleep(delayMs * attempt);
            continue;
          }
        }
        return res;
      } catch (err) {
        if (attempt < retries && idempotent && replayable && isTransientNetworkError(err)) {
          attempt++;
          onRetry?.({ reason: err.message, method, url: String(input), attempt });
          await sleep(delayMs * attempt);
          continue;
        }
        throw err;
      }
    }
  };
}
