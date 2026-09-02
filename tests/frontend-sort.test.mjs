import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

// 生产服务器只部署构建产物 public/、没有 frontend/ 源码：那里这两条自动跳过（本地与发版前必跑）
const modUrl = new URL("../frontend/src/sortFunds.js", import.meta.url);
const available = existsSync(fileURLToPath(modUrl));
const { sortFundList, sinkRank } = available ? await import(modUrl.href) : {};
const skip = available ? false : "frontend 源码未部署（服务器环境）";

const mk = (code, return1y, extra = {}) => ({ code, return1y, sharpe: return1y / 10, rating: 3, aum: 10, score: 60, navStaleDays: null, ...extra });
const list = [
  mk("stale", 30, { navStaleDays: 43, score: null }),       // 停更：旧收益很高
  mk("nodata", 0, { score: null }),                          // 数据不足：前端把缺收益当 0
  mk("a", 12),
  mk("b", -5),
  mk("c", 25),
];

test("列表排序：净值停更和数据不足的基金在任何排序下都沉底（先数据不足、再停更）", { skip }, () => {
  assert.deepEqual(sortFundList(list, "return1y", "desc").map((f) => f.code), ["c", "a", "b", "nodata", "stale"]);
  assert.deepEqual(sortFundList(list, "return1y", "asc").map((f) => f.code), ["b", "a", "c", "nodata", "stale"]);
  assert.deepEqual(sortFundList(list, "sharpe", "desc").map((f) => f.code), ["c", "a", "b", "nodata", "stale"]);
  assert.equal(sinkRank(mk("x", 1)), 0);
  assert.equal(sinkRank(mk("x", 1, { score: null })), 1);
  assert.equal(sinkRank(mk("x", 1, { navStaleDays: 20, score: null })), 2);
});

test("列表排序：不修改入参数组", { skip }, () => {
  const before = list.map((f) => f.code);
  sortFundList(list, "aum", "desc");
  assert.deepEqual(list.map((f) => f.code), before);
});
