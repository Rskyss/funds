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

import { parseAssetAllocationHtml } from "../lib/eastmoney.mjs";

const tableWith = (headers, rows) => `<html><table class="w782 comm tzxq"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></html>`;

test("资产配置表按表头取列：ETF 没有「存托凭证」列时净资产不再错位成 0（修复：详情页净资产全显示 0.00 亿）", () => {
  const etf = tableWith(["报告期", "股票占净比", "债券占净比", "现金占净比", "净资产（亿元）"], [["2026-06-30", "98.58%", "---", "1.55%", "134.65"]]);
  const rows = parseAssetAllocationHtml(etf);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, "2026-06-30");
  assert.equal(rows[0].stock, 98.58);
  assert.equal(rows[0].bond, null);
  assert.equal(rows[0].cash, 1.55);
  assert.equal(rows[0].depositary, null);
  assert.equal(rows[0].netAssetBillion, 134.65);

  const active = tableWith(["报告期", "股票占净比", "债券占净比", "现金占净比", "存托凭证占净比", "净资产（亿元）"], [["2026-06-30", "83.41%", "---", "6.22%", "5.73%", "30.27"], ["2026-03-31", "83.75%", "---", "6.29%", "3.58%", "25.69"]]);
  const rows2 = parseAssetAllocationHtml(active);
  assert.equal(rows2.length, 2);
  assert.equal(rows2[0].depositary, 5.73);
  assert.equal(rows2[0].netAssetBillion, 30.27);
  assert.equal(rows2[1].netAssetBillion, 25.69);
});

test("资产配置表缺失或表头缺「报告期」时返回空数组", () => {
  assert.deepEqual(parseAssetAllocationHtml("<html><p>无</p></html>"), []);
  assert.deepEqual(parseAssetAllocationHtml(tableWith(["日期", "股票"], [["2026-06-30", "1"]])), []);
});
