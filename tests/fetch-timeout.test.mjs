import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fetchWithTimeout } from "../lib/fetchTimeout.mjs";

function startServer(handler) {
  return new Promise((resolve) => {
    const srv = createServer(handler);
    srv.listen(0, "127.0.0.1", () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test("fetchWithTimeout：上游挂起时按超时中断，错误 name 为 TimeoutError", async () => {
  const { srv, url } = await startServer(() => { /* 永不响应 */ });
  try {
    const started = Date.now();
    await assert.rejects(fetchWithTimeout(url, {}, 300), (err) => {
      assert.equal(err.name, "TimeoutError");
      assert.match(err.message, /请求超时/);
      return true;
    });
    assert.ok(Date.now() - started < 3000);
  } finally {
    srv.closeAllConnections?.();
    srv.close();
  }
});

test("fetchWithTimeout：正常响应原样返回；调用方自己的 AbortSignal 取消保持 AbortError", async () => {
  const { srv, url } = await startServer((req, res) => { res.end("ok"); });
  try {
    const res = await fetchWithTimeout(url, {}, 2000);
    assert.equal(await res.text(), "ok");
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(fetchWithTimeout(url, { signal: ctrl.signal }, 2000), (err) => err.name === "AbortError");
  } finally {
    srv.close();
  }
});
