import vm from "node:vm";

function todayParts() {
  const now = new Date();
  const end = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function toNumber(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

const pct = toNumber;

export function classifyFund(name) {
  const n = name.toLowerCase();
  const has = (...words) => words.some((word) => name.includes(word) || n.includes(word.toLowerCase()));

  let region = "全球";
  if (has("美国", "纳斯达克", "标普", "S&P", "sp")) region = "美国";
  if (has("港股", "香港", "恒生")) region = "港股";
  if (has("日本", "日经")) region = "日本";
  if (has("印度")) region = "印度";
  if (has("德国", "DAX")) region = "欧洲";
  if (has("亚洲", "亚太", "新兴市场")) region = "亚太/新兴";

  let theme = "综合配置";
  if (has("科技", "信息技术", "互联网", "纳斯达克", "人工智能", "AI")) theme = "科技成长";
  if (has("标普500", "标普 500", "S&P500", "S&P 500", "500ETF")) theme = "美国宽基";
  if (has("医疗", "医药", "生物")) theme = "医疗健康";
  if (has("消费")) theme = "消费";
  if (has("半导体", "芯片")) theme = "半导体";
  if (has("黄金", "原油", "商品", "大宗")) theme = "商品资源";
  if (has("债", "收益", "美元债")) theme = "债券收益";
  if (has("红利", "低波")) theme = "红利低波";

  let fundType = "主动基金";
  if (has("指数", "ETF联接", "ETF 联接", "LOF", "ETF")) fundType = "指数/联接";
  if (has("债")) fundType = "债券/收益";
  if (has("股票")) fundType = fundType === "指数/联接" ? fundType : "股票主动";
  if (has("混合")) fundType = fundType === "指数/联接" ? fundType : "混合主动";

  const narrowTheme = ["科技成长", "医疗健康", "半导体", "商品资源"].includes(theme);
  const risk = fundType === "债券/收益" ? "中" : narrowTheme ? "高" : "中高";
  const role = theme === "美国宽基" || theme === "综合配置" ? "底仓候选" : narrowTheme ? "进攻仓" : "卫星配置";

  return { region, theme, fundType, risk, role };
}

export function computeRawScore(fund) {
  const values = [fund.return1y, fund.return6m, fund.return3m, fund.returnYtd, fund.return3y]
    .filter((value) => value !== null);
  const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const positiveCount = values.filter((value) => value > 0).length;

  let raw = 50;
  raw += avg / 2.8;
  raw += positiveCount * 3;
  if (fund.return1y !== null) raw += fund.return1y / 8;
  if (fund.return3m !== null && fund.return3m < -8) raw -= 8;
  if (fund.ageYears !== null && fund.ageYears < 1) raw -= 8;
  if (fund.risk === "高") raw -= 4;
  if (fund.theme === "美国宽基" || fund.role === "底仓候选") raw += 4;
  if (fund.discountFee !== null && fund.discountFee <= 0.15) raw += 3;
  if (fund.discountFee !== null && fund.discountFee >= 1) raw -= 3;
  return raw;
}

export function scoreFund(fund) {
  return { rawScore: computeRawScore(fund), score: 50, label: "可观察" };
}

export function applyPercentileScores(funds) {
  if (!funds.length) return funds;
  for (const f of funds) {
    if (!Number.isFinite(f.rawScore)) f.rawScore = computeRawScore(f);
  }
  const sorted = [...funds].sort((a, b) => a.rawScore - b.rawScore);
  const total = sorted.length;
  let i = 0;
  while (i < total) {
    let j = i;
    while (j < total && sorted[j].rawScore === sorted[i].rawScore) j++;
    const avgRank = (i + j - 1) / 2;
    const percentile = total === 1 ? 100 : Math.round((avgRank / (total - 1)) * 100);
    const label = percentile >= 90 ? "高关注" : percentile >= 60 ? "可观察" : "谨慎看待";
    for (let k = i; k < j; k++) {
      sorted[k].score = percentile;
      sorted[k].label = label;
    }
    i = j;
  }
  return funds;
}

function parseRankData(text) {
  const match = text.match(/var\s+rankData\s*=\s*(\{[\s\S]*\})\s*;?\s*$/);
  if (!match) throw new Error("基金排行数据格式变化，未找到 rankData。");
  const sandbox = {};
  const data = vm.runInNewContext(`(${match[1]})`, sandbox, { timeout: 1000 });
  if (!Array.isArray(data.datas)) throw new Error("基金排行数据缺少 datas。");
  return data;
}

function parseFundRow(row) {
  const parts = row.split(",");
  const code = parts[0];
  const name = parts[1];
  const meta = classifyFund(name);
  const inception = parts[16] || "";
  const ageYears = inception ? (Date.now() - new Date(`${inception}T00:00:00+08:00`).getTime()) / 31557600000 : null;
  const fund = {
    code,
    name,
    pinyin: parts[2] || "",
    date: parts[3] || "",
    nav: toNumber(parts[4]),
    accumNav: toNumber(parts[5]),
    return1d: pct(parts[6]),
    return1w: pct(parts[7]),
    return1m: pct(parts[8]),
    return3m: pct(parts[9]),
    return6m: pct(parts[10]),
    return1y: pct(parts[11]),
    return2y: pct(parts[12]),
    return3y: pct(parts[13]),
    returnYtd: pct(parts[14]),
    returnSince: pct(parts[15]),
    inception,
    ageYears: ageYears === null || !Number.isFinite(ageYears) ? null : Number(ageYears.toFixed(1)),
    buyFee: toNumber(parts[19]),
    discountFee: toNumber(parts[20]),
    source: "东方财富基金排行",
    ...meta,
  };
  return { ...fund, ...scoreFund(fund) };
}

async function fetchQdiiUniverse() {
  const response = await fetch("https://fund.eastmoney.com/js/fundcode_search.js", {
    headers: {
      "user-agent": "Mozilla/5.0 QDII Compass",
      referer: "https://fund.eastmoney.com/",
    },
  });
  if (!response.ok) throw new Error("基金代码库返回 " + response.status);
  const text = await response.text();
  const match = text.match(/var\s+r\s*=\s*(\[[\s\S]*\]);?/);
  if (!match) throw new Error("基金代码库格式变化，未找到基金列表。");
  const rows = vm.runInNewContext("(" + match[1] + ")", {}, { timeout: 2000 });
  return rows
    .filter((row) => String(row[2]).includes("QDII") || String(row[3]).includes("QDII") || String(row[3]).includes("海外"))
    .map((row) => {
      const code = row[0];
      const name = row[2];
      const meta = classifyFund(name);
      const fund = {
        code,
        name,
        pinyin: row[4] || row[1] || "",
        category: row[3] || "QDII",
        date: "",
        nav: null,
        accumNav: null,
        return1d: null,
        return1w: null,
        return1m: null,
        return3m: null,
        return6m: null,
        return1y: null,
        return2y: null,
        return3y: null,
        returnYtd: null,
        returnSince: null,
        inception: "",
        ageYears: null,
        buyFee: null,
        discountFee: null,
        source: "东方财富基金代码库",
        ...meta,
      };
      return { ...fund, ...scoreFund(fund) };
    });
}

export async function fetchQdiiFunds() {
  const { start, end } = todayParts();
  const params = new URLSearchParams({
    op: "ph",
    dt: "kf",
    ft: "QDII",
    rs: "",
    gs: "0",
    sc: "1nzf",
    st: "desc",
    sd: start,
    ed: end,
    qdii: "",
    tabSubtype: ",,,,,",
    pi: "1",
    pn: "500",
    dx: "1",
    v: String(Date.now()),
  });
  const url = `https://fund.eastmoney.com/data/rankhandler.aspx?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 QDII Compass",
      referer: "https://fund.eastmoney.com/data/fundranking.html",
    },
  });
  if (!response.ok) throw new Error(`基金排行接口返回 ${response.status}`);
  const text = await response.text();
  if (text.includes("无访问权限")) throw new Error("基金排行接口拒绝访问。");
  const raw = parseRankData(text);
  const rankedFunds = raw.datas.map(parseFundRow);
  const fundMap = new Map(rankedFunds.map((fund) => [fund.code, fund]));
  const universe = await fetchQdiiUniverse();
  for (const baseFund of universe) {
    if (!fundMap.has(baseFund.code)) fundMap.set(baseFund.code, baseFund);
  }
  const funds = Array.from(fundMap.values()).sort((a, b) => {
    const av = a.return1y ?? -Infinity;
    const bv = b.return1y ?? -Infinity;
    if (bv !== av) return bv - av;
    return a.code.localeCompare(b.code);
  });
  applyPercentileScores(funds);
  return {
    fetchedAt: Date.now(),
    fetchedAtText: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
    dateRange: { start, end },
    rankedTotal: raw.allRecords || rankedFunds.length,
    universeTotal: universe.length,
    total: funds.length,
    funds,
  };
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBetween(text, start, end) {
  const i = text.indexOf(start);
  if (i < 0) return "";
  const j = text.indexOf(end, i + start.length);
  return text.slice(i + start.length, j > i ? j : i + start.length + 320);
}

function parseAumAmount(unit, raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return { aumBillion: null, aumCurrency: null };
  if (unit === "亿美元") return { aumBillion: n, aumCurrency: "USD" };
  if (unit === "万美元") return { aumBillion: n / 10000, aumCurrency: "USD" };
  if (unit === "万元") return { aumBillion: n / 10000, aumCurrency: "CNY" };
  return { aumBillion: n, aumCurrency: "CNY" };
}

function parseAum(html) {
  const patterns = [
    /净资产规模[\s\S]*?<span[^>]*>\s*([\d.]+)\s*(亿美元|亿元|亿|万元|万美元)[\s\S]*?截止至[：:]\s*(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})/,
    /净资产规模[^<]*<\/th>\s*<td[^>]*>\s*([\d.]+)\s*(亿美元|亿元|亿|万元|万美元)[^（(]*[（(]截止至[：:]\s*(\d{4})[年\-/](\d{1,2})[月\-/](\d{1,2})/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    const { aumBillion, aumCurrency } = parseAumAmount(m[2], m[1]);
    const date = `${m[3]}-${String(m[4]).padStart(2, "0")}-${String(m[5]).padStart(2, "0")}`;
    return {
      aumBillion: Number.isFinite(aumBillion) ? aumBillion : null,
      aumDate: date,
      aumCurrency,
    };
  }
  return { aumBillion: null, aumDate: null, aumCurrency: null };
}

function parseManagers(html) {
  const m = html.match(/基金经理人<\/th>\s*<td[^>]*>([\s\S]{0,500}?)<\/td>/);
  if (!m) return [];
  const managers = [];
  const linkRe = /<a[^>]*href="[^"]*\/manager\/(\d+)\.html"[^>]*>([^<]+)<\/a>/gi;
  let am;
  while ((am = linkRe.exec(m[1])) !== null) {
    const name = am[2].trim();
    if (name) managers.push({ id: am[1], name });
  }
  if (!managers.length) {
    const plain = stripTags(m[1]).trim();
    if (plain) {
      for (const name of plain.split(/[、,，\s]+/).filter(Boolean)) {
        managers.push({ id: null, name });
      }
    }
  }
  return managers;
}

function managersToNames(managers) {
  if (!managers?.length) return null;
  return managers.map((item) => item.name).join("、");
}

export async function fetchFundProfile(code) {
  const url = `https://fundf10.eastmoney.com/jbgk_${code}.html`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 QDII Compass",
      referer: "https://fundf10.eastmoney.com/",
    },
  });
  if (!response.ok) throw new Error(`基金详情接口返回 ${response.status}`);
  const html = await response.text();
  const text = stripTags(html);
  const goal = extractBetween(text, "投资目标", "投资理念") || extractBetween(text, "投资目标", "投资范围");
  const scope = extractBetween(text, "投资范围", "投资策略");
  const benchmark = extractBetween(text, "业绩比较基准", "跟踪标的") || extractBetween(text, "业绩比较基准", "投资目标");
  const aum = parseAum(html);
  const managers = parseManagers(html);
  return {
    code,
    goal: goal.slice(0, 260),
    scope: scope.slice(0, 360),
    benchmark: benchmark.slice(0, 220),
    aumBillion: aum.aumBillion,
    aumDate: aum.aumDate,
    aumCurrency: aum.aumCurrency,
    managers,
    managerNames: managersToNames(managers),
    detailUrl: `https://fundf10.eastmoney.com/jbgk_${code}.html`,
  };
}

