// 12 条用例回归（手工触发版）。
// 用法：node --env-file=.env scripts/test-agent-cases.mjs

const BASE = process.env.AGENT_TEST_BASE || "http://127.0.0.1:5173";

const cases = [
  // 筛选 4 条
  {
    id: "filter-1-eu-base",
    desc: "欧洲底仓",
    message: "找几只欧洲底仓基金",
    expect: {
      intent: ["filter"],
      planFilterRegionIncludes: "欧洲",
      planFilterRoleIncludes: "底仓候选",
      cardsRegionAll: "欧洲",
    },
  },
  {
    id: "filter-2-nasdaq-positive",
    desc: "近1年正收益的纳指",
    message: "近1年涨幅大于0的美国科技基金，按近1年排序",
    expect: {
      intent: ["filter"],
      planFilterRegionIncludes: "美国",
      cardsAllReturn1yPositive: true,
    },
  },
  {
    id: "filter-3-low-fee",
    desc: "费率最低的 5 只",
    message: "申购费打折后最低的 5 只 QDII 基金",
    expect: {
      intent: ["filter"],
      planSortIs: "discountFee",
      cardCountAtMost: 5,
    },
  },
  {
    id: "filter-4-hk-tech-3y",
    desc: "成立满3年的港股科技",
    message: "成立满 3 年的港股科技基金有哪些",
    expect: {
      intent: ["filter"],
      planFilterRegionIncludes: "港股",
      planFilterAgeYearsMinGe: 3,
    },
  },
  // 对比 2 条
  {
    id: "compare-1-two-de",
    desc: "000614 vs 513030",
    message: "000614 和 513030 这两只哪个更适合长期持有",
    expect: {
      intent: ["compare", "mixed"],
      codesIncludesAll: ["000614", "513030"],
      cardsExactCodes: ["000614", "513030"],
    },
  },
  {
    id: "compare-2-three-nasdaq",
    desc: "三只纳指对比",
    message: "对比 161130 040046 040047",
    expect: {
      intent: ["compare", "mixed"],
      codesCountGe: 3,
    },
  },
  // 概念 3 条
  {
    id: "concept-1-qdii-limit",
    desc: "QDII 限购",
    message: "QDII 限购是怎么回事",
    expect: { intent: ["concept"], replyNoFundCode: true, cardsLengthIs: 0 },
  },
  {
    id: "concept-2-tracking-error",
    desc: "跟踪误差",
    message: "跟踪误差是什么意思",
    expect: { intent: ["concept"], replyNoFundCode: true, cardsLengthIs: 0 },
  },
  {
    id: "concept-3-premium",
    desc: "场内溢价",
    message: "场内ETF溢价是什么风险",
    expect: { intent: ["concept"], replyNoFundCode: true, cardsLengthIs: 0 },
  },
  // 事件 2 条
  {
    id: "event-1-nasdaq-drop",
    desc: "纳指为什么跌",
    message: "纳指最近为什么跌",
    expect: { intent: ["event", "mixed"] },
  },
  {
    id: "event-2-usd-cny",
    desc: "美元兑人民币对 QDII",
    message: "最近美元兑人民币走势对 QDII 基金有什么影响",
    expect: { intent: ["event", "mixed", "concept"] },
  },
  // 多轮 1 条
  {
    id: "multi-1-followup",
    desc: "先筛欧洲再追问费率最低",
    multiTurn: [
      { message: "找几只欧洲底仓基金", expect: { intent: ["filter"] } },
      {
        message: "这里面费率最低的是哪一只",
        expect: {
          intent: ["filter", "compare", "mixed"],
          replyMentionsAnyCode: ["000614", "015016", "159561", "513030"],
        },
      },
    ],
  },
];

function check(name, ok, detail = "") {
  return { name, ok, detail };
}

