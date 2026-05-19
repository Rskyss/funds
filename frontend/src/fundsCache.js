const FUNDS_CACHE_KEY = "qdii-funds-cache-v2";
const FUNDS_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;

export function readFundsCache() {
  try {
    const raw = localStorage.getItem(FUNDS_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.funds) || !data.funds.length) return null;
    if (Date.now() - (data.cachedAt || 0) > FUNDS_CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeFundsCache(payload) {
  try {
    localStorage.setItem(
      FUNDS_CACHE_KEY,
      JSON.stringify({
        fetchedAt: payload.fetchedAt,
        fetchedAtText: payload.fetchedAtText,
        total: payload.total,
        funds: payload.funds,
        cachedAt: Date.now(),
      }),
    );
  } catch {
    // quota / private mode
  }
}