export async function fetchFundDetail(code) {
  return fetchFundProfile(code);
}

function shortenFundRoleTitle(title) {
  return String(title || "")
    .replace(/型证券投资基金/g, "")
    .replace(/证券投资基金/g, "")
    .replace(/\(QDII\)/g, "(QDII)")
    .trim();
}

function isActiveManagerTenure(period) {
  const p = String(period || "");
  if (/起任职\s*\)?$/.test(p)) return true;
  if (p.includes("起任职") && !/\d{4}年\d{1,2}月\d{1,2}日\s*至/.test(p)) return true;
  return false;
}

function extractManagerRoles(text) {
  const roles = [];
  const roleRe = /([^、]+?(?:基金|证券投资)[^、]*?基金经理)\(([^)]+)\)/g;
  let match;
  while ((match = roleRe.exec(text)) !== null) {
    roles.push({
      title: shortenFundRoleTitle(match[1].trim()),
      period: match[2].trim(),
      isActive: isActiveManagerTenure(match[2]),
    });
  }
  return roles;
}

export function parseManagerBio(raw) {
  if (!raw) {
    return { education: null, companyRole: null, activeRoles: [], pastRoles: [] };
  }

  let text = String(raw).replace(/^[^:：]+[:：]/, "").trim();
  const pastIdx = text.indexOf("曾任");
  const currentPart = pastIdx >= 0 ? text.slice(0, pastIdx) : text;
  const pastPart = pastIdx >= 0 ? text.slice(pastIdx + 2) : "";

  const nowIdx = currentPart.indexOf("现任");
  const education = (nowIdx >= 0 ? currentPart.slice(0, nowIdx) : "").replace(/[，,]\s*$/, "").trim() || null;
  const nowBody = nowIdx >= 0 ? currentPart.slice(nowIdx + 2) : currentPart;

  const companyMatch = nowBody.match(/^([^、]+?(?:公司|部)[^、]*?(?:总经理|总监|负责人)?)(?=、|$)/);
  const companyRole = companyMatch ? companyMatch[1].trim() : null;

  const allCurrentRoles = extractManagerRoles(nowBody);
  const activeRoles = allCurrentRoles.filter((r) => r.isActive).slice(0, 8);
  const pastRoles = extractManagerRoles(pastPart)
    .filter((r) => !r.isActive)
    .slice(0, 4);

  return { education, companyRole, activeRoles, pastRoles };
}

