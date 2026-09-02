// 首页列表排序。净值停更 / 数据不足（无评分）的基金在任何排序下都沉底——用户 2026-09-02 拍板：
// 按"近 1 年收益"等指标排序时，已清盘基金带着两个月前的旧成绩不该混进排行。
// 纯函数、不依赖 React，便于 node 单测（tests/frontend-sort.test.mjs）。

/** 0 = 正常参与排序；1 = 数据不足（无评分）；2 = 净值停更。数值越大越靠后 */
export function sinkRank(f) {
  if (f.navStaleDays) return 2;
  if (f.score === null || f.score === undefined) return 1;
  return 0;
}

export function compareFunds(a, b, sort, sortDir) {
  const sink = sinkRank(a) - sinkRank(b);
  if (sink) return sink;
  let diff = 0;
  if (sort === "return1y") diff = a.return1y - b.return1y;
  else if (sort === "sharpe") diff = a.sharpe - b.sharpe;
  else if (sort === "rating") diff = a.rating - b.rating;
  else if (sort === "aum") diff = a.aum - b.aum;
  return sortDir === "asc" ? diff : -diff;
}

export function sortFundList(list, sort, sortDir) {
  return [...list].sort((a, b) => compareFunds(a, b, sort, sortDir));
}
