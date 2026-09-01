import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { HttpError, clientIp, isLoopbackDirect, resolvePublicPath, safeEqual, isUuid } from "../lib/http.mjs";

const PUBLIC = path.resolve("/srv/app/public");

test("resolvePublicPath：正常路径落在 public 内，根路径映射 index.html", () => {
  assert.equal(resolvePublicPath(PUBLIC, "/"), path.join(PUBLIC, "index.html"));
  assert.equal(resolvePublicPath(PUBLIC, "/assets/app.js"), path.join(PUBLIC, "assets", "app.js"));
  assert.equal(resolvePublicPath(PUBLIC, "/admin"), path.join(PUBLIC, "admin"));
});

test("resolvePublicPath：同前缀兄弟目录、编码的 ..、NUL 全部拒绝（旧守卫的漏洞）", () => {
  assert.equal(resolvePublicPath(PUBLIC, "/..%2fpublic_legacy/index.html"), null);
  assert.equal(resolvePublicPath(PUBLIC, "/../public_legacy/index.html"), null);
  assert.equal(resolvePublicPath(PUBLIC, "/..%2f..%2f.env"), null);
  assert.equal(resolvePublicPath(PUBLIC, "/a%00b"), null);
  assert.equal(resolvePublicPath(PUBLIC, "/%E0%A4%A"), null); // 非法编码
});

test("clientIp：优先 X-Forwarded-For 第一段，其次 socket 地址（去 ::ffff: 前缀）", () => {
  assert.equal(clientIp({ headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } }), "1.2.3.4");
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: "::ffff:9.9.9.9" } }), "9.9.9.9");
  assert.equal(clientIp({ headers: {}, socket: {} }), "unknown");
});

test("isLoopbackDirect：只有无 XFF 且来自回环地址才算本机直连", () => {
  assert.equal(isLoopbackDirect({ headers: {}, socket: { remoteAddress: "127.0.0.1" } }), true);
  assert.equal(isLoopbackDirect({ headers: { "x-forwarded-for": "1.1.1.1" }, socket: { remoteAddress: "127.0.0.1" } }), false);
  assert.equal(isLoopbackDirect({ headers: {}, socket: { remoteAddress: "10.0.0.5" } }), false);
});

test("safeEqual / isUuid / HttpError", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual(undefined, ""), true);
  assert.equal(isUuid("5b2f0d7e-2b6c-4b6a-9d1e-0c1f2a3b4c5d"), true);
  assert.equal(isUuid("not-a-uuid"), false);
  const e = new HttpError(413, "太大", { code: "BIG" });
  assert.equal(e.status, 413);
  assert.equal(e.message, "太大");
  assert.deepEqual(e.extra, { code: "BIG" });
  assert.ok(e instanceof Error);
});
