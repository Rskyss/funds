import test from "node:test";
import assert from "node:assert/strict";
import { buildPurchaseGuide, DISCLAIMER, ttfundUrl, loadCompanyTable } from "../lib/purchaseGuide.mjs";

// 官网对照表片段（真实文件 lib/data/fund-companies.json 由 T2 整理）
const TABLE = { "80055334": { name: "华泰柏瑞基金", site: "https://www.huatai-pb.com/" } };
const base = { code: "019454", companyId: "80055334", companyName: "华泰柏瑞基金" };

test("开放申购：能买，两条渠道（天天基金 + 公司官网），带免责声明", () => {
  const g = buildPurchaseGuide({ ...base, purchaseStatus: "开放" }, TABLE);
  assert.equal(g.mode, "open");
  assert.equal(g.canBuy, true);
  assert.equal(g.note, "开放申购，可通过以下渠道申购");
  assert.deepEqual(g.channels.map((c) => c.key), ["ttfund", "official"]);
  assert.equal(g.channels[0].label, "天天基金");
  assert.equal(g.channels[0].url, "https://fund.eastmoney.com/019454.html");
  assert.equal(g.channels[1].label, "华泰柏瑞基金官网");
  assert.equal(g.channels[1].url, "https://www.huatai-pb.com/");
  assert.equal(g.officialHint, null);
  assert.equal(g.disclaimer, DISCLAIMER);
  assert.ok(/本站不销售基金/.test(DISCLAIMER));
});

test("限购：文案带每日额度（沿用列表卡片的「100元 / 1万」写法），无额度写「大额限购」", () => {
  assert.equal(buildPurchaseGuide({ ...base, purchaseStatus: "限购", purchaseLimitYuan: 100 }, TABLE).note, "限购 100元/日，可通过以下渠道申购");
  assert.equal(buildPurchaseGuide({ ...base, purchaseStatus: "限购", purchaseLimitYuan: 10000 }, TABLE).note, "限购 1万/日，可通过以下渠道申购");
  const g = buildPurchaseGuide({ ...base, purchaseStatus: "限购", purchaseLimitYuan: null }, TABLE);
  assert.equal(g.mode, "limit");
  assert.equal(g.canBuy, true);
  assert.equal(g.note, "大额限购，可通过以下渠道申购");
});

test("场内 ETF：提示去券商 App 用代码买卖，链接仍可点但说明仅供查看", () => {
  const g = buildPurchaseGuide({ ...base, code: "513310", purchaseStatus: "场内交易" }, TABLE);
  assert.equal(g.mode, "exchange");
  assert.equal(g.canBuy, true);
  assert.equal(g.note, "场内基金，请在券商 App 输入代码 513310 买卖；以下链接仅供查看资料");
  assert.equal(g.channels[0].url, "https://fund.eastmoney.com/513310.html");
});

test("暂停申购 / 封闭期：不能买，按钮置灰，文案说明", () => {
  const p = buildPurchaseGuide({ ...base, purchaseStatus: "暂停" }, TABLE);
  assert.equal(p.mode, "paused");
  assert.equal(p.canBuy, false);
  assert.equal(p.note, "当前暂停申购，暂不能买入");
  assert.equal(p.channels.length, 2);
  const c = buildPurchaseGuide({ ...base, purchaseStatus: "封闭" }, TABLE);
  assert.equal(c.mode, "closed");
  assert.equal(c.canBuy, false);
  assert.equal(c.note, "封闭期内暂不能申购");
});

test("申购状态缺失：按无数据处理，仍给渠道，让渠道页面说话", () => {
  for (const st of [null, undefined, "", "   "]) {
    const g = buildPurchaseGuide({ ...base, purchaseStatus: st }, TABLE);
    assert.equal(g.mode, "unknown");
    assert.equal(g.canBuy, true);
    assert.equal(g.note, "申购状态暂无数据，请以渠道页面为准");
  }
});

test("申购状态有值但不在已知集合：原样告诉用户，不谎称「暂无数据」", () => {
  const g = buildPurchaseGuide({ ...base, purchaseStatus: "其它状态" }, TABLE);
  assert.equal(g.mode, "unknown");
  assert.equal(g.canBuy, true);
  assert.equal(g.note, "当前状态「其它状态」，请以渠道页面为准");
});