function parseManagerCurrentFunds(html) {
  const funds = [];
  const rowRe =
    /<td class="tdl"><a[^>]*href="[^"]*\/(\d{6})\.html"[^>]*>([^<]+)<\/a><\/td>[\s\S]*?~\s*至今/gi;
  const seen = new Set();
  let row;
  while ((row = rowRe.exec(html)) !== null) {
    const code = row[1];
    const name = row[2].trim();
    if (seen.has(code) || !name || name === "基金品种" || /^\d{6}$/.test(name)) continue;
    seen.add(code);
    funds.push({ code, name });
    if (funds.length >= 12) break;
  }
  return funds;
}

export async function fetchManagerProfile(managerId) {
  const id = String(managerId || "").trim();
  if (!/^\d+$/.test(id)) throw new Error("无效的基金经理 ID");
  const url = `https://fund.eastmoney.com/manager/${id}.html`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 QDII Compass",
      referer: "https://fund.eastmoney.com/",
    },
  });
  if (!response.ok) throw new Error(`基金经理档案返回 ${response.status}`);
  const html = await response.text();

  const nameMatch = html.match(/jlname="([^"]+)"/) || html.match(/<title>([^_]+)\s*_/);
  const name = nameMatch ? nameMatch[1].trim() : "";

  const bioBlock = html.match(/基金经理简介：<\/span>([\s\S]{0,4000}?)<\/p>/);
  const bio = bioBlock ? stripTags(bioBlock[1]).trim() : "";
  const bioStructured = parseManagerBio(bio);

  const tenureMatch = html.match(/累计任职时间：<\/span>([^<]+)/);
  const startMatch = html.match(/任职起始日期：<\/span>([\d-]+)/);
  const companyMatch = html.match(/现任基金公司：<\/span><a[^>]*>([^<]+)<\/a>/);
  const aumMatch = html.match(/总规模<\/span><br\s*\/>\s*<span class="numtext">([\s\S]{0,80}?)<\/span>/);
  const bestReturnMatch = html.match(/最佳<br\s*\/>\s*任期回报<\/span><br\s*\/>\s*<span class="numtext">([\s\S]{0,80}?)<\/span>/);

  const currentFunds = parseManagerCurrentFunds(html);

  return {
    id,
    name,
    bioStructured,
    tenure: tenureMatch ? stripTags(tenureMatch[1]).trim() : null,
    startDate: startMatch ? startMatch[1] : null,
    company: companyMatch ? companyMatch[1].trim() : null,
    totalAumText: aumMatch ? stripTags(aumMatch[1]).replace(/\s+/g, "") : null,
    bestReturnText: bestReturnMatch ? stripTags(bestReturnMatch[1]).replace(/\s+/g, "") : null,
    currentFunds,
    profileUrl: `https://fund.eastmoney.com/manager/${id}.html`,
  };
}

