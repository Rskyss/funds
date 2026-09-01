import test from "node:test";
import assert from "node:assert/strict";
import { createRetryingFetch, isTransientDbResponse, isTransientNetworkError } from "../lib/retryFetch.mjs";

const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), method: init?.method || "GET" });
    const step = script.shift();
    if (step instanceof Error) throw step;
    return step;
  };
  fn.calls = calls;
  return fn;
}

test("Supabase 瞬时 401「JWT issued at future」：重试一次后拿到正常结果（POST 也重试，因为 401 时请求未执行）", async () => {
  const base = fakeFetch([
    jsonRes(401, { message: "JWT issued at future", code: "PGRST301" }),
    jsonRes(201, [{ id: 1 }]),
  ]);
  const f = createRetryingFetch(base, { delayMs: 1 });
  const res = await f("https://x.supabase.co/rest/v1/events", { method: "POST", body: "[]" });
  assert.equal(res.status, 201);
  assert.equal(base.calls.length, 2);
});

test("普通 401（密钥错）不重试，原样返回", async () => {
  const base = fakeFetch([jsonRes(401, { message: "Invalid API key" })]);
  const f = createRetryingFetch(base, { delayMs: 1 });
  const res = await f("https://x/rest/v1/funds", { method: "GET" });
  assert.equal(res.status, 401);
  assert.equal(base.calls.length, 1);
});

test("网络层瞬断（fetch failed / terminated）：GET 重试一次，POST 不重试（避免重复写入）", async () => {
  const netErr = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_SOCKET" } });
  const okGet = fakeFetch([netErr(), jsonRes(200, [])]);
  const f1 = createRetryingFetch(okGet, { delayMs: 1 });
  const r1 = await f1("https://x/rest/v1/funds", { method: "GET" });
  assert.equal(r1.status, 200);
  assert.equal(okGet.calls.length, 2);

  const post = fakeFetch([netErr(), jsonRes(200, [])]);
  const f2 = createRetryingFetch(post, { delayMs: 1 });
  await assert.rejects(() => f2("https://x/rest/v1/events", { method: "POST", body: "[]" }), /fetch failed/);
  assert.equal(post.calls.length, 1);
});

test("只重试一次：连续两次瞬时 401 后把第二次响应交给调用方", async () => {
  const base = fakeFetch([
    jsonRes(401, { message: "JWT issued at future" }),
    jsonRes(401, { message: "JWT issued at future" }),
    jsonRes(200, []),
  ]);
  const f = createRetryingFetch(base, { delayMs: 1 });
  const res = await f("https://x/rest/v1/funds");
  assert.equal(res.status, 401);
  assert.equal(base.calls.length, 2);
});

test("判定函数：只有特定文案的 401 与网关 502/503/504 算瞬时", async () => {
  assert.equal(await isTransientDbResponse(jsonRes(401, { message: "JWT issued at future" })), true);
  assert.equal(await isTransientDbResponse(jsonRes(503, "upstream")), true);
  assert.equal(await isTransientDbResponse(jsonRes(401, { message: "Invalid API key" })), false);
  assert.equal(await isTransientDbResponse(jsonRes(400, { message: "bad" })), false);
  assert.equal(isTransientNetworkError(new TypeError("fetch failed")), true);
  assert.equal(isTransientNetworkError(new TypeError("terminated")), true);
  assert.equal(isTransientNetworkError(Object.assign(new Error("x"), { name: "AbortError" })), false);
});
