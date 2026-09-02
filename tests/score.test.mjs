import test from "node:test";
import assert from "node:assert/strict";
import { computeRawScore, annualizedReturn3y, applyPercentileScores } from "../lib/eastmoney.mjs";

const base = {
  return3m: 5, return6m: 10, return1y: 20, returnYtd: 8, return3y: 33.1,
  ageYears: 5, risk: "中高", theme: "科技成长", role: "卫星配置", discountFee: null,
};

test("三年收益做年化：33.1% 累计 ≈ 10% 年化", () => {
  assert.ok(Math.abs(annualizedReturn3y(33.1) - 10) < 0.1);
  assert.equal(annualizedReturn3y(null), null);
});

test("删除品类偏好：美国宽基/底仓候选不再额外加分", () => {
  const wide = { ...base, theme: "美国宽基", role: "底仓候选" };
  assert.equal(computeRawScore(wide), computeRawScore(base));
});

test("重叠周期不再参与均值：改 returnYtd/return3m 不影响分数", () => {
  // return3m 仅在 < -8 时作为惩罚项，5 → 6 不应改变分数；returnYtd 完全退出公式
  const noisy = { ...base, returnYtd: 999, return3m: 6 };
  assert.equal(computeRawScore(noisy), computeRawScore(base));
});

test("1 年收益不再二次计权：拉高 return1y 只通过均值影响分数", () => {
  const a = computeRawScore(base);
  const b = computeRawScore({ ...base, return1y: 28 }); // +8 个点，只走均值：+8/3/2.8
  assert.ok(Math.abs((b - a) - 8 / 3 / 2.8) < 0.01);
});

function mk(theme, rawScore, code) {
  return { code, theme, rawScore };
}

test("百分位在同主题内计算，附带同类排名", () => {
  const funds = [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => mk("科技成长", i * 10, `A${i}`)),
    mk("债券收益", 5, "B1"),
    mk("债券收益", 99, "B2"),
  ];
  applyPercentileScores(funds);
  const topA = funds.find((f) => f.code === "A8");
  assert.equal(topA.score, 100);
  assert.equal(topA.label, "高关注");
  assert.equal(topA.peerRank, 1);
  assert.equal(topA.peerCount, 8);
  // 债券组只有 2 只：样本少，不给高关注标签
  const topB = funds.find((f) => f.code === "B2");
  assert.equal(topB.label, "同类样本少");
  assert.equal(topB.peerCount, 2);
  // 债券组第一名不再被科技组高分挤到低百分位（这是本次要修的核心问题）
  assert.equal(topB.peerRank, 1);
});

test("完全没有收益数据的基金不打分：score/label 为空，不占同类名次（修复：交银港股消费 A/C 无净值却得 82 分）", () => {
  const noData = { code: "027450", theme: "消费", return6m: null, return1y: null, return3y: null, return3m: null, ageYears: null, risk: "高", discountFee: null };
  assert.equal(computeRawScore(noData), null);
  const peers = [
    { code: "a", theme: "消费", return6m: -5, return1y: -10, return3y: null },
    { code: "b", theme: "消费", return6m: 2, return1y: 4, return3y: null },
    { code: "c", theme: "消费", return6m: 8, return1y: 12, return3y: null },
    noData,
  ];
  applyPercentileScores(peers);
  const nd = peers.find((f) => f.code === "027450");
  assert.equal(nd.score, null);
  assert.equal(nd.label, "数据不足");
  assert.equal(nd.peerRank, null);
  assert.equal(peers.find((f) => f.code === "c").peerCount, 3);
  assert.equal(peers.find((f) => f.code === "c").peerRank, 1);
});

test("净值停更的基金不打分：label 为「净值停更」，不占同类名次（018336 三年到期清盘、东财仍列着）", () => {
  const stale = { code: "018336", theme: "港股", date: "2026-07-20", return6m: -6, return1y: -10, return3y: null, return3m: -6, ageYears: 3.1, risk: "高", discountFee: null };
  const peers = [
    { code: "a", theme: "港股", date: "2026-09-01", return6m: -5, return1y: -10, return3y: null },
    { code: "b", theme: "港股", date: "2026-09-01", return6m: 2, return1y: 4, return3y: null },
    { code: "c", theme: "港股", date: "2026-08-31", return6m: 8, return1y: 12, return3y: null },
    stale,
  ];
  applyPercentileScores(peers);
  const s = peers.find((f) => f.code === "018336");
  assert.equal(s.navStaleDays, 43);
  assert.equal(s.score, null);
  assert.equal(s.label, "净值停更");
  assert.equal(s.peerRank, null);
  assert.equal(s.peerCount, null);
  assert.equal(peers.find((f) => f.code === "c").peerCount, 3);
  assert.equal(peers.find((f) => f.code === "a").peerRank, 3);
  // 没停更的基金 navStaleDays 为 null，且"数据不足"标签不受影响
  assert.equal(peers.find((f) => f.code === "a").navStaleDays, null);
});

test("既停更又没有收益数据的基金，标签以「净值停更」优先", () => {
  const peers = [
    { code: "a", theme: "港股", date: "2026-09-01", return6m: 1, return1y: 2, return3y: null },
    { code: "z", theme: "港股", date: "2026-07-01", return6m: null, return1y: null, return3y: null },
  ];
  applyPercentileScores(peers);
  assert.equal(peers[1].label, "净值停更");
  assert.equal(peers[1].score, null);
});
