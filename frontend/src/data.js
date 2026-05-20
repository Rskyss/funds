// Mock QDII fund data — realistic-feeling values
// Each sparkline is 60 points (~1y of weekly NAVs) generated deterministically.

function seedRand(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

function genSpark(seed, drift, vol, points = 60) {
  const rand = seedRand(seed);
  const arr = [];
  let v = 1;
  for (let i = 0; i < points; i += 1) {
    const noise = (rand() - 0.5) * vol;
    const d = drift / points;
    v = v * (1 + d + noise);
    arr.push(+v.toFixed(4));
  }
  // normalize so first ≈ 1
  const first = arr[0];
  return arr.map((x) => +(x / first).toFixed(4));
}

// Generate a calibrated random walk that ENDS near `targetReturn` (e.g. 0.32 = +32%)
// so the drawer NAV chart visually agrees with the listed 1Y return.
function genCalibratedSpark(seed, targetReturn, vol = 0.012, points = 60) {
  const rand = seedRand(seed);
  // first pass: pure noise walk
  const noise = [0];
  for (let i = 1; i < points; i += 1) {
    noise.push(noise[i - 1] + (rand() - 0.5) * vol);
  }
  // bridge to ensure last point equals desired log-return
  const target = Math.log(1 + targetReturn);
  const drift = (target - noise[points - 1]) / (points - 1);
  const series = noise.map((n, i) => Math.exp(n + drift * i));
  return series.map((x) => +x.toFixed(4));
}

const FUNDS = [
  {
    code: "161130", name: "易方达纳斯达克100ETF联接(QDII)",
    region: "美国", theme: "科技成长", role: "底仓候选", risk: "中",
    rating: 5, sharpe: 1.42, aum: 86.4, drawdown: -14.2,
    return3m: 8.2, return1y: 32.1, returnYtd: 18.3,
    status: "open",
    top3: [{c:"AAPL", p:9.1},{c:"MSFT", p:8.6},{c:"NVDA", p:7.9}],
    sparkSeed: 11, drift: 0.32, vol: 0.022,
    manager: "余海燕",
  },
  {
    code: "005698", name: "华夏全球科技先锋混合(QDII)",
    region: "全球", theme: "科技成长", role: "进攻仓", risk: "高",
    rating: 5, sharpe: 1.18, aum: 24.8, drawdown: -22.4,
    return3m: 12.5, return1y: 45.2, returnYtd: 22.1,
    status: "limit", limitYuan: 10000,
    top3: [{c:"NVDA", p:9.8},{c:"TSM", p:7.2},{c:"AVGO", p:6.4}],
    sparkSeed: 22, drift: 0.45, vol: 0.030,
    manager: "李湘杰",
  },
  {
    code: "270023", name: "广发全球精选股票(QDII)",
    region: "全球", theme: "大盘均衡", role: "底仓候选", risk: "中",
    rating: 4, sharpe: 0.96, aum: 52.1, drawdown: -11.8,
    return3m: 5.8, return1y: 24.6, returnYtd: 12.3,
    status: "open",
    top3: [{c:"MSFT", p:6.2},{c:"AAPL", p:5.8},{c:"GOOGL", p:5.1}],
    sparkSeed: 33, drift: 0.25, vol: 0.018,
    manager: "李耀柱",
  },
  {
    code: "161125", name: "易方达标普500ETF联接(QDII)",
    region: "美国", theme: "宽基指数", role: "底仓候选", risk: "中",
    rating: 5, sharpe: 1.31, aum: 124.6, drawdown: -10.5,
    return3m: 4.2, return1y: 18.7, returnYtd: 9.2,
    status: "open",
    top3: [{c:"AAPL", p:7.2},{c:"MSFT", p:6.8},{c:"NVDA", p:6.4}],
    sparkSeed: 44, drift: 0.19, vol: 0.014,
    manager: "范冰",
  },
  {
    code: "005225", name: "嘉实全球互联网股票(QDII)",
    region: "全球", theme: "科技成长", role: "进攻仓", risk: "高",
    rating: 4, sharpe: 1.05, aum: 18.2, drawdown: -18.6,
    return3m: 9.1, return1y: 38.5, returnYtd: 19.6,
    status: "open",
    top3: [{c:"META", p:8.2},{c:"GOOGL", p:7.8},{c:"AMZN", p:7.1}],
    sparkSeed: 55, drift: 0.38, vol: 0.026,
    manager: "张丹华",
  },
  {
    code: "513180", name: "华夏恒生科技ETF(QDII)",
    region: "港股", theme: "科技成长", role: "进攻仓", risk: "高",
    rating: 3, sharpe: 0.42, aum: 286.5, drawdown: -28.2,
    return3m: -3.2, return1y: -8.5, returnYtd: -2.1,
    status: "open",
    top3: [{c:"腾讯", p:8.4},{c:"美团", p:7.6},{c:"阿里巴巴", p:7.1}],
    sparkSeed: 66, drift: -0.08, vol: 0.028,
    manager: "徐猛",
  },
  {
    code: "159934", name: "易方达黄金ETF",
    region: "全球", theme: "贵金属", role: "配置仓", risk: "中",
    rating: 4, sharpe: 1.62, aum: 142.8, drawdown: -6.4,
    return3m: 2.1, return1y: 14.2, returnYtd: 8.9,
    status: "open",
    top3: [{c:"实物黄金", p:96.2},{c:"短期票据", p:2.8},{c:"现金", p:1.0}],
    sparkSeed: 77, drift: 0.14, vol: 0.012,
    manager: "成曦",
  },
  {
    code: "164824", name: "工银瑞信印度市场基金(QDII)",
    region: "印度", theme: "新兴市场", role: "进攻仓", risk: "高",
    rating: 4, sharpe: 0.88, aum: 9.6, drawdown: -16.8,
    return3m: 7.3, return1y: 22.8, returnYtd: 15.2,
    status: "limit", limitYuan: 1000,
    top3: [{c:"Reliance", p:7.4},{c:"HDFC", p:6.8},{c:"Infosys", p:5.2}],
    sparkSeed: 88, drift: 0.23, vol: 0.024,
    manager: "刘伟琳",
  },
  {
    code: "100055", name: "富国全球医疗保健混合(QDII)",
    region: "全球", theme: "医药健康", role: "配置仓", risk: "中",
    rating: 3, sharpe: 0.28, aum: 22.3, drawdown: -19.5,
    return3m: 1.2, return1y: 3.8, returnYtd: 0.9,
    status: "open",
    top3: [{c:"LLY", p:6.8},{c:"NVO", p:5.4},{c:"UNH", p:4.8}],
    sparkSeed: 99, drift: 0.04, vol: 0.018,
    manager: "张峰",
  },
  {
    code: "513520", name: "华泰柏瑞日经225ETF(QDII)",
    region: "日本", theme: "宽基指数", role: "配置仓", risk: "高",
    rating: 3, sharpe: 0.74, aum: 48.2, drawdown: -13.6,
    return3m: -2.8, return1y: 12.6, returnYtd: -1.2,
    status: "open",
    top3: [{c:"丰田", p:5.2},{c:"索尼", p:4.8},{c:"三菱UFJ", p:4.1}],
    sparkSeed: 101, drift: 0.13, vol: 0.020,
    manager: "柳军",
  },
  {
    code: "003243", name: "华夏大中华企业精选混合(QDII)",
    region: "大中华", theme: "大盘均衡", role: "底仓候选", risk: "中",
    rating: 4, sharpe: 0.91, aum: 14.7, drawdown: -15.4,
    return3m: 3.5, return1y: 19.2, returnYtd: 10.8,
    status: "open",
    top3: [{c:"台积电", p:8.1},{c:"腾讯", p:6.4},{c:"美团", p:5.8},],
    sparkSeed: 112, drift: 0.19, vol: 0.018,
    manager: "周克平",
  },
  {
    code: "006308", name: "国富全球科技互联网股票(QDII)",
    region: "全球", theme: "科技成长", role: "进攻仓", risk: "高",
    rating: 5, sharpe: 1.36, aum: 31.4, drawdown: -20.1,
    return3m: 11.2, return1y: 41.3, returnYtd: 24.5,
    status: "stop",
    top3: [{c:"NVDA", p:9.4},{c:"MSFT", p:8.2},{c:"AAPL", p:7.6}],
    sparkSeed: 123, drift: 0.41, vol: 0.028,
    manager: "狄星华",
  },
];

const KPIS = [
  {
    id: "total", label: "QDII 全市场基金", tag: "ALL",
    value: 482, unit: "只",
    delta: "+6 本周",
    deltaKind: "neutral",
    sparkSeed: 7, drift: 0.05, vol: 0.012,
  },
  {
    id: "stars", label: "晨星 4+ 星", tag: "★",
    value: 76, unit: "只",
    delta: "+3 月度",
    deltaKind: "up",
    sparkSeed: 17, drift: 0.08, vol: 0.014,
  },
  {
    id: "tech", label: "科技成长占比", tag: "%",
    value: 38, unit: "%",
    delta: "+2.4%",
    deltaKind: "up",
    sparkSeed: 27, drift: 0.07, vol: 0.010,
  },
  {
    id: "avg1y", label: "QDII 平均 1Y 回报", tag: "1Y",
    value: 14.6, unit: "%",
    delta: "跑赢沪深300 +9.2%",
    deltaKind: "up",
    sparkSeed: 37, drift: 0.15, vol: 0.018,
  },
];

const QUICK_CHIPS = [
  { id: "us-tech",   label: "美股科技",   region: "美国",  theme: "科技成长" },
  { id: "nasdaq100", label: "纳指100",    keyword: "纳指" },
  { id: "hk-tech",   label: "港股科技",   region: "港股",  theme: "科技成长" },
  { id: "gold",      label: "黄金主题",   theme: "贵金属" },
{ id: "attack",    label: "进攻型",     role: "进攻仓" },
  { id: "fivestar",  label: "晨星 5★",   rating: 5 },
  { id: "buyable",   label: "可申购",     status: "open" },
];

const TAPE = [
  { name: "Nasdaq", val: "19,847.32", pct: 1.42, seed: 5, drift: 0.04 },
  { name: "S&P 500", val: "5,978.11", pct: 0.81, seed: 15, drift: 0.03 },
  { name: "Hang Seng", val: "21,394.06", pct: -0.32, seed: 25, drift: -0.01 },
  { name: "Gold $/oz", val: "2,684.50", pct: 0.45, seed: 35, drift: 0.02 },
  { name: "USD/CNY", val: "7.0942", pct: -0.05, seed: 45, drift: 0.00 },
];

// ============== AI 投顾 mock data ==============
const CHAT_SUGGESTIONS = [
  "成立满 3 年的港股科技基金",
  "纳指 ETF 里挑 3 只对比一下",
  "QDII 限购是怎么回事",
  "美联储加息会怎么影响 QDII",
  "申购费打折后最低的 5 只 QDII",
  "跟踪误差是什么意思",
];

const CHAT_HISTORY = [
  { id: "h1", title: "申购费打折后最低的 5 只 QDII", time: "4 分钟前", count: 2 },
  { id: "h2", title: "最近储存的股票涨的特别猛，比如闪存、美光这样的股票…", time: "6 小时前", count: 4 },
  { id: "h3", title: "最近储存的股票涨的特别猛，比如闪存、美光这样的股票…", time: "7 小时前", count: 4 },
  { id: "h4", title: "这只基金适合长期持有吗", time: "18 小时前", count: 2 },
  { id: "h5", title: "最近储存的股票涨的特别猛，比如闪存、美光这样的股票…", time: "21 小时前", count: 2 },
  { id: "h6", title: "最近储存的股票涨的特别猛，比如闪存、美光这样的股票…", time: "21 小时前", count: 4 },
  { id: "h7", title: "特朗普此次访华，会影响哪些基金呢？我在 QDII 里应该关注…", time: "1 天前", count: 4 },
  { id: "h8", title: "特朗普此次访华，会影响哪些基金呢？我在 QDII 里应该关注…", time: "1 天前", count: 2 },
  { id: "h9", title: "最近特朗普带着巨头成团来访中国，对于基金会有哪些影响…", time: "1 天前", count: 4 },
  { id: "h10", title: "给我找找投资了美股的存储系列的 QDII", time: "1 天前", count: 2 },
  { id: "h11", title: "000614 和 513030 哪个更值得长期持有", time: "1 天前", count: 2 },
  { id: "h12", title: "纳指 ETF 里挑 3 只对比一下", time: "1 天前", count: 2 },
];

// A representative conversation showing FILTER tool with embedded fund cards
const SAMPLE_CONVERSATION = {
  id: "current",
  messages: [
    {
      role: "user",
      content: "最近储存的股票涨的特别猛，比如闪存、美光这样的股票，帮我看看有些基金投了这些",
    },
    {
      role: "ai",
      tool: "FILTER",
      text: "帮你筛了一下，确实有几只 QDII 基金的前十大重仓里明确配了美光和闪存相关标的。按工具返回的数据（持仓截止 2026-03-31），主要集中在全球科技 / 互联网方向的主动型 QDII 里：",
      bullets: [
        {
          title: "华夏移动互联混合人民币 / 华夏移动互联混合美元现汇",
          body: "前十大重仓同时命中闪迪 (SNDK) 7.13% 和 美光科技 (MU) 6.58%，还配了英伟达、英特尔等半导体链。近1年收益工具显示在 +128% ~ +140% 区间，但晨星评级仅 1 星，近1年最大回撤 -12.6% 左右，属于风格非常进攻、弹性极大的选手。",
        },
      ],
      funds: [
        {
          code: "002891", name: "华夏移动互联混合人民币",
          status: "limit", limitText: "限购 1000 元/日",
          tags: ["全球", "综合配置", "底仓候选"],
          return3m: 52.72, return1y: 128.30, returnYtd: 75.03,
          score: 98,
          shareNote: "同基金另有 美元现汇份额 002892（多数 App 不代销），持仓相同。普通人民币申购看本卡即可。",
        },
        {
          code: "006373", name: "国富全球科技互联网混合(QDII)人民币 A",
          status: "limit", limitText: "限购 100 元/日",
          tags: ["全球", "科技成长", "进攻仓"],
          return3m: 42.79, return1y: 108.87, returnYtd: 68.43,
          score: 98,
          inlineNote: "前十大重仓含 美光科技 (MU) 7.69%。近1年收益约 +108%~+119%，晨星 5 星，夏普比率 4.0 以上，近1年最大回撤 -15.5% 左右，在科技成长类里相对注重回撤管理和性价比。",
          shareNote: "同基金另有 人民币 C 份额 021842（限购 100 元）；美元现汇份额 006374（多数 App 不代销）、美元现汇份额 021843（多数 App 不代销），持仓相同。普通人民币申购看本卡即可。",
        },
        {
          code: "040046", name: "鹏华港美互联股票人民币 / 美元现汇",
          status: "open",
          tags: ["全球", "科技成长"],
          return3m: 38.10, return1y: 96.45, returnYtd: 54.20,
          score: 94,
          inlineNote: "同样重仓 美光科技 (MU) 7.49%。近1年收益…",
        },
      ],
    },
  ],
};

// Synthesize a Fund-like object for chat-embedded codes not in FUNDS
function synthesizeFund(src) {
  return {
    code: src.code,
    name: src.name,
    region: src.tags?.[0] || "全球",
    theme: src.tags?.[1] || "科技成长",
    role: src.tags?.[2] || "配置仓",
    risk: "高",
    rating: src.score >= 95 ? 5 : src.score >= 85 ? 4 : 3,
    sharpe: 1.42,
    aum: 6.69,
    drawdown: -12.6,
    return3m: src.return3m ?? 12.5,
    return1y: src.return1y ?? 128.30,
    returnYtd: src.returnYtd ?? 56.4,
    status: src.status || "open",
    limitYuan: src.status === "limit" ? (src.limitText && src.limitText.includes("1000") ? 1000 : src.limitText && src.limitText.includes("100") ? 100 : 1000) : null,
    top3: [
      { c: "MU",   p: 6.58 },
      { c: "SNDK", p: 7.13 },
      { c: "NVDA", p: 5.40 },
    ],
    sparkSeed: src.code ? parseInt(src.code, 10) || 100 : 100,
    drift: (src.return1y || 50) / 100,
    vol: 0.024,
    manager: "刘平、徐恒、郭琨研",
  };
}

// ----- Detail extension: synthesize richer info for the drawer view -----
function getFundDetail(codeOrFund) {
  // accept either a code string or a fund-like object (e.g. from chat embeds)
  let fund;
  if (typeof codeOrFund === "string") {
    fund = FUNDS.find((f) => f.code === codeOrFund);
  } else if (codeOrFund && typeof codeOrFund === "object") {
    fund = FUNDS.find((f) => f.code === codeOrFund.code) || synthesizeFund(codeOrFund);
  }
  if (!fund) return null;
  // long nav (240 points) for the drawer chart — calibrated to fund.return1y
  const navHist = genCalibratedSpark(fund.sparkSeed, fund.return1y / 100, 0.018, 240).map((v, i) => ({
    i, nav: +(v * 2.4 + 0.6).toFixed(4),
  }));

  // top-10 holdings (extend top3 + 7 generic)
  const namesPool = [
    {c: "TSM", n: "台积电"}, {c: "LITE", n: "Lumentum Holdings"}, {c: "300502", n: "新易盛"},
    {c: "GLW", n: "康宁"}, {c: "AXTI", n: "AXT Inc"}, {c: "300308", n: "中际旭创"},
    {c: "600498", n: "烽火科技"}, {c: "TSEM", n: "Tower半导体"}, {c: "GOOGL", n: "谷歌-A"},
    {c: "002384", n: "东山精密"},
  ];
  const rand = (function() { let s = fund.sparkSeed | 0; return () => { s = (s*1664525 + 1013904223) & 0x7fffffff; return s / 0x7fffffff; }; })();
  const top10 = namesPool.map((it, i) => ({
    rank: i + 1, code: it.c, name: it.n,
    ratio: +(8.88 - i * 0.62 - rand() * 0.4).toFixed(2),
  }));
  const top10Concentration = +top10.reduce((s, h) => s + h.ratio, 0).toFixed(2);

  // asset allocation last 4 quarters
  const qDates = ["2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30"];
  const allocation = qDates.map((d, i) => ({
    date: d,
    stock: +(74.67 + i * 4.5 - rand() * 1.6).toFixed(2),
    cash: +(16.27 - i * 2.1 + rand() * 0.6).toFixed(2),
    netAsset: +(98.66 - i * 8.5).toFixed(2),
    trend: i === 0 ? "→" : i < 2 ? "减仓" : "加仓",
  }));

  return {
    fund,
    navHist,
    top10,
    top10Concentration,
    allocation,
    // pro metrics
    pro: {
      aumDate: "2026-03-31",
      maxDrawdown: fund.drawdown,
      sharpe: fund.sharpe,
      volatility: +(fund.drawdown * -1 + 12 + rand() * 6).toFixed(2),
      navUnit: +(navHist[navHist.length - 1].nav).toFixed(2),
      navDate: "2026-05-14",
    },
    // trading rules
    trading: {
      purchaseStatus: fund.status,
      purchaseLimit: fund.limitYuan,
      redeemStatus: "open",
      statusDate: "2026-05-15",
      managementFee: "1.20%",
      custodianFee: "0.20%",
      buyFees: [
        { amount: "100 万元以下", original: "1.50%", discount: "0.15%" },
        { amount: "100 万元 ~ 500 万元", original: "1.00%", discount: "0.10%" },
        { amount: "500 万元以上", original: "1000 元/笔", discount: "1000 元/笔" },
      ],
      redeemFees: [
        { period: "< 7 天", rate: "1.50%" },
        { period: "7 天 ~ 30 天", rate: "0.75%" },
        { period: "30 天 ~ 365 天", rate: "0.50%" },
        { period: "> 365 天", rate: "0.00%" },
      ],
    },
    // AI commentary
    aiSummary: `${fund.region}${fund.theme === "科技成长" ? "科技股" : fund.theme}近年涨幅明显，` +
      `${fund.return1y > 30 ? "短期累计涨幅较大，新增资金更适合等待回撤或定投摊平" :
        fund.return1y > 0 ? "中期趋势平稳，可作为底仓持有但仍需关注估值" :
        "近期处于调整区间，回撤幅度可控，适合分批左侧布局"}。` +
      `适合对${fund.role}有配置需求、能承受${fund.risk}风险并长期持有的投资者。`,
    aiAction: {
      label: fund.return1y > 40 ? "不宜追高" : fund.return1y > 15 ? "正常持有" : fund.return1y >= 0 ? "可分批建仓" : "等待企稳",
      reason: fund.return1y > 40
        ? "短期一年维度涨幅偏高，新增资金更适合等待回撤或定投摊平。"
        : fund.return1y > 15
        ? "估值在合理区间，趋势向上，持仓投资者可继续持有。"
        : fund.return1y >= 0
        ? "震荡修复期，分批配置可降低择时风险。"
        : "短期承压，建议观察基本面与流动性指标，待信号明朗后再行动。",
    },
    // peer & suitability
    peer: {
      themeSamples: 303,
      themeRank1y: 99,
      regionRankScore: 100,
      benchmark: "MSCI 全球指数(MSCI All Country World Index)收益率 × 30% + 中证港股通综合指数收益率 × 25% + 中证 800 指数收益率 × 30% + 中债 - 总全价(总值)指数收益率 × 15%",
    },
    suitability: [
      "适合作为海外配置底仓候选，优先关注长期持有体验和趋势稳定性",
      "适合管理周期较短、判断重点是基金经理、持仓风格与长期跑赢基准能力",
    ],
    riskNotes: [
      "近期涨幅较高，新增买入更适合分批而非一次性追入",
      "持仓集中度偏高，单只重仓股波动会显著影响净值",
      "QDII 额度紧张时申赎可能卡壳，注意官方公告",
    ],
    investRange:
      "本基金可投资于境内市场和境外市场。境内市场投资工具包括依法发行的境内股票（包括创业板及其他依法发行的股票）、债券（包括国债、央行票据、地方政府债、企业债、企业短融、中期票据、可分离债等）、债券回购、银行存款、资产支持证券以及经中国证监会允许投资的其他金融工具…",
    investGoal: "在控制风险的前提下，追求基金资产的长期增值。",
  };
}

export {
  FUNDS,
  KPIS,
  QUICK_CHIPS,
  TAPE,
  CHAT_SUGGESTIONS,
  CHAT_HISTORY,
  SAMPLE_CONVERSATION,
  genSpark,
  genCalibratedSpark,
  getFundDetail,
  synthesizeFund,
};
