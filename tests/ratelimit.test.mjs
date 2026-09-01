import test from "node:test";
import assert from "node:assert/strict";
import { rateLimit, _resetRateLimits } from "../lib/rateLimit.mjs";

test("rateLimit：窗口内超过 limit 次拒绝，并给出 retryAfterMs", () => {
  _resetRateLimits();
  for (let i = 0; i < 3; i++) {
    assert.equal(rateLimit("k1", { limit: 3, windowMs: 1000 }).allowed, true);
  }
  const r = rateLimit("k1", { limit: 3, windowMs: 1000 });
  assert.equal(r.allowed, false);
  assert.ok(r.retryAfterMs > 0 && r.retryAfterMs <= 1000);
  assert.equal(r.limit, 3);
});

test("rateLimit：不同 key 互不影响；默认参数可用", () => {
  _resetRateLimits();
  assert.equal(rateLimit("a", { limit: 1 }).allowed, true);
  assert.equal(rateLimit("a", { limit: 1 }).allowed, false);
  assert.equal(rateLimit("b", { limit: 1 }).allowed, true);
  assert.equal(rateLimit("c").allowed, true);
});
