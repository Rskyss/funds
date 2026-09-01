// 带超时的 fetch：所有出站请求（东方财富 / 百炼 / Tavily）统一走这里，避免上游挂起把整条链路卡死。
// 用法：fetchWithTimeout(url, { ...init, timeoutMs: 30000 }) 或 fetchWithTimeout(url, init, 30000)。
// 超时抛出的错误 name 为 "TimeoutError"，与调用方主动取消的 "AbortError" 区分开：
// 前者应视为"这次失败了"（可换模型 / 重试），后者应原样上抛。
const DEFAULT_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 15000);

export function fetchWithTimeout(url, init = {}, timeoutMs) {
  const { timeoutMs: inlineTimeout, ...rest } = init || {};
  const chosen = Number(timeoutMs ?? inlineTimeout);
  const ms = Number.isFinite(chosen) && chosen > 0 ? chosen : DEFAULT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(ms);
  const signal = rest.signal ? AbortSignal.any([rest.signal, timeoutSignal]) : timeoutSignal;
  return fetch(url, { ...rest, signal }).catch((err) => {
    const callerAborted = Boolean(rest.signal?.aborted);
    if (err?.name === "TimeoutError" || (err?.name === "AbortError" && timeoutSignal.aborted && !callerAborted)) {
      const e = new Error(`请求超时（${ms}ms）: ${String(url).slice(0, 120)}`);
      e.name = "TimeoutError";
      e.cause = err;
      throw e;
    }
    throw err;
  });
}

export { DEFAULT_TIMEOUT_MS };
