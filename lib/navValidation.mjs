// 净值行入库前校验（纯函数，无外部依赖，便于单测）。
// 拦截东财偶发的脏数据：净值为 0/负数、日期解析失败、日期在未来或荒谬地早。
const MIN_TS = Date.UTC(1990, 0, 1);
const FUTURE_SLACK_MS = 2 * 86400000; // 允许时区差导致的“明天”

export function isValidNavRow(row, now = Date.now()) {
  const nav = Number(row?.nav);
  if (!Number.isFinite(nav) || nav <= 0 || nav > 100000) return false;
  const raw = row?.nav_date;
  const d = raw instanceof Date ? raw : new Date(String(raw || ""));
  const t = d.getTime();
  if (!Number.isFinite(t)) return false;
  if (t > now + FUTURE_SLACK_MS) return false;
  if (t < MIN_TS) return false;
  return true;
}
