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
