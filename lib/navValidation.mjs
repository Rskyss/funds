// 净值行入库前校验（纯函数，无外部依赖，便于单测）。
// 拦截东财偶发的脏数据：净值为 0/负数、日期解析失败、日期在未来或荒谬地早。
const MIN_TS = Date.UTC(1990, 0, 1);
const FUTURE_SLACK_MS = 2 * 86400000; // 允许时区差导致的“明天”
const PLAUSIBLE_NOW_MIN = Date.UTC(2000, 0, 1);

/**
 * @param row {{ nav: any, nav_date: any }}
 * @param now 可选，毫秒时间戳（测试用）。传入不像时间戳的值（例如被 Array.filter 当回调时收到的下标）一律忽略。
 *   2026-09-01 生产事故：store 里写成 candidates.filter(isValidNavRow)，下标 0..739 被当成 now，740 行全被判成“未来日期”。
 */
export function isValidNavRow(row, now) {
  const nowTs = Number.isFinite(now) && now > PLAUSIBLE_NOW_MIN ? now : Date.now();
  const nav = Number(row?.nav);
  if (!Number.isFinite(nav) || nav <= 0 || nav > 100000) return false;
  const raw = row?.nav_date;
  const d = raw instanceof Date ? raw : new Date(String(raw || ""));
  const t = d.getTime();
  if (!Number.isFinite(t)) return false;
  if (t > nowTs + FUTURE_SLACK_MS) return false;
  if (t < MIN_TS) return false;
  return true;
}
