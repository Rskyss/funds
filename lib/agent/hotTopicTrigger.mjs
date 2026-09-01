// 热议推荐的触发判定（纯函数，便于单测）。
// 触发条件：任一板块当日 |avg1d| > EVENT_THRESHOLD，或距上次成功生成 > FALLBACK_DAYS。
// 2026-09-01 修复：同一板块的异动在 24 小时内只生成一次——之前每次服务重启 / 每次数据刷新
// 都重新生成（一天生成了 14 次，每次 1 次大模型 + 1 次联网搜索，推荐问题一天换十几次）。
export const BOARD_EXCLUDE = new Set(["综合配置"]);
export const EVENT_THRESHOLD = 2.5;               // 板块异动阈值（绝对值百分比）
export const FALLBACK_DAYS = 30;                  // 距上次生成超过此天数也触发
export const SAME_EVENT_COOLDOWN_MS = 24 * 3600_000; // 同板块异动的重复生成间隔

// 计算各板块当日平均涨跌（与前端 computeBoards 逻辑一致）
export function computeBoards(funds) {
  const g = new Map();
  for (const f of funds || []) {
    const theme = f.theme;
    if (!theme || BOARD_EXCLUDE.has(theme)) continue;
    let e = g.get(theme);
    if (!e) { e = { theme, count: 0, sum: 0, valued: 0 }; g.set(theme, e); }
    e.count += 1;
    if (typeof f.return1d === "number") { e.sum += f.return1d; e.valued += 1; }
  }
  return [...g.values()]
    .map((e) => ({ theme: e.theme, count: e.count, avg1d: e.valued ? +(e.sum / e.valued).toFixed(2) : 0 }))
    .sort((a, b) => b.count - a.count);
}

function themeOfReason(reason) {
  const m = String(reason || "").match(/^板块异动：(\S+)/);
  return m ? m[1] : null;
}

/**
 * @param {Array<{theme:string, avg1d:number}>} boards
 * @param {{ triggerReason?: string, createdAt?: string } | null} last 当前生效中的热议（没有则 null）
 * @param {number} now
 */
export function detectTrigger(boards, last, now = Date.now()) {
  const extreme = (boards || [])
    .filter((b) => Math.abs(b.avg1d) > EVENT_THRESHOLD)
    .sort((a, b) => Math.abs(b.avg1d) - Math.abs(a.avg1d))[0];
  const lastAt = last?.createdAt ? new Date(last.createdAt).getTime() : NaN;

  if (extreme) {
    const dir = extreme.avg1d >= 0 ? "+" : "";
    const reason = `板块异动：${extreme.theme} ${dir}${extreme.avg1d}%`;
    if (themeOfReason(last?.triggerReason) === extreme.theme && Number.isFinite(lastAt) && now - lastAt < SAME_EVENT_COOLDOWN_MS) {
      return { trigger: false, reason: `同板块（${extreme.theme}）24 小时内已生成过热议，跳过`, extremeBoard: extreme };
    }
    return { trigger: true, reason, extremeBoard: extreme };
  }

  if (!Number.isFinite(lastAt)) {
    return { trigger: true, reason: "首次生成（无历史热议）", extremeBoard: null };
  }
  const ageDays = (now - lastAt) / (24 * 3600 * 1000);
  if (ageDays > FALLBACK_DAYS) {
    return { trigger: true, reason: `${FALLBACK_DAYS} 天兜底刷新（已 ${Math.round(ageDays)} 天未更新）`, extremeBoard: null };
  }
  return { trigger: false, reason: "板块涨跌平稳且热议未过期", extremeBoard: null };
}