function parseLimitYuan(text) {
  if (!text) return null;
  const m = text.match(/([\d.]+)\s*(亿|万|元)/);
  if (!m) return null;
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return null;
  const unit = m[2];
  if (unit === "亿") return num * 1e8;
  if (unit === "万") return num * 1e4;
  return num;
}

function normalizePurchaseStatus(raw) {
  if (!raw) return null;
  if (/暂停申购/.test(raw)) return "暂停";
  if (/暂停大额|限大额|限制大额/.test(raw)) return "限购";
  if (/开放申购|正常/.test(raw)) return "开放";
  if (/封闭|未开放/.test(raw)) return "封闭";
  return raw.slice(0, 8);
}

function normalizeRedeemStatus(raw) {
  if (!raw) return null;
  if (/暂停赎回/.test(raw)) return "暂停";
  if (/开放赎回|正常/.test(raw)) return "开放";
  if (/封闭|未开放/.test(raw)) return "封闭";
  return raw.slice(0, 8);
}

export async function fetchFundStatus(code) {
  const url = `https://fundmobapi.eastmoney.com/FundMApi/FundBaseTypeInformation.ashx?FCODE=${code}&deviceid=1&plat=Iphone&product=EFund&version=6.4.0`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 QDII Compass",
      referer: "https://fundf10.eastmoney.com/",
    },
  });
  if (!response.ok) throw new Error(`申购状态接口返回 ${response.status}`);
  const json = await response.json();
  const d = json?.Datas;
  if (!d) throw new Error("申购状态接口无数据");
  const sgzt = d.SGZT ? String(d.SGZT).trim() : null;
  const shzt = d.SHZT ? String(d.SHZT).trim() : null;
  const purchaseStatus = normalizePurchaseStatus(sgzt);
  const purchaseLimitYuan = purchaseStatus === "限购" ? parseLimitYuan(sgzt) : null;
  return {
    code,
    purchaseStatus,
    purchaseLimitYuan,
    redeemStatus: normalizeRedeemStatus(shzt),
    statusFetchedAt: new Date().toISOString(),
  };
}

