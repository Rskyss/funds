import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCompanyTable } from "../lib/purchaseGuide.mjs";

// 官网对照表本身的体检：格式对、只放 https、不重复、48 家都在（2026-09-03 探针得到的 QDII 基金公司集合）
const raw = JSON.parse(readFileSync(new URL("../lib/data/fund-companies.json", import.meta.url), "utf8"));
const EXPECTED_IDS = ["80000220","80000221","80000222","80000223","80000224","80000225","80000226","80000227","80000228","80000229","80000230","80000231","80000233","80000235","80000236","80000238","80000239","80000240","80000243","80000246","80000248","80000250","80000251","80036782","80041198","80044515","80045188","80048088","80048752","80049689","80050229","80053708","80055334","80064225","80064562","80065113","80065990","80066470","80067635","80091787","80145102","80147736","80156175","80168726","80280395","80356155","80380794","80391977"];

test("对照表：带核实日期，48 家 QDII 基金公司一家不少、无多余", () => {
  assert.match(raw.verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(raw.companies).sort(), [...EXPECTED_IDS].sort());
});

test("对照表：每条有名称；site 要么是 https 绝对地址，要么为 null 并写明原因；域名不重复", () => {
  const sites = [];
  for (const [id, c] of Object.entries(raw.companies)) {
    assert.match(id, /^\d+$/, `id ${id}`);
    assert.ok(typeof c.name === "string" && c.name.trim(), `${id} 缺名称`);
    if (c.site === null) {
      assert.ok(typeof c.note === "string" && c.note.trim(), `${id} ${c.name} site 为空却没写原因`);
    } else {
      assert.match(c.site, /^https:\/\/[a-z0-9.-]+\.[a-z]+\/?$/i, `${id} ${c.name} site 不是 https 首页: ${c.site}`);
      sites.push(new URL(c.site).host.replace(/^www\./, ""));
    }
  }
  assert.equal(new Set(sites).size, sites.length, "有重复域名");
});

test("对照表：服务端读到的就是这份文件（loadCompanyTable 默认路径）", () => {
  const t = loadCompanyTable();
  assert.equal(Object.keys(t).length, 48);
  assert.equal(t["80055334"].site, "https://www.huatai-pb.com/");
});
