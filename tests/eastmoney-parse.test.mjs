import test from "node:test";
import assert from "node:assert/strict";
import { parseFundRow, RANK_ROW_MIN_FIELDS } from "../lib/eastmoney.mjs";

// 东财排行接口一行的样子（按位置取值，见 parseFundRow）
const FIELDS = [
  "000001", "华夏全球精选(QDII)", "HXQQJX", "2026-08-29", "1.2345", "1.5000",
  "0.12", "0.5", "1.2", "3.4", "5.6", "12.3", "20.1", "33.1", "8.8", "50.2",
  "2008-10-09", "", "", "1.50", "0.15", "", "",
];

test("parseFundRow：完整行解析出关键字段并带评分", () => {
  const fund = parseFundRow(FIELDS.join(","));
  assert.ok(fund);
  assert.equal(fund.code, "000001");
  assert.equal(fund.name, "华夏全球精选(QDII)");
  assert.equal(fund.nav, 1.2345);
  assert.equal(fund.return1y, 12.3);
  assert.equal(fund.buyFee, 1.5);
  assert.equal(fund.discountFee, 0.15);
  assert.equal(fund.inception, "2008-10-09");
  assert.equal(typeof fund.rawScore, "number");
});

test("parseFundRow：字段数不足（接口漂移）返回 null，而不是错位写入", () => {
  assert.ok(RANK_ROW_MIN_FIELDS >= 21);
  assert.equal(parseFundRow(FIELDS.slice(0, 15).join(",")), null);
  assert.equal(parseFundRow(""), null);
  assert.equal(parseFundRow(null), null);
});

test("parseFundRow：基金代码不是 6 位数字返回 null", () => {
  const bad = ["ABC123", ...FIELDS.slice(1)];
  assert.equal(parseFundRow(bad.join(",")), null);
});