test("认购期（新基金募集中）：能买，文案用「认购」；状态串两端空白不影响", () => {
  const g = buildPurchaseGuide({ ...base, code: "027450", purchaseStatus: " 认购期 " }, TABLE);
  assert.equal(g.mode, "subscribe");
  assert.equal(g.canBuy, true);
  assert.equal(g.note, "认购期内，可通过以下渠道认购");
});

test("官网只接受 https 绝对地址：javascript:、裸域名、http 都按缺失处理", () => {
  for (const site of ["javascript:alert(1)", "www.huatai-pb.com", "http://www.huatai-pb.com/", "", null, 123]) {
    const g = buildPurchaseGuide({ ...base, purchaseStatus: "开放" }, { "80055334": { name: "华泰柏瑞基金", site } });
    assert.deepEqual(g.channels.map((c) => c.key), ["ttfund"], `site=${site}`);
    assert.equal(g.officialHint, "基金公司官网：请搜索「华泰柏瑞基金」");
  }
});

test("对照表条目没写名称、库里也没公司名时按钮兜底叫「基金公司官网」，不出现 null", () => {
  const g = buildPurchaseGuide({ code: "019454", companyId: "80055334", purchaseStatus: "开放" }, { "80055334": { site: "https://www.huatai-pb.com/" } });
  assert.equal(g.channels[1].label, "基金公司官网");
});

test("对照表文件缺失时按空表处理（生产上 T2 文件未到位也不报错）", () => {
  assert.deepEqual(loadCompanyTable("/nonexistent/fund-companies.json"), {});
});

test("公司不在对照表：只给天天基金，官网位置给「请搜索」提示，绝不猜链接", () => {
  const g = buildPurchaseGuide({ ...base, companyId: "1", companyName: "某某基金", purchaseStatus: "开放" }, TABLE);
  assert.deepEqual(g.channels.map((c) => c.key), ["ttfund"]);
  assert.equal(g.officialHint, "基金公司官网：请搜索「某某基金」");
  // 对照表有条目但没写官网，同样按缺失处理
  const g2 = buildPurchaseGuide({ ...base, purchaseStatus: "开放" }, { "80055334": { name: "华泰柏瑞基金", site: null } });
  assert.deepEqual(g2.channels.map((c) => c.key), ["ttfund"]);
  assert.equal(g2.officialHint, "基金公司官网：请搜索「华泰柏瑞基金」");
  // 连公司名都没有：不出提示
  const g3 = buildPurchaseGuide({ code: "019454", purchaseStatus: "开放" }, TABLE);
  assert.deepEqual(g3.channels.map((c) => c.key), ["ttfund"]);
  assert.equal(g3.officialHint, null);
});

test("官网按钮名称以对照表为准（库里的公司名可能是旧名）", () => {
  const g = buildPurchaseGuide({ ...base, companyName: "旧名基金", purchaseStatus: "开放" }, TABLE);
  assert.equal(g.channels[1].label, "华泰柏瑞基金官网");
});

test("基金代码非法（非 6 位数字）返回 null，不拼出错误链接", () => {
  assert.equal(buildPurchaseGuide({ code: "abc", purchaseStatus: "开放" }, TABLE), null);
  assert.equal(buildPurchaseGuide({ code: "1234567", purchaseStatus: "开放" }, TABLE), null);
  assert.equal(buildPurchaseGuide({ purchaseStatus: "开放" }, TABLE), null);
  assert.equal(buildPurchaseGuide(null, TABLE), null);
  assert.equal(ttfundUrl("019454"), "https://fund.eastmoney.com/019454.html");
});

import { companiesMissingSite } from "../lib/purchaseGuide.mjs";

test("companiesMissingSite：找出没有官网对照（或对照不是 https）的公司，按基金数排序、去重、忽略无 id 的行", () => {
  const rows = [
    { company_id: "1", company_name: "甲基金" }, { company_id: "1", company_name: "甲基金" },
    { company_id: "2", company_name: "乙基金" },
    { company_id: "3", company_name: "丙基金" }, { company_id: "3", company_name: "丙基金" }, { company_id: "3", company_name: "丙基金" },
    { company_id: null, company_name: null }, { company_id: "", company_name: "空" },
  ];
  const table = { "1": { name: "甲基金", site: "https://a.example" }, "2": { name: "乙基金", site: "http://b.example" } };
  assert.deepEqual(companiesMissingSite(rows, table), [
    { id: "3", name: "丙基金", funds: 3 },
    { id: "2", name: "乙基金", funds: 1 },
  ]);
  assert.deepEqual(companiesMissingSite([], table), []);
  assert.deepEqual(companiesMissingSite(null, null), []);
});
