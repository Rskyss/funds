import test from "node:test";
import assert from "node:assert/strict";
import { isValidNavRow } from "../lib/navValidation.mjs";

const NOW = Date.UTC(2026, 8, 1); // 2026-09-01

test("isValidNavRow：正常净值行通过", () => {
  assert.equal(isValidNavRow({ nav: 1.2345, nav_date: "2026-08-29" }, NOW), true);
  assert.equal(isValidNavRow({ nav: "0.98", nav_date: "2026-09-02" }, NOW), true); // 时区导致的“明天”放行
});

test("isValidNavRow：净值为 0 / 负数 / 非数 / 离谱大 被拒", () => {
  assert.equal(isValidNavRow({ nav: 0, nav_date: "2026-08-29" }, NOW), false);
  assert.equal(isValidNavRow({ nav: -1, nav_date: "2026-08-29" }, NOW), false);
  assert.equal(isValidNavRow({ nav: null, nav_date: "2026-08-29" }, NOW), false);
  assert.equal(isValidNavRow({ nav: "abc", nav_date: "2026-08-29" }, NOW), false);
  assert.equal(isValidNavRow({ nav: 1e9, nav_date: "2026-08-29" }, NOW), false);
});

test("isValidNavRow：被 Array.filter 直接当回调（第二参是下标）时仍按当前时间判断——2026-09-01 生产回归", () => {
  const rows = Array.from({ length: 740 }, (_, i) => ({ nav: 1 + i / 1000, nav_date: "2026-08-31" }));
  assert.equal(rows.filter(isValidNavRow).length, 740);
  assert.equal(isValidNavRow({ nav: 1, nav_date: "2026-08-31" }, 0), true);
  assert.equal(isValidNavRow({ nav: 1, nav_date: "2026-08-31" }, undefined), true);
});

test("isValidNavRow：日期缺失 / 无法解析 / 未来 / 过早 被拒", () => {
  assert.equal(isValidNavRow({ nav: 1, nav_date: null }, NOW), false);
  assert.equal(isValidNavRow({ nav: 1, nav_date: "not-a-date" }, NOW), false);
  assert.equal(isValidNavRow({ nav: 1, nav_date: "2026-09-10" }, NOW), false);
  assert.equal(isValidNavRow({ nav: 1, nav_date: "1970-01-01" }, NOW), false);
});
