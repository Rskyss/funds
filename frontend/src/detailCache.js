const DETAIL_CACHE_PREFIX = "qdii-detail-v2-";
const DETAIL_CACHE_TTL_MS = 24 * 3600 * 1000;

export function readDetailCache(code) {
  try {
    const raw = localStorage.getItem(`${DETAIL_CACHE_PREFIX}${code}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || Date.now() - (data.cachedAt || 0) > DETAIL_CACHE_TTL_MS) return null;
    return data.detail;
  } catch {
    return null;
  }
}

function evictOldDetailCache(keepCount = 30) {
  try {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DETAIL_CACHE_PREFIX)) {
        let at = 0;
        try { at = JSON.parse(localStorage.getItem(k))?.cachedAt || 0; } catch { /* ignore */ }
        entries.push({ k, at });
      }
    }
    entries.sort((a, b) => a.at - b.at);
    for (const e of entries.slice(0, Math.max(0, entries.length - keepCount))) {
      localStorage.removeItem(e.k);
    }
  } catch {
    // ignore
  }
}

export function writeDetailCache(code, detail) {
  const payload = JSON.stringify({ cachedAt: Date.now(), detail });
  try {
    localStorage.setItem(`${DETAIL_CACHE_PREFIX}${code}`, payload);
  } catch {
    evictOldDetailCache(20);
    try {
      localStorage.setItem(`${DETAIL_CACHE_PREFIX}${code}`, payload);
    } catch {
      // ignore
    }
  }
}