function evalExpect(exp, resp) {
  const checks = [];
  const plan = resp.plan || {};
  const cards = resp.cards || [];
  const reply = String(resp.reply || "");

  if (exp.intent) checks.push(check("intent", exp.intent.includes(plan.intent), `got ${plan.intent}`));

  if (exp.planFilterRegionIncludes) {
    const arr = plan.filter?.region || [];
    checks.push(check("filter.region", arr.includes(exp.planFilterRegionIncludes), JSON.stringify(arr)));
  }
  if (exp.planFilterRoleIncludes) {
    const arr = plan.filter?.role || [];
    checks.push(check("filter.role", arr.includes(exp.planFilterRoleIncludes), JSON.stringify(arr)));
  }
  if (exp.planSortIs) checks.push(check("filter.sort", plan.filter?.sort === exp.planSortIs, plan.filter?.sort));
  if (typeof exp.planFilterAgeYearsMinGe === "number") {
    const v = plan.filter?.ageYearsMin;
    checks.push(check("filter.ageYearsMin>=" + exp.planFilterAgeYearsMinGe, typeof v === "number" && v >= exp.planFilterAgeYearsMinGe, String(v)));
  }
  if (exp.cardsRegionAll) {
    const allMatch = cards.length > 0 && cards.every((c) => c.region === exp.cardsRegionAll);
    checks.push(check("cards all region", allMatch, JSON.stringify(cards.map((c) => c.region))));
  }
  if (exp.cardsAllReturn1yPositive) {
    const allPositive = cards.length > 0 && cards.every((c) => typeof c.return1y === "number" && c.return1y > 0);
    checks.push(check("cards return1y>0", allPositive, JSON.stringify(cards.map((c) => c.return1y))));
  }
  if (typeof exp.cardCountAtMost === "number") {
    checks.push(check("cardCount<=" + exp.cardCountAtMost, cards.length <= exp.cardCountAtMost, String(cards.length)));
  }
  if (typeof exp.cardsLengthIs === "number") {
    checks.push(check("cards.length==" + exp.cardsLengthIs, cards.length === exp.cardsLengthIs, String(cards.length)));
  }
  if (exp.codesIncludesAll) {
    const codes = plan.codes || [];
    const ok = exp.codesIncludesAll.every((c) => codes.includes(c));
    checks.push(check("plan.codes superset", ok, JSON.stringify(codes)));
  }
  if (exp.cardsExactCodes) {
    const codes = cards.map((c) => c.code).sort();
    const expected = [...exp.cardsExactCodes].sort();
    checks.push(check("cards exact codes", JSON.stringify(codes) === JSON.stringify(expected), JSON.stringify(codes)));
  }
  if (typeof exp.codesCountGe === "number") {
    const codes = plan.codes || [];
    checks.push(check("plan.codes>=" + exp.codesCountGe, codes.length >= exp.codesCountGe, String(codes.length)));
  }
  if (exp.replyNoFundCode) {
    const codesInReply = (reply.match(/\b\d{6}\b/g) || []);
    checks.push(check("reply no 6-digit code", codesInReply.length === 0, codesInReply.join(",")));
  }
  if (Array.isArray(exp.replyMentionsAnyCode)) {
    const hit = exp.replyMentionsAnyCode.some((c) => reply.includes(c));
    checks.push(check("reply mentions any code", hit, JSON.stringify(exp.replyMentionsAnyCode)));
  }
  return checks;
}

async function chat(message, sessionId) {
  const start = Date.now();
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, sessionId }),
  });
  const data = await res.json();
  data._latencyMs = Date.now() - start;
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function runCase(c) {
  if (c.multiTurn) {
    let sessionId = null;
    const allChecks = [];
    for (let i = 0; i < c.multiTurn.length; i++) {
      const turn = c.multiTurn[i];
      const resp = await chat(turn.message, sessionId);
      sessionId = resp.sessionId;
      const checks = evalExpect(turn.expect, resp);
      allChecks.push({ turn: i + 1, latencyMs: resp._latencyMs, intent: resp.plan?.intent, checks, reply: resp.reply.slice(0, 160) });
    }
    return allChecks;
  } else {
    const resp = await chat(c.message);
    const checks = evalExpect(c.expect, resp);
    return [{ latencyMs: resp._latencyMs, intent: resp.plan?.intent, cards: resp.cards?.length || 0, checks, reply: resp.reply.slice(0, 220) }];
  }
}

(async () => {
  console.log(`# Agent 用例回归 @ ${BASE}\n`);
  let pass = 0, fail = 0;
  for (const c of cases) {
    process.stdout.write(`[${c.id}] ${c.desc} ... `);
    try {
      const turns = await runCase(c);
      const allOk = turns.every((t) => t.checks.every((ck) => ck.ok));
      if (allOk) { pass++; console.log("PASS"); }
      else { fail++; console.log("FAIL"); }
      for (const t of turns) {
        console.log(`  turn${t.turn || 1}  ${t.latencyMs}ms  intent=${t.intent}  cards=${t.cards || 0}`);
        for (const ck of t.checks) {
          console.log(`    ${ck.ok ? "v" : "x"} ${ck.name}${ck.ok ? "" : "  =>  " + ck.detail}`);
        }
        console.log(`    reply: ${t.reply.replace(/\n/g, " ⏎ ")}`);
      }
    } catch (err) {
      fail++;
      console.log(`ERROR: ${err.message}`);
    }
    console.log();
  }
  console.log(`# Summary: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
