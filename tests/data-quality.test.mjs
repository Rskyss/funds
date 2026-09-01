import test from "node:test";
import assert from "node:assert/strict";
import { summarizeDataQuality, QUALITY_FIELDS } from "../lib/dataQuality.mjs";
import { isFresh } from "../lib/dataSchedule.mjs";

const full = { code: "1", nav: 1.2, aumBillion: 10, managerNames: "张三", sharpe1y: 1, volatility1y: 20, ratingMorningstar: 4, purchaseStatus: "开放", inception: "2020-01-01" };

test("全字段齐全时没有告警，缺失计数全 0", () => {
  const q = summarizeDataQuality([full, { ...full, code: "2" }]);
  assert.equal(q.total, 2);
  for (const k of Object.keys(QUALITY_FIELDS)) assert.equal(q.missing[k], 0);
  assert.deepEqual(q.warnings, []);
});

test("申购状态 / 成立日大面积为空要报警（这就是 2026-09-01 藏了两个月的问题）", () => {
  const funds = Array.from({ length: 10 }, (_, i) => ({ ...full, code: String(i), purchaseStatus: i < 2 ? "开放" : null, inception: i < 3 ? "2020-01-01" : "" }));
  const q = summarizeDataQuality(funds);
  assert.equal(q.missing.purchaseStatus, 8);
  assert.equal(q.missing.inception, 7);
  assert.ok(q.warnings.some((w) => w.includes("申购状态") && w.includes("8/10")), JSON.stringify(q.warnings));
  assert.ok(q.warnings.some((w) => w.includes("成立日")));
});

test("评级缺失是常态（多数基金无晨星评级），不算告警；规模缺 30% 以上才告警", () => {
  const funds = Array.from({ length: 10 }, (_, i) => ({ ...full, code: String(i), ratingMorningstar: null, aumBillion: i < 8 ? 1 : null }));
  const q = summarizeDataQuality(funds);
  assert.equal(q.missing.ratingMorningstar, 10);
  assert.equal(q.missing.aumBillion, 2);
  assert.deepEqual(q.warnings, []);
  const q2 = summarizeDataQuality(funds.map((f, i) => ({ ...f, aumBillion: i < 5 ? 1 : null })));
  assert.ok(q2.warnings.some((w) => w.includes("规模")));
});

test("空列表不报错", () => {
  const q = summarizeDataQuality([]);
  assert.equal(q.total, 0);
  assert.deepEqual(q.warnings, []);
});

test("isFresh：在有效期内为 true，过期 / 缺失 / 非法时间为 false", () => {
  const now = Date.parse("2026-09-01T00:00:00Z");
  const day = 86400_000;
  assert.equal(isFresh("2026-08-20T00:00:00Z", 30 * day, now), true);
  assert.equal(isFresh("2026-05-16T09:15:37Z", 30 * day, now), false);
  assert.equal(isFresh(null, 30 * day, now), false);
  assert.equal(isFresh("not-a-date", 30 * day, now), false);
});

import { splitDelisted, DELIST_GRACE_MS } from "../lib/dataQuality.mjs";

test("东财已不再返回的基金按更新时间识别：比最新一批晚 3 天以上没更新的隐藏，宽限期内保留", () => {
  const latest = "2026-09-01T09:20:27Z";
  const funds = [
    { code: "513310", updatedAt: latest },
    { code: "018336", updatedAt: "2026-09-01T09:20:27Z" },
    { code: "513600", updatedAt: "2026-05-15T10:39:20Z" },   // 5 月起东财不再返回
    { code: "027133", updatedAt: "2026-07-03T23:01:36Z" },   // 7 月起不再返回
    { code: "000001", updatedAt: "2026-08-30T09:20:27Z" },   // 2 天内：某天抓失败的宽限
  ];
  const { active, delisted } = splitDelisted(funds);
  assert.deepEqual(delisted.map((f) => f.code).sort(), ["027133", "513600"]);
  assert.deepEqual(active.map((f) => f.code).sort(), ["000001", "018336", "513310"]);
  assert.equal(DELIST_GRACE_MS, 3 * 24 * 3600_000);
});

test("splitDelisted：缺更新时间的不隐藏；空列表 / 非数组不报错；不修改入参", () => {
  const funds = [{ code: "a", updatedAt: "2026-09-01T00:00:00Z" }, { code: "b" }];
  const r = splitDelisted(funds);
  assert.equal(r.active.length, 2);
  assert.equal(r.delisted.length, 0);
  assert.equal(funds.length, 2);
  assert.deepEqual(splitDelisted([]), { active: [], delisted: [] });
  assert.deepEqual(splitDelisted(null), { active: [], delisted: [] });
});
