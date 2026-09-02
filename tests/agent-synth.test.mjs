import test from "node:test";
import assert from "node:assert/strict";
import { fundLine, pickCards } from "../lib/agent/synth.mjs";

const stale = { code: "018336", name: "华夏恒生中国企业ETF发起式联接(QDII)A", region: "港股", theme: "综合配置", role: "底仓候选", return3m: -6.43, return1y: -10.46, returnYtd: 1, score: null, scoreLabel: "净值停更", navStaleDays: 43, navDate: "2026-07-20", purchaseStatus: "暂停" };
const normal = { ...stale, code: "159660", name: "纳指ETF汇添富", score: 88, scoreLabel: "高关注", navStaleDays: null, navDate: "2026-08-31" };

test("fundLine：净值停更的基金给模型的上下文里注明停更天数、净值日期和不推荐", () => {
  const line = fundLine(stale);
  assert.ok(line.includes("净值停更 43 天"), line);
  assert.ok(line.includes("2026-07-20"), line);
  assert.ok(line.includes("不要推荐"), line);
  assert.ok(!fundLine(normal).includes("停更"));
});

test("pickCards：聊天卡片带 navStaleDays 与 navDate，前端据此显示「净值停更」", () => {
  const cards = pickCards({ funds: [stale, normal] });
  const s = cards.find((c) => c.code === "018336");
  assert.equal(s.navStaleDays, 43);
  assert.equal(s.navDate, "2026-07-20");
  assert.equal(cards.find((c) => c.code === "159660").navStaleDays, null);
});
