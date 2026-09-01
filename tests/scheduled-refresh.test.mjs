import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "scheduled-refresh.mjs");

function runScript(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, ...env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => resolve({ code, out, err }));
  });
}

function mock(handler) {
  return new Promise((resolve) => {
    const srv = createServer(handler);
    srv.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test("刷新脚本：带 token，服务端延迟很久才回响应头也能等到（不受 fetch 5 分钟限制）", async () => {
  let gotToken = null;
  const { srv, base } = await mock((req, res) => {
    gotToken = req.headers["x-refresh-token"];
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ total: 5, fetchedAtText: "2026/9/1 07:00" }));
    }, 1500); // 模拟“跑完才回”
  });
  try {
    const r = await runScript({ APP_BASE_URL: base, DATA_REFRESH_TOKEN: "t0k", REFRESH_TIMEOUT_MS: "10000" });
    assert.equal(r.code, 0, r.err);
    assert.equal(gotToken, "t0k");
    assert.match(r.out, /刷新完成：5 只基金/);
  } finally {
    srv.close();
  }
});

test("刷新脚本：冷却期跳过 → 退出码 0 并说明；401 → 退出码 1", async () => {
  let mode = "cooldown";
  const { srv, base } = await mock((req, res) => {
    if (mode === "cooldown") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ total: 5, fetchedAtText: "x", refreshSkipped: "cooldown" }));
    } else {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "刷新数据需要授权" }));
    }
  });
  try {
    const a = await runScript({ APP_BASE_URL: base, DATA_REFRESH_TOKEN: "t0k" });
    assert.equal(a.code, 0);
    assert.match(a.out, /刚刷新过/);
    mode = "401";
    const b = await runScript({ APP_BASE_URL: base, DATA_REFRESH_TOKEN: "" });
    assert.equal(b.code, 1);
    assert.match(b.err, /HTTP 401/);
  } finally {
    srv.close();
  }
});

test("刷新脚本：超过空闲超时则失败退出（退出码 1）", async () => {
  const { srv, base } = await mock(() => { /* 永不响应 */ });
  try {
    const r = await runScript({ APP_BASE_URL: base, DATA_REFRESH_TOKEN: "t0k", REFRESH_TIMEOUT_MS: "800" });
    assert.equal(r.code, 1);
    assert.match(r.err, /超过/);
  } finally {
    srv.closeAllConnections?.();
    srv.close();
  }
});