export function computeMaxDrawdown(navHistory) {
  if (!navHistory || navHistory.length < 10) return null;
  const cutoff = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const recent = navHistory
    .filter((row) => {
      if (!row || row.nav === null || row.nav === undefined) return false;
      const t = new Date(row.date || row.nav_date).getTime();
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => new Date(a.date || a.nav_date) - new Date(b.date || b.nav_date));
  if (recent.length < 10) return null;
  let peak = recent[0].nav;
  let maxDrawdown = 0;
  for (const row of recent) {
    if (row.nav > peak) peak = row.nav;
    const dd = (row.nav - peak) / peak;
    if (dd < maxDrawdown) maxDrawdown = dd;
  }
  return Number((maxDrawdown * 100).toFixed(2));
}

function parseApiData(text) {
  const idx = text.indexOf("content:");
  if (idx < 0) return "";
  const after = text.slice(idx + "content:".length).trim();
  if (after.startsWith('"')) {
    let end = 1;
    while (end < after.length) {
      const ch = after[end];
      if (ch === "\\") { end += 2; continue; }
      if (ch === '"') break;
      end++;
    }
    return after.slice(1, end).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return after;
}

function decodeHtmlEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

export async function fetchFundHoldings(code) {
  const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 QDII Compass",
      referer: `https://fundf10.eastmoney.com/ccmx_${code}.html`,
    },
  });
  if (!response.ok) return { holdings: [], reportDate: null };
  const text = await response.text();
  const content = parseApiData(text);
  if (!content) return { holdings: [], reportDate: null };
  const dateMatch = content.match(/截止至[：:]\s*<font[^>]*>(\d{4}-\d{2}-\d{2})<\/font>/) || content.match(/截止至[：:]\s*(\d{4}-\d{2}-\d{2})/);
  const reportDate = dateMatch ? dateMatch[1] : null;
  const rowMatches = content.match(/<tr>[\s\S]*?<\/tr>/g) || [];
  const holdings = [];
  for (const row of rowMatches) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g);
    if (!cells || cells.length < 7) continue;
    const text = cells.map((c) => decodeHtmlEntities(c.replace(/<[^>]+>/g, " ")).trim());
    const rank = Number(text[0]);
    if (!Number.isFinite(rank) || rank < 1 || rank > 10) continue;
    const ratio = Number(String(text[6]).replace("%", ""));
    holdings.push({
      rank,
      stockCode: text[1] || "",
      stockName: text[2] || "",
      ratio: Number.isFinite(ratio) ? ratio : null,
    });
  }
  holdings.sort((a, b) => a.rank - b.rank);
  return { holdings, reportDate };
}

export async function fetchAssetAllocation(code) {
  const url = `https://fundf10.eastmoney.com/zcpz_${code}.html`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 QDII Compass",
      referer: "https://fundf10.eastmoney.com/",
    },
  });
  if (!response.ok) return [];
  const html = await response.text();
  const tableMatch = html.match(/<table[^>]*class=["']w782 comm tzxq["'][^>]*>[\s\S]*?<\/table>/);
  if (!tableMatch) return [];
  const rows = tableMatch[0].match(/<tr>[\s\S]*?<\/tr>/g) || [];
  const result = [];
  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g);
    if (!cells || cells.length < 5) continue;
    const text = cells.map((c) => decodeHtmlEntities(c.replace(/<[^>]+>/g, " ")).trim().replace(/%$/, ""));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text[0])) continue;
    const parseNum = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    result.push({
      date: text[0],
      stock: parseNum(text[1]),
      bond: parseNum(text[2]),
      cash: parseNum(text[3]),
      depositary: parseNum(text[4]),
      netAssetBillion: text[5] ? parseNum(text[5]) : null,
    });
    if (result.length >= 8) break;
  }
  return result;
}

export async function fetchFundFees(code) {
  const url = `https://fundf10.eastmoney.com/jjfl_${code}.html`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 QDII Compass", referer: "https://fundf10.eastmoney.com/" },
  });
  if (!response.ok) return { buyFees: [], redeemFees: [], operatingFees: null };
  const html = await response.text();

  const cellText = (c) => decodeHtmlEntities(c.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const rowsAfter = (label, headerKeyword) => {
    let from = 0;
    while (true) {
      const i = html.indexOf(label, from);
      if (i < 0) return [];
      const t = html.indexOf("<table", i);
      const e = html.indexOf("</table>", t);
      if (t < 0 || e < 0) return [];
      const block = html.slice(t, e + 8);
      const trs = block.match(/<tr>[\s\S]*?<\/tr>/g) || [];
      const parsed = trs
        .map((r) => (r.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g) || []).map(cellText))
        .filter((cells) => cells.length >= 2);
      if (parsed.length && parsed[0].some((c) => c.includes(headerKeyword))) {
        return parsed.slice(1);
      }
      from = i + label.length;
    }
  };

  const buyFees = rowsAfter("申购费率", "适用金额").map((cells) => {
    const rates = cells[1].split("|").map((s) => s.trim());
    return {
      amount: cells[0],
      original: rates[0] || cells[1],
      discount: rates.length > 1 ? rates[1] : null,
    };
  });
  const redeemFees = rowsAfter("赎回费率", "适用期限").map((cells) => ({
    period: cells[0],
    rate: cells[1],
  }));

  const operatingFees = parseOperatingFees(html);

  return { buyFees, redeemFees, operatingFees };
}

/** 运作费用：管理费、托管费、销售服务费（F10 费率页「运作费用」区块） */
function parseOperatingFees(html) {
  const pick = (label) => {
    const re = new RegExp(`${label}<\\/td>\\s*<td[^>]*>([^<]+)<`, "i");
    const m = html.match(re);
    return m ? decodeHtmlEntities(m[1]).replace(/\s+/g, " ").trim() : null;
  };
  const management = pick("管理费率");
  const custodian = pick("托管费率");
  const salesService = pick("销售服务费率");
  if (!management && !custodian && !salesService) return null;
  return { management, custodian, salesService };
}

