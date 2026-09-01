import test from "node:test";
import assert from "node:assert/strict";
import { fillMissingFromPrevious, fillMissingForAll, STICKY_METRIC_FIELDS } from "../lib/mergeMetrics.mjs";

const prev = { code: "513310", aumBillion: 134.65, aumDate: "2026-06-30", sharpe1y: 2.1, volatility1y: 54.71, managerNames: "柳军、李沐阳", return1y: 100 };

test("本次抓取为空的字段沿用上次值，抓到的新值优先", () => {
  const next = { code: "513310", aumBillion: null, aumDate: null, sharpe1y: undefined, volatility1y: 60.2, managerNames: "", return1y: 123.61 };
  const { fund, restored } = fillMissingFromPrevious(next, prev);
  assert.equal(fund.aumBillion, 134.65);
  assert.equal(fund.aumDate, "2026-06-30");
  assert.equal(fund.sharpe1y, 2.1);
  assert.equal(fund.volatility1y, 60.2); // 新值优先
  assert.equal(fund.managerNames, "柳军、李沐阳");
  assert.equal(fund.return1y, 123.61); // 非指标字段不参与回退
  assert.deepEqual(restored.sort(), ["aumBillion", "aumDate", "managerNames", "sharpe1y"]);
});

test("库里也没有 / 没有旧记录时保持原样，且不修改入参", () => {
  const next = { code: "999999", aumBillion: null };
  const r1 = fillMissingFromPrevious(next, undefined);
  assert.equal(r1.fund, next);
  assert.deepEqual(r1.restored, []);
  const r2 = fillMissingFromPrevious(next, { code: "999999", aumBillion: null });
  assert.equal(r2.fund.aumBillion, null);
  assert.equal(next.aumBillion, null);
});

test("数字 0 是有效值，不会被旧值覆盖", () => {
  const { fund } = fillMissingFromPrevious({ code: "x", sharpe1y: 0 }, { code: "x", sharpe1y: 1.5 });
  assert.equal(fund.sharpe1y, 0);
});

test("批量回退给出统计口径", () => {
  const prevByCode = new Map([["a", { code: "a", aumBillion: 1 }], ["b", { code: "b", aumBillion: 2 }]]);
  const { funds, restoredFields, restoredFunds } = fillMissingForAll(
    [{ code: "a", aumBillion: null }, { code: "b", aumBillion: 5 }, { code: "c", aumBillion: null }],
    prevByCode,
  );
  assert.equal(funds[0].aumBillion, 1);
  assert.equal(funds[1].aumBillion, 5);
  assert.equal(funds[2].aumBillion, null);
  assert.equal(restoredFields, 1);
  assert.equal(restoredFunds, 1);
  const withField = fillMissingForAll([{ code: "a", aumBillion: null, sharpe1y: null }], new Map([["a", { aumBillion: 1, sharpe1y: 2 }]]));
  assert.deepEqual(withField.restoredByField, { aumBillion: 1, sharpe1y: 1 });
  assert.ok(STICKY_METRIC_FIELDS.includes("sharpe1y"));
});
