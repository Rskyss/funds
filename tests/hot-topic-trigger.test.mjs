import test from "node:test";
import assert from "node:assert/strict";
import { detectTrigger, computeBoards, EVENT_THRESHOLD, SAME_EVENT_COOLDOWN_MS } from "../lib/agent/hotTopicTrigger.mjs";

const NOW = Date.parse("2026-09-01T08:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600_000).toISOString();
const boards = [
  { theme: "半导体", count: 9, avg1d: -3.0 },
  { theme: "科技成长", count: 150, avg1d: -0.98 },
];

test("板块异动且没有历史热议 → 触发", () => {
  const r = detectTrigger(boards, null, NOW);
  assert.equal(r.trigger, true);
  assert.match(r.reason, /板块异动：半导体 -3%/);
  assert.equal(r.extremeBoard.theme, "半导体");
});

test("同一板块 24 小时内已经生成过 → 不再触发（修复：每次重启/刷新都重新生成）", () => {
  const last = { triggerReason: "板块异动：半导体 -3%", createdAt: hoursAgo(2) };
  const r = detectTrigger(boards, last, NOW);
  assert.equal(r.trigger, false);
  assert.match(r.reason, /24 小时内/);
});

test("同一板块但上次生成已超过 24 小时 → 允许再生成", () => {
  const last = { triggerReason: "板块异动：半导体 -2.8%", createdAt: hoursAgo(30) };
  assert.equal(detectTrigger(boards, last, NOW).trigger, true);
});

test("换了板块异动（上次是半导体，这次是医疗）→ 触发", () => {
  const b = [{ theme: "医疗健康", count: 61, avg1d: 3.1 }];
  const last = { triggerReason: "板块异动：半导体 -3%", createdAt: hoursAgo(1) };
  const r = detectTrigger(b, last, NOW);
  assert.equal(r.trigger, true);
  assert.match(r.reason, /医疗健康 \+3.1%/);
});

test("没有板块异动：超过 30 天兜底刷新，否则跳过", () => {
  const calm = [{ theme: "科技成长", count: 150, avg1d: 0.5 }];
  assert.equal(detectTrigger(calm, { triggerReason: "x", createdAt: hoursAgo(24 * 31) }, NOW).trigger, true);
  assert.equal(detectTrigger(calm, { triggerReason: "x", createdAt: hoursAgo(24 * 2) }, NOW).trigger, false);
  assert.equal(detectTrigger(calm, null, NOW).trigger, true); // 首次
});

test("computeBoards 按主题平均日涨跌，综合配置不参与，缺日涨幅的不计入均值", () => {
  const funds = [
    { theme: "半导体", return1d: -2 }, { theme: "半导体", return1d: -4 }, { theme: "半导体", return1d: null },
    { theme: "综合配置", return1d: 9 },
  ];
  const b = computeBoards(funds);
  assert.deepEqual(b, [{ theme: "半导体", count: 3, avg1d: -3 }]);
  assert.equal(EVENT_THRESHOLD, 2.5);
  assert.equal(SAME_EVENT_COOLDOWN_MS, 24 * 3600_000);
});