export async function fetchFundRiskMetrics(code) {
  const url = `https://fundf10.eastmoney.com/tsdata_${code}.html`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 QDII Compass",
      referer: "https://fundf10.eastmoney.com/",
    },
  });
  if (!response.ok) return { sharpe1y: null, volatility1y: null };
  const html = await response.text();
  const tableMatch = html.match(/<table class="fxtb"[\s\S]*?<\/table>/);
  if (!tableMatch) return { sharpe1y: null, volatility1y: null };
  const stdMatch = tableMatch[0].match(/<td>标准差<\/td>\s*<td[^>]*>([\d.]+)%?<\/td>/);
  const sharpeMatch = tableMatch[0].match(/<td>夏普比率<\/td>\s*<td[^>]*>(-?[\d.]+)<\/td>/);
  const vol = stdMatch ? Number(stdMatch[1]) : null;
  const sharpe = sharpeMatch ? Number(sharpeMatch[1]) : null;
  return {
    sharpe1y: Number.isFinite(sharpe) ? sharpe : null,
    volatility1y: Number.isFinite(vol) ? vol : null,
  };
}

export async function fetchFundRating(code) {
  const url = `https://api.fund.eastmoney.com/F10/JJPJ/?fundcode=${code}&pageIndex=1&pageSize=1`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 QDII Compass",
      referer: "https://fundf10.eastmoney.com/",
    },
  });
  if (!response.ok) return { star: null, date: null };
  const data = await response.json();
  const row = data?.Data?.[0];
  if (!row) return { star: null, date: null };
  const raw = row.CXPJ3;
  const star = raw === null || raw === undefined || raw === "" ? null : Number(raw);
  return {
    star: Number.isFinite(star) && star >= 1 && star <= 5 ? star : null,
    date: row.RDATE || null,
  };
}

export async function fetchRatingsConcurrently(codes, { concurrency = 8, onProgress } = {}) {
  const results = new Map();
  const queue = codes.slice();
  let done = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const code = queue.shift();
      try {
        const rating = await fetchFundRating(code);
        results.set(code, rating);
      } catch {
        results.set(code, { star: null, date: null });
      } finally {
        done++;
        if (onProgress) onProgress(done, codes.length);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchProfilesAndMetricsConcurrently(codes, { concurrency = 8, onProgress } = {}) {
  const results = new Map();
  const queue = codes.slice();
  let done = 0;
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const code = queue.shift();
      const merged = {
        aumBillion: null, aumDate: null, aumCurrency: null,
        managerNames: null,
        sharpe1y: null, volatility1y: null,
        goal: null, scope: null, benchmark: null, detailUrl: null,
        purchaseStatus: null, purchaseLimitYuan: null, redeemStatus: null, statusFetchedAt: null,
      };
      try {
        const [profile, risk, status] = await Promise.all([
          fetchFundProfile(code).catch(() => null),
          fetchFundRiskMetrics(code).catch(() => null),
          fetchFundStatus(code).catch(() => null),
        ]);
        if (profile) {
          merged.aumBillion = profile.aumBillion;
          merged.aumDate = profile.aumDate;
          merged.aumCurrency = profile.aumCurrency;
          merged.managerNames = profile.managerNames;
          merged.goal = profile.goal;
          merged.scope = profile.scope;
          merged.benchmark = profile.benchmark;
          merged.detailUrl = profile.detailUrl;
        }
        if (risk) {
          merged.sharpe1y = risk.sharpe1y;
          merged.volatility1y = risk.volatility1y;
        }
        if (status) {
          merged.purchaseStatus = status.purchaseStatus;
          merged.purchaseLimitYuan = status.purchaseLimitYuan;
          merged.redeemStatus = status.redeemStatus;
          merged.statusFetchedAt = status.statusFetchedAt;
        }
      } catch {
        // 保持 null
      } finally {
        results.set(code, merged);
        done++;
        if (onProgress) onProgress(done, codes.length);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export async function fetchNavHistory(code, targetCount = 240) {
  const headers = {
    "user-agent": "Mozilla/5.0 QDII Compass",
    referer: `https://fundf10.eastmoney.com/jjjz_${code}.html`,
  };
  const all = [];
  let pageIndex = 1;
  while (all.length < targetCount && pageIndex <= 20) {
    const url = `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=${pageIndex}&pageSize=20`;
    const response = await fetch(url, { headers });
    if (!response.ok) break;
    const data = await response.json();
    const list = data?.Data?.LSJZList || [];
    if (!list.length) break;
    for (const row of list) {
      if (!row.FSRQ || row.DWJZ === undefined) continue;
      const nav = toNumber(row.DWJZ);
      if (nav === null) continue;
      all.push({ nav_date: row.FSRQ, nav, accum_nav: toNumber(row.LJJZ) });
    }
    pageIndex++;
    if (list.length < 20) break;
  }
  return all;
}

export async function fetchFundBasicInfo(code) {
  const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNBasicInformation?FCODE=${code}&deviceid=qdii-compass&plat=Iphone&product=EFund&version=6.4.0`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 QDII Compass",
      referer: "https://fund.eastmoney.com/",
    },
  });
  if (!response.ok) return null;
  const data = await response.json();
  const d = data?.Datas;
  if (!d) return null;
  return {
    name: d.SHORTNAME || null,
    category: d.FTYPE || null,
    inception: d.ESTABDATE && /^\d{4}-\d{2}-\d{2}$/.test(d.ESTABDATE) ? d.ESTABDATE : null,
    nav: toNumber(d.DWJZ),
    accumNav: toNumber(d.LJJZ),
    return1d: toNumber(d.RZDF),
    buyFee: toNumber(d.SOURCERATE),
    discountFee: toNumber(d.RATE),
    riskLevel: d.RISKLEVEL || null,
  };
}

function tsToBeijingDate(ts) {
  return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function fetchFundReturns(code) {
  const url = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 QDII Compass",
      referer: `https://fund.eastmoney.com/${code}.html`,
    },
  });
  if (!response.ok) return null;
  const text = await response.text();
  const navMatch = text.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  if (!navMatch) return null;
  const accMatch = text.match(/var\s+Data_ACWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  let navArr;
  let accArr = [];
  try {
    navArr = JSON.parse(navMatch[1]);
    if (accMatch) accArr = JSON.parse(accMatch[1]);
  } catch {
    return null;
  }
  if (!Array.isArray(navArr) || !navArr.length) return null;

  const accMap = new Map();
  for (const item of accArr) {
    if (Array.isArray(item) && item.length >= 2) accMap.set(item[0], item[1]);
  }
  const rows = navArr
    .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({
      ts: p.x,
      nav: p.y,
      accumNav: accMap.has(p.x) ? accMap.get(p.x) : null,
    }))
    .sort((a, b) => a.ts - b.ts);
  if (!rows.length) return null;

  const latest = rows[rows.length - 1];
  const latestBase = latest.accumNav ?? latest.nav;

  function returnSince(targetTs) {
    let pick = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].ts <= targetTs) {
        pick = rows[i];
        break;
      }
    }
    if (!pick) return null;
    const base = pick.accumNav ?? pick.nav;
    if (base === null || base === 0 || latestBase === null) return null;
    return Number((((latestBase / base) - 1) * 100).toFixed(2));
  }

  const monthsBack = (n) => {
    const d = new Date(latest.ts);
    d.setUTCMonth(d.getUTCMonth() - n);
    return d.getTime();
  };
  const yearsBack = (n) => {
    const d = new Date(latest.ts);
    d.setUTCFullYear(d.getUTCFullYear() - n);
    return d.getTime();
  };
  const beijingYear = Number(tsToBeijingDate(latest.ts).slice(0, 4));
  const ytdStartTs = new Date(`${beijingYear}-01-01T00:00:00+08:00`).getTime();

  return {
    latestDate: tsToBeijingDate(latest.ts),
    latestNav: latest.nav,
    latestAccumNav: latest.accumNav,
    return1m: returnSince(monthsBack(1)),
    return3m: returnSince(monthsBack(3)),
    return6m: returnSince(monthsBack(6)),
    return1y: returnSince(yearsBack(1)),
    returnYtd: returnSince(ytdStartTs),
  };
}

