import test from "node:test";
import assert from "node:assert/strict";
import { mergeFallbackInfo } from "../lib/eastmoney.mjs";

const basic = { name: "摩根中国世纪混合(QDII)美元现钞", category: "QDII", inception: "2016-09-20", nav: 1, accumNav: 0.1468, return1d: null, buyFee: 1.5, discountFee: 0.15, riskLevel: null };
const returns = { latestDate: "2026-09-01", latestNav: 1.845, latestAccumNav: 2.31, return1m: 1, return3m: 2, return6m: 3, return1y: 4, returnYtd: 5 };

test("mergeFallbackInfo：只有基本信息渠道、没有净值日期 → 不收占位净值，其它基本信息照收", () => {
  const fund = { code: "003244", source: "东方财富基金代码库" };
  const touched = mergeFallbackInfo(fund, basic, null);
  assert.equal(touched, true);
  assert.equal(fund.nav, undefined);
  assert.equal(fund.accumNav, undefined);
  assert.equal(fund.date, undefined);
  assert.equal(fund.inception, "2016-09-20");
  assert.equal(fund.buyFee, 1.5);
  assert.equal(fund.discountFee, 0.15);
  assert.ok(Number.isFinite(fund.ageYears));
});

test("mergeFallbackInfo：净值渠道给了日期 → 净值/日期/区间收益以净值渠道为准", () => {
  const fund = { code: "003243", source: "东方财富基金代码库" };
  const touched = mergeFallbackInfo(fund, basic, returns);
  assert.equal(touched, true);
  assert.equal(fund.date, "2026-09-01");
  assert.equal(fund.nav, 1.845);
  assert.equal(fund.accumNav, 2.31);
  assert.equal(fund.return1y, 4);
  assert.equal(fund.inception, "2016-09-20");
});

test("mergeFallbackInfo：净值渠道有日期但没给净值时，才用基本信息渠道的净值补", () => {
  const fund = { code: "x", source: "东方财富基金代码库" };
  mergeFallbackInfo(fund, { ...basic, nav: 1.1, accumNav: 1.2 }, { ...returns, latestNav: null, latestAccumNav: null });
  assert.equal(fund.date, "2026-09-01");
  assert.equal(fund.nav, 1.1);
  assert.equal(fund.accumNav, 1.2);
});

test("mergeFallbackInfo：两个渠道都没数据 → 返回 false，基金对象不动", () => {
  const fund = { code: "y", source: "东方财富基金代码库" };
  assert.equal(mergeFallbackInfo(fund, null, null), false);
  assert.deepEqual(fund, { code: "y", source: "东方财富基金代码库" });
});

test("mergeFallbackInfo：只有净值渠道、没有基本信息 → 日期/净值/收益照收，返回 true", () => {
  const fund = { code: "z", source: "东方财富基金代码库" };
  assert.equal(mergeFallbackInfo(fund, null, returns), true);
  assert.equal(fund.date, "2026-09-01");
  assert.equal(fund.nav, 1.845);
  assert.equal(fund.return1y, 4);
  assert.equal(fund.inception, undefined);
});
