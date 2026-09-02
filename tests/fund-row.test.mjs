import test from "node:test";
import assert from "node:assert/strict";
import { rowToFund, fundToRow, parseDate } from "../lib/fundRow.mjs";

const row = {
  code: "003244", name: "摩根中国世纪混合(QDII)美元现钞", nav: 1, accum_nav: 0.1468, nav_date: null,
  score: null, score_label: "数据不足", updated_at: "2026-09-02T02:32:46Z",
};

test("rowToFund：没有净值日期的净值当作缺失（东财对美元份额只回占位值 1，2026-09-02 库里 003244/003245）", () => {
  const f = rowToFund(row);
  assert.equal(f.nav, null);
  assert.equal(f.accumNav, null);
  assert.equal(f.date, "");
});

test("rowToFund：有净值日期时净值原样保留", () => {
  const f = rowToFund({ ...row, nav_date: "2026-09-01", nav: 1.2345, accum_nav: 2.1 });
  assert.equal(f.nav, 1.2345);
  assert.equal(f.accumNav, 2.1);
  assert.equal(f.date, "2026-09-01");
});

test("fundToRow：净值日期缺失时不写入净值（写入侧同一规则）", () => {
  const r = fundToRow({ code: "003244", name: "x", nav: 1, accumNav: 0.1468, date: "" });
  assert.equal(r.nav, null);
  assert.equal(r.accum_nav, null);
  assert.equal(r.nav_date, null);
  const ok = fundToRow({ code: "003243", name: "y", nav: 1.845, accumNav: 2.3, date: "2026/9/1" });
  assert.equal(ok.nav, 1.845);
  assert.equal(ok.nav_date, "2026-09-01");
  assert.equal(parseDate("2026-9-1"), "2026-09-01");
});