async function runWithConcurrency(items, concurrency, worker) {
  let cursor = 0;
  const workers = new Array(Math.max(1, Math.min(concurrency, items.length)))
    .fill(null)
    .map(async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= items.length) return;
        await worker(items[idx], idx);
      }
    });
  await Promise.all(workers);
}

export async function enrichFallbackFunds(funds, options = {}) {
  const targets = funds.filter((f) => f.source === "东方财富基金代码库");
  if (!targets.length) return { enriched: 0, failed: 0, total: 0 };
  const concurrency = options.concurrency || 8;
  const onProgress = options.onProgress || (() => {});
  let enriched = 0;
  let failed = 0;
  let done = 0;

  await runWithConcurrency(targets, concurrency, async (fund) => {
    try {
      const [basic, returns] = await Promise.all([
        fetchFundBasicInfo(fund.code).catch(() => null),
        fetchFundReturns(fund.code).catch(() => null),
      ]);
      let touched = false;
      if (basic) {
        if (basic.category && !fund.category) fund.category = basic.category;
        if (basic.inception) {
          fund.inception = basic.inception;
          const t = new Date(`${basic.inception}T00:00:00+08:00`).getTime();
          if (Number.isFinite(t)) {
            fund.ageYears = Number(((Date.now() - t) / 31557600000).toFixed(1));
          }
        }
        if (basic.nav !== null) fund.nav = basic.nav;
        if (basic.accumNav !== null) fund.accumNav = basic.accumNav;
        if (basic.return1d !== null) fund.return1d = basic.return1d;
        if (basic.buyFee !== null) fund.buyFee = basic.buyFee;
        if (basic.discountFee !== null) fund.discountFee = basic.discountFee;
        touched = true;
      }
      if (returns) {
        if (returns.latestDate) fund.date = returns.latestDate;
        if (returns.latestNav !== null) fund.nav = returns.latestNav;
        if (returns.latestAccumNav !== null) fund.accumNav = returns.latestAccumNav;
        if (returns.return1m !== null) fund.return1m = returns.return1m;
        if (returns.return3m !== null) fund.return3m = returns.return3m;
        if (returns.return6m !== null) fund.return6m = returns.return6m;
        if (returns.return1y !== null) fund.return1y = returns.return1y;
        if (returns.returnYtd !== null) fund.returnYtd = returns.returnYtd;
        touched = true;
      }
      if (touched) {
        fund.rawScore = computeRawScore(fund);
        fund.source = "东方财富补全（基本信息+历史净值）";
        enriched++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    } finally {
      done++;
      onProgress(done, targets.length);
    }
  });

  return { enriched, failed, total: targets.length };
}

function fmtPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "暂无";
  return (value > 0 ? "+" : "") + value.toFixed(2) + "%";
}

function median(values) {
  const nums = values.filter((value) => value !== null && value !== undefined && Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function percentileRank(items, key, value) {
  const nums = items.map((item) => item[key]).filter((n) => n !== null && n !== undefined && Number.isFinite(n));
  if (!nums.length || value === null || value === undefined || !Number.isFinite(value)) return null;
  const belowOrEqual = nums.filter((n) => n <= value).length;
  return Math.round((belowOrEqual / nums.length) * 100);
}

export function buildStructuredAnalysis(fund, funds, detail) {
  const sameTheme = funds.filter((item) => item.theme === fund.theme);
  const sameRegion = funds.filter((item) => item.region === fund.region);
  const themeMedian1y = median(sameTheme.map((item) => item.return1y));
  const regionMedian1y = median(sameRegion.map((item) => item.return1y));
  const themeRank1y = percentileRank(sameTheme, "return1y", fund.return1y);
  const regionRankScore = percentileRank(sameRegion, "score", fund.score);
  const hotRun = (fund.return1m ?? 0) > 20 || (fund.return3m ?? 0) > 35 || (fund.return1y ?? 0) > 80;
  const shortPressure = (fund.return1m ?? 0) < -8 || (fund.return3m ?? 0) < -12;
  const narrow = fund.role === "进攻仓";

  const suitability = [];
  if (fund.role === "底仓候选") suitability.push("适合作为海外配置底仓候选，优先关注长期持有体验和跟踪稳定性。");
  if (fund.role === "进攻仓") suitability.push("更适合作为进攻仓或主题仓，仓位宜小于宽基底仓。");
  if (fund.fundType.includes("指数")) suitability.push("指数/联接属性较强，判断重点是标的指数、费率、跟踪误差和申购限制。");
  if (fund.fundType.includes("主动")) suitability.push("主动管理属性较强，判断重点是基金经理、持仓风格和长期跑赢基准能力。");

  const riskNotes = [];
  if (narrow) riskNotes.push("主题集中度较高，行情反转时可能和同类基金一起回撤。");
  if (fund.region === "美国") riskNotes.push("人民币份额会受到美元/人民币汇率影响。");
  if (fund.theme === "科技成长" || fund.theme === "半导体") riskNotes.push("科技成长资产估值弹性大，单季波动可能明显高于宽基。");
  if (fund.ageYears !== null && fund.ageYears < 1) riskNotes.push("成立时间不足一年，历史收益样本偏短。");
  if (hotRun) riskNotes.push("近期涨幅较高，新增买入更适合分批而非一次性追入。");
  if (!riskNotes.length) riskNotes.push("仍需关注海外市场波动、汇率、限购和赎回到账周期。");

  let action = "观察";
  let actionReason = "数据没有显示明显极端状态，适合放入观察池并和同主题基金横向比较。";
  if (fund.role === "底仓候选" && fund.score >= 70 && !hotRun) {
    action = "可作为底仓候选";
    actionReason = "覆盖面和评分更适合长期配置，但仍应分批建立仓位。";
  }
  if (hotRun) {
    action = "不宜追高";
    actionReason = "短期或一年维度涨幅偏热，新增资金更适合等待回撤或定投摊平。";
  }
  if (shortPressure && fund.score < 55) {
    action = "谨慎";
    actionReason = "短期表现承压且观察分不高，建议先确认底层资产逻辑是否仍成立。";
  }

  return {
    generatedAt: new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }),
    positioning: {
      title: fund.region + " · " + fund.theme + " · " + fund.role,
      fundType: fund.fundType,
      risk: fund.risk,
      benchmark: detail?.benchmark || "暂未解析到业绩比较基准",
    },
    realtime: {
      navDate: fund.date || "暂无",
      nav: fund.nav,
      return1m: fund.return1m,
      return3m: fund.return3m,
      return1y: fund.return1y,
      returnYtd: fund.returnYtd,
      score: fund.score,
      scoreLabel: fund.label,
    },
    peer: {
      themeCount: sameTheme.length,
      regionCount: sameRegion.length,
      themeMedian1y,
      regionMedian1y,
      themeRank1y,
      regionRankScore,
      summary: "近1年 " + fmtPct(fund.return1y) + "；同主题中位数 " + fmtPct(themeMedian1y) + "，同区域中位数 " + fmtPct(regionMedian1y) + "。",
    },
    suitability,
    riskNotes,
    action: {
      label: action,
      reason: actionReason,
    },
    dataNote: "分析基于当前公开排行数据、基金名称分类、收益区间和基金 F10 资料自动生成；已结合数据库历史净值，后续可加入波动率、限购状态和持仓变化。",
  };
}
