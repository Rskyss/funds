import { init as initAuth, onAuthChange, signIn, signUp, signOut, getSession, getToken, authedFetch } from "./auth.js";
import { renderNavChart } from "./chart.js";

const state = {
  funds: [],
  filtered: [],
  compare: new Map(),
  favorites: new Set(),
  favOnly: false,
  visibleCount: 18,
  renderedCount: 0,
  activeChip: null,
  detailCache: new Map(),
  filters: {
    search: "",
    region: "全部",
    theme: "全部",
    role: "全部",
    purchase: "全部",
    sort: "ratingMorningstar",
  },
};

const QUICK_CHIPS = [
  { id: "us-tech",   label: "美股科技",   filters: { search: "",   region: "美国", theme: "科技成长", role: "全部",     sort: "ratingMorningstar" } },
  { id: "nasdaq100", label: "纳指100",   filters: { search: "纳指", region: "全部", theme: "全部",     role: "全部",     sort: "return1y" } },
  { id: "hk-tech",   label: "港股科技",   filters: { search: "",   region: "港股", theme: "科技成长", role: "全部",     sort: "ratingMorningstar" } },
  { id: "gold",      label: "黄金",      filters: { search: "黄金", region: "全部", theme: "全部",     role: "全部",     sort: "return1y" } },
  { id: "dividend",  label: "红利",      filters: { search: "红利", region: "全部", theme: "全部",     role: "全部",     sort: "ratingMorningstar" } },
  { id: "medical",   label: "医药",      filters: { search: "医药", region: "全部", theme: "全部",     role: "全部",     sort: "ratingMorningstar" } },
  { id: "ms5",       label: "晨星5星",    filters: { search: "",   region: "全部", theme: "全部",     role: "全部",     sort: "sharpe1y" }, extra: "morningstar5" },
  { id: "core",      label: "底仓首选",   filters: { search: "",   region: "全部", theme: "全部",     role: "底仓候选", sort: "sharpe1y" } },
  { id: "attack",    label: "进攻型",     filters: { search: "",   region: "全部", theme: "全部",     role: "进攻仓",   sort: "return1y" } },
  { id: "top1y",     label: "近1年Top",  filters: { search: "",   region: "全部", theme: "全部",     role: "全部",     sort: "return1y" }, extra: "top20pct1y" },
  { id: "buyable",   label: "可申购",     filters: { search: "",   region: "全部", theme: "全部",     role: "全部",     sort: "ratingMorningstar" }, extra: "buyable" },
];

const DEFAULT_FILTERS = { search: "", region: "全部", theme: "全部", role: "全部", purchase: "全部", sort: "ratingMorningstar" };

const INITIAL_VISIBLE_FUNDS = 18;
const LOAD_MORE_BATCH_SIZE = 12;

const $ = (id) => document.getElementById(id);

const els = {
  totalFunds: $("totalFunds"),
  highScoreFunds: $("highScoreFunds"),
  techRatio: $("techRatio"),
  dataTime: $("dataTime"),
  clearCompareBtn: $("clearCompareBtn"),
  searchInput: $("searchInput"),
  regionFilter: $("regionFilter"),
  themeFilter: $("themeFilter"),
  roleFilter: $("roleFilter"),
  purchaseFilter: $("purchaseFilter"),
  sortSelect: $("sortSelect"),
  statusText: $("statusText"),
  fundGrid: $("fundGrid"),
  quickChipRow: $("quickChipRow"),
  loadMoreSentinel: $("loadMoreSentinel"),
  comparePanel: $("comparePanel"),
  compareBody: $("compareBody"),
  compareCount: $("compareCount"),
  drawer: $("drawer"),
  drawerContent: $("drawerContent"),
  closeDrawerBtn: $("closeDrawerBtn"),
  loginBtn: $("loginBtn"),
  authArea: $("authArea"),
  authModal: $("authModal"),
  authForm: $("authForm"),
  authEmail: $("authEmail"),
  authPassword: $("authPassword"),
  authInvite: $("authInvite"),
  authInviteRow: $("authInviteRow"),
  authSubmit: $("authSubmit"),
  authError: $("authError"),
  authTitle: $("authTitle"),
  authHint: $("authHint"),
  authSwitchText: $("authSwitchText"),
  authSwitchLink: $("authSwitchLink"),
  closeAuthBtn: $("closeAuthBtn"),
  favOnlyToggle: $("favOnlyToggle"),
  favOnlyCheckbox: $("favOnlyCheckbox"),
};

let authMode = "login";

function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function pctClass(value) {
  if (value === null || value === undefined) return "";
  return value >= 0 ? "up" : "down";
}

function formatNumber(value, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return Number(value).toFixed(digits);
}

function formatRank(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return "高于约 " + value + "% 同类";
}

function listHtml(items) {
  if (!items || !items.length) return "<p>暂无。</p>";
  return "<ul class=\"analysis-list\">" + items.map((item) => "<li>" + item + "</li>").join("") + "</ul>";
}

function holdingsHtml(detail) {
  const list = detail?.holdings || [];
  if (!list.length) {
    return `<div class="detail-block detail-block--holdings"><h4>持仓信息</h4><p class="hint">暂无持仓数据，可能基金尚未披露季报或接口无返回。</p></div>`;
  }
  const date = detail.holdingsReportDate ? `截止 ${detail.holdingsReportDate}` : "";
  const totalRatio = list.reduce((s, h) => s + (h.ratio || 0), 0);
  const concentrationHint = totalRatio >= 70
    ? "前 10 集中度高，单只股票波动会显著影响净值"
    : totalRatio >= 50
      ? "前 10 集中度中等"
      : "前 10 集中度较低，持仓相对分散";
  const rows = list.map((h) => {
    const barWidth = Math.min(100, (h.ratio || 0) * 8);
    return `
      <li class="holding-row">
        <span class="holding-rank">${h.rank}</span>
        <span class="holding-code">${escapeHtml(h.stockCode)}</span>
        <span class="holding-name">${escapeHtml(h.stockName)}</span>
        <div class="holding-bar-wrap"><div class="holding-bar" style="width:${barWidth}%"></div></div>
        <span class="holding-ratio">${h.ratio !== null ? h.ratio.toFixed(2) + "%" : "--"}</span>
      </li>
    `;
  }).join("");
  return `
    <div class="detail-block detail-block--holdings">
      <h4>前 10 大重仓股 <span class="block-meta">${date}</span></h4>
      <ul class="holdings-list">${rows}</ul>
      <p class="hint concentration">前 10 大集中度 ${totalRatio.toFixed(2)}% · ${concentrationHint}</p>
    </div>
  `;
}

function assetAllocationHtml(detail) {
  const list = detail?.assetAllocation || [];
  if (!list.length) {
    return "";
  }
  const recent = list.slice(0, 4);
  const rows = recent.map((r, idx) => {
    const stockPct = r.stock !== null ? r.stock : 0;
    const cashPct = r.cash !== null ? r.cash : 0;
    let trendIcon = "";
    if (idx < recent.length - 1) {
      const prev = recent[idx + 1].stock;
      if (r.stock !== null && prev !== null) {
        const delta = r.stock - prev;
        if (delta > 2) trendIcon = '<span class="trend up">↗ 加仓</span>';
        else if (delta < -2) trendIcon = '<span class="trend down">↘ 减仓</span>';
        else trendIcon = '<span class="trend flat">→ 稳定</span>';
      }
    }
    const netAsset = r.netAssetBillion !== null ? r.netAssetBillion.toFixed(2) + "亿" : "--";
    return `
      <tr>
        <td>${r.date}</td>
        <td><div class="alloc-bar">
          <div class="alloc-stock" style="width:${stockPct}%" title="股票 ${stockPct}%"></div>
          <div class="alloc-cash" style="width:${cashPct}%" title="现金 ${cashPct}%"></div>
        </div></td>
        <td class="num">${r.stock !== null ? r.stock.toFixed(2) + "%" : "--"}</td>
        <td class="num">${r.cash !== null ? r.cash.toFixed(2) + "%" : "--"}</td>
        <td class="num">${netAsset}</td>
        <td>${trendIcon}</td>
      </tr>
    `;
  }).join("");
  return `
    <div class="detail-block">
      <h4>资产配置变化 <span class="block-meta">最近 ${recent.length} 期季报</span></h4>
      <table class="alloc-table">
        <thead><tr><th>报告期</th><th>股票/现金分布</th><th class="num">股票占比</th><th class="num">现金占比</th><th class="num">净资产</th><th>仓位变化</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function analysisHtml(analysis) {
  if (!analysis) return "<p>暂无结构化分析。</p>";
  
  // Parse the peer summary to make it structured
  let peerSummaryHtml = `<p>${analysis.peer.summary}</p>`;
  if (analysis.peer.summary.includes(";")) {
    const parts = analysis.peer.summary.split(";").map(p => p.trim());
    if (parts.length === 2) {
      peerSummaryHtml = `
        <div class="peer-summary-box">
          <div class="peer-summary-main">${parts[0]}</div>
          <div class="peer-summary-sub">${parts[1]}</div>
        </div>
      `;
    }
  } else if (analysis.peer.summary.includes("；")) {
    const parts = analysis.peer.summary.split("；").map(p => p.trim());
    if (parts.length === 2) {
      peerSummaryHtml = `
        <div class="peer-summary-box">
          <div class="peer-summary-main">${parts[0]}</div>
          <div class="peer-summary-sub">${parts[1]}</div>
        </div>
      `;
    }
  }

  return "<div class=\"analysis-callout\">" +
    "<span>操作观察</span>" +
    "<strong>" + analysis.action.label + "</strong>" +
    "<p>" + analysis.action.reason + "</p>" +
    "</div>" +
    "<div class=\"analysis-grid\">" +
    "<section class=\"analysis-card\"><h4>定位</h4><p>" + analysis.positioning.title + "</p><dl>" +
    "<div><dt>类型</dt><dd>" + analysis.positioning.fundType + "</dd></div>" +
    "<div><dt>风险</dt><dd>" + analysis.positioning.risk + "</dd></div>" +
    "</dl></section>" +
    "<section class=\"analysis-card\"><h4>实时表现</h4><dl>" +
    "<div><dt>净值日期</dt><dd>" + analysis.realtime.navDate + "</dd></div>" +
    "<div><dt>近1月</dt><dd class=\"" + pctClass(analysis.realtime.return1m) + "\">" + formatPct(analysis.realtime.return1m) + "</dd></div>" +
    "<div><dt>近3月</dt><dd class=\"" + pctClass(analysis.realtime.return3m) + "\">" + formatPct(analysis.realtime.return3m) + "</dd></div>" +
    "<div><dt>近1年</dt><dd class=\"" + pctClass(analysis.realtime.return1y) + "\">" + formatPct(analysis.realtime.return1y) + "</dd></div>" +
    "</dl></section>" +
    "<section class=\"analysis-card\"><h4>同类对比</h4>" + peerSummaryHtml + "<dl>" +
    "<div><dt>同主题样本</dt><dd>" + analysis.peer.themeCount + " 只</dd></div>" +
    "<div><dt>同主题排名</dt><dd>" + formatRank(analysis.peer.themeRank1y) + "</dd></div>" +
    "<div><dt>同区域评分</dt><dd>" + formatRank(analysis.peer.regionRankScore) + "</dd></div>" +
    "</dl></section>" +
    "<section class=\"analysis-card\"><h4>适合谁</h4>" + listHtml(analysis.suitability) + "</section>" +
    "<section class=\"analysis-card wide\"><h4>主要风险</h4>" + listHtml(analysis.riskNotes) + "</section>" +
    "<section class=\"analysis-card wide\"><h4>业绩基准</h4><p>" + analysis.positioning.benchmark + "</p></section>" +
    "</div>" +
    "<p class=\"analysis-note\">" + analysis.dataNote + " 生成时间：" + analysis.generatedAt + "</p>";
}

function uniqueOptions(items, key) {
  return ["全部", ...Array.from(new Set(items.map((item) => item[key]).filter(Boolean))).sort()];
}

function fillSelect(select, values) {
  select.innerHTML = values.map((value) => `<option value="${value}">${value}</option>`).join("");
}

function explainFund(fund) {
  const notes = [];
  if (fund.role === "底仓候选") notes.push("覆盖面较宽，更适合作为海外配置底仓候选。");
  if (fund.role === "进攻仓") notes.push("主题集中，适合小比例进攻，不适合当全部海外仓。");
  if (fund.risk === "高") notes.push("波动可能较大，适合分批买入并控制仓位。");
  if (fund.return1y !== null && fund.return1y > 60) notes.push("近一年涨幅较高，继续追买要注意回撤。");
  if (fund.ageYears !== null && fund.ageYears < 1) notes.push("成立时间较短，历史样本不足。");
  if (!notes.length) notes.push("适合结合持仓方向、费用和个人仓位进一步观察。");
  return notes.join("");
}

function renderSummary(payload) {
  const total = state.funds.length;
  const high = state.funds.filter((fund) => fund.ratingMorningstar && fund.ratingMorningstar >= 4).length;
  const tech = state.funds.filter((fund) => fund.theme === "科技成长").length;
  els.totalFunds.textContent = total;
  els.highScoreFunds.textContent = high;
  els.techRatio.textContent = total ? `${Math.round((tech / total) * 100)}%` : "--";
  els.dataTime.textContent = payload.fetchedAtText || "--";
}

function renderFilters() {
  fillSelect(els.regionFilter, uniqueOptions(state.funds, "region"));
  fillSelect(els.themeFilter, uniqueOptions(state.funds, "theme"));
  fillSelect(els.roleFilter, uniqueOptions(state.funds, "role"));
}

function renderQuickChips() {
  if (!els.quickChipRow) return;
  const chips = QUICK_CHIPS.map((c) =>
    `<button type="button" class="quick-chip ${state.activeChip === c.id ? "is-active" : ""}" data-chip="${c.id}">${c.label}</button>`
  ).join("");
  const clearBtn = `<button type="button" class="quick-chip-clear ${state.activeChip ? "" : "hidden"}" data-chip-clear>清空 ×</button>`;
  els.quickChipRow.innerHTML = chips + clearBtn;
}

function syncPurchaseSeg() {
  if (!els.purchaseFilter) return;
  els.purchaseFilter.querySelectorAll(".seg-btn").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.purchase === state.filters.purchase);
  });
}

function syncFilterControls() {
  els.searchInput.value = state.filters.search;
  els.regionFilter.value = state.filters.region;
  els.themeFilter.value = state.filters.theme;
  els.roleFilter.value = state.filters.role;
  syncPurchaseSeg();
  els.sortSelect.value = state.filters.sort;
}

function applyChip(id) {
  if (state.activeChip === id) {
    clearChip();
    return;
  }
  const chip = QUICK_CHIPS.find((c) => c.id === id);
  if (!chip) return;
  state.activeChip = id;
  state.filters = { ...DEFAULT_FILTERS, ...chip.filters };
  syncFilterControls();
  renderQuickChips();
  applyFilters();
}

function clearChip() {
  state.activeChip = null;
  state.filters = { ...DEFAULT_FILTERS };
  syncFilterControls();
  renderQuickChips();
  applyFilters();
}

function deactivateChipIfAny() {
  if (!state.activeChip) return;
  state.activeChip = null;
  renderQuickChips();
}

function getActiveChipExtra() {
  if (!state.activeChip) return null;
  const chip = QUICK_CHIPS.find((c) => c.id === state.activeChip);
  return chip?.extra || null;
}

function applyFilters() {
  const q = state.filters.search.trim().toLowerCase();
  let funds = state.funds.filter((fund) => {
    if (state.favOnly && !state.favorites.has(fund.code)) return false;
    const haystack = `${fund.code} ${fund.name} ${fund.theme} ${fund.region} ${fund.role} ${fund.pinyin}`.toLowerCase();
    return (
      (!q || haystack.includes(q)) &&
      (state.filters.region === "全部" || fund.region === state.filters.region) &&
      (state.filters.theme === "全部" || fund.theme === state.filters.theme) &&
      (state.filters.role === "全部" || fund.role === state.filters.role) &&
      (state.filters.purchase === "全部" ||
        (state.filters.purchase === "暂停申购" ? fund.purchaseStatus === "暂停" : fund.purchaseStatus && fund.purchaseStatus !== "暂停"))
    );
  });

  const extra = getActiveChipExtra();
  if (extra === "morningstar5") {
    funds = funds.filter((f) => f.ratingMorningstar === 5);
  }
  if (extra === "buyable") {
    funds = funds.filter((f) => f.purchaseStatus !== "暂停" && f.redeemStatus !== "暂停");
  }

  const sortKey = state.filters.sort;
  funds = funds.sort((a, b) => {
    if (sortKey === "code") return a.code.localeCompare(b.code);
    const av = a[sortKey] ?? -Infinity;
    const bv = b[sortKey] ?? -Infinity;
    return bv - av;
  });

  if (extra === "top20pct1y") {
    const valid = funds.filter((f) => f.return1y !== null && f.return1y !== undefined);
    valid.sort((a, b) => (b.return1y ?? -Infinity) - (a.return1y ?? -Infinity));
    const cutoff = Math.max(1, Math.ceil(valid.length * 0.2));
    funds = valid.slice(0, cutoff);
  }

  state.filtered = funds;
  state.visibleCount = INITIAL_VISIBLE_FUNDS;
  state.renderedCount = 0;
  renderFunds();
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function morningstarHtml(fund) {
  const star = fund.ratingMorningstar;
  if (!star) {
    return `<div class="rating-row rating-empty"><span class="rating-label">晨星</span><span class="rating-stars muted">暂无评级</span></div>`;
  }
  const filled = "★".repeat(star);
  const empty = "☆".repeat(5 - star);
  const dateText = fund.ratingDate ? ` · ${fund.ratingDate.slice(0, 7)}` : "";
  return `<div class="rating-row"><span class="rating-label">晨星</span><span class="rating-stars">${filled}<span class="rating-stars-empty">${empty}</span></span><span class="rating-meta">${star}星${dateText}</span></div>`;
}

function aumUnitSuffix(fund) {
  if (fund?.aumCurrency === "USD") return "亿美元";
  if (fund?.name?.includes("美元")) return "亿美元";
  return "亿元";
}

function formatAum(billion, fund) {
  if (billion === null || billion === undefined || !Number.isFinite(billion)) return "--";
  const suffix = aumUnitSuffix(fund);
  if (billion >= 100) return `${billion.toFixed(0)}${suffix}`;
  if (billion >= 10) return `${billion.toFixed(1)}${suffix}`;
  return `${billion.toFixed(2)}${suffix}`;
}

function metricCellHtml(label, value, hint) {
  const dim = value === "--" ? "dim" : "";
  return `<div class="metric-cell ${dim}" title="${hint || ""}"><span>${label}</span><strong>${value}</strong></div>`;
}

function proMetricsHtml(fund) {
  const aum = formatAum(fund.aumBillion, fund);
  const dd = fund.maxDrawdown1y !== null && fund.maxDrawdown1y !== undefined
    ? `${Number(fund.maxDrawdown1y).toFixed(1)}%`
    : "--";
  const sharpe = fund.sharpe1y !== null && fund.sharpe1y !== undefined
    ? fund.sharpe1y.toFixed(2)
    : "--";
  const managers = fund.managerNames || "--";
  return `
    <div class="pro-metrics">
      ${metricCellHtml("规模", aum, fund.aumDate ? `规模截止 ${fund.aumDate}` : "")}
      ${metricCellHtml("近1年回撤", dd, "近1年从高点跌到最低的幅度，越接近0越平稳")}
      ${metricCellHtml("夏普比率", sharpe, "性价比指标，>1 优秀，>2 极好")}
      ${metricCellHtml("经理", managers, "现任基金经理")}
    </div>
  `;
}

function fundCommentary(fund) {
  if (fund.aiSummary) {
    return `<p class="fund-summary ai">${escapeHtml(fund.aiSummary)}</p>`;
  }
  return `<p class="fund-summary rule">${escapeHtml(explainFund(fund))}<span class="ai-tag">规则文案</span></p>`;
}

function formatLimitYuan(yuan) {
  if (!yuan || !Number.isFinite(yuan)) return "";
  if (yuan >= 1e8) return `${(yuan / 1e8).toFixed(yuan % 1e8 === 0 ? 0 : 1)}亿元`;
  if (yuan >= 1e4) return `${(yuan / 1e4).toFixed(yuan % 1e4 === 0 ? 0 : 1)}万元`;
  return `${yuan}元`;
}

function tradeStatusBadge(fund) {
  const ps = fund.purchaseStatus;
  const rs = fund.redeemStatus;
  if (rs === "暂停") {
    return `<span class="chip status-stop" title="暂停赎回，资金暂时无法取出">⚠ 暂停赎回</span>`;
  }
  if (ps === "暂停") {
    return `<span class="chip status-stop" title="基金公司暂停申购，不接受新买入">🔴 暂停申购</span>`;
  }
  if (ps === "限购") {
    const limit = formatLimitYuan(fund.purchaseLimitYuan);
    const text = limit ? `限购 ${limit}/日` : "大额限购";
    return `<span class="chip status-limit" title="单日限购金额，超过部分需分多日">🟡 ${text}</span>`;
  }
  if (ps === "场内交易" || rs === "场内交易") {
    return `<span class="chip status-exchange" title="在证券交易所买卖，不走基金公司申购赎回">📈 场内交易</span>`;
  }
  if (ps === "开放") {
    return `<span class="chip status-open" title="基金公司开放申购，可按规则买入">🟢 可申购</span>`;
  }
  return "";
}

function feeRateTable(buyFees, redeemFees, operatingFees, active) {
  const buyRows = (buyFees || []).map((r) =>
    `<tr><td>${escapeHtml(r.amount || "--")}</td><td>${escapeHtml(r.original || "--")}</td><td class="fee-discount">${escapeHtml(r.discount || "—")}</td></tr>`,
  ).join("");
  const redeemRows = (redeemFees || []).map((r) =>
    `<tr><td>${escapeHtml(r.period || "--")}</td><td>${escapeHtml(r.rate || "--")}</td></tr>`,
  ).join("");
  const hasBuy = buyRows.length > 0;
  const hasRedeem = redeemRows.length > 0;
  const formatOpFee = (s) => escapeHtml(s || "").replace(/（每年）|\(每年\)/g, " / 年");
  const mgmt = operatingFees?.management
    ? `<span class="fee-operating" title="${operatingFees.custodian ? `托管费 ${formatOpFee(operatingFees.custodian)}` : ""}">管理费 <strong>${formatOpFee(operatingFees.management)}</strong></span>`
    : "";
  if (!hasBuy && !hasRedeem && !mgmt) {
    return `<div class="fee-tabs"><p class="hint">该基金暂无费率数据。</p></div>`;
  }
  const buyActive = active !== "redeem";
  return `
    <div class="fee-tabs">
      <div class="fee-tab-head" role="tablist">
        <div class="fee-tab-head__tabs">
          <button type="button" class="fee-tab ${buyActive ? "is-active" : ""}" data-fee-tab="buy">买入费率</button>
          <button type="button" class="fee-tab ${!buyActive ? "is-active" : ""}" data-fee-tab="redeem">赎回费率</button>
        </div>
        ${mgmt}
      </div>
      <div class="fee-tab-pane" data-fee-pane="buy" ${buyActive ? "" : "hidden"}>
        ${hasBuy
          ? `<table class="fee-table"><thead><tr><th>适用金额</th><th>原费率</th><th>优惠费率</th></tr></thead><tbody>${buyRows}</tbody></table>`
          : `<p class="hint">暂无买入费率数据。</p>`}
      </div>
      <div class="fee-tab-pane" data-fee-pane="redeem" ${buyActive ? "hidden" : ""}>
        ${hasRedeem
          ? `<table class="fee-table"><thead><tr><th>持有时间</th><th>赎回费率</th></tr></thead><tbody>${redeemRows}</tbody></table>`
          : `<p class="hint">暂无赎回费率数据。</p>`}
      </div>
    </div>`;
}

function tradeStatusBlock(fund) {
  if (!fund.purchaseStatus && !fund.redeemStatus) {
    return `<div class="detail-block"><h4>交易规则</h4><div id="feeBlock" class="fee-block"><p class="hint">正在读取费率…</p></div></div>`;
  }
  const psLabel = fund.purchaseStatus === "暂停"
    ? "暂停申购"
    : fund.purchaseStatus === "限购"
      ? `限购 ${formatLimitYuan(fund.purchaseLimitYuan) || "大额"}/日`
      : fund.purchaseStatus === "开放"
        ? "开放申购"
        : fund.purchaseStatus === "场内交易"
          ? "场内交易"
          : fund.purchaseStatus || "--";
  const rsLabel = fund.redeemStatus === "暂停" ? "暂停赎回"
    : fund.redeemStatus === "开放" ? "开放赎回"
      : fund.redeemStatus === "场内交易" ? "场内交易"
        : fund.redeemStatus || "--";
  const psCls = fund.purchaseStatus === "开放" || fund.purchaseStatus === "场内交易"
    ? ""
    : fund.purchaseStatus === "限购" ? "warn" : "danger";
  const rsCls = fund.redeemStatus === "开放" || fund.redeemStatus === "场内交易" ? "" : "danger";
  const date = fund.statusFetchedAt ? new Date(fund.statusFetchedAt).toLocaleDateString("zh-CN") : "--";
  return `
    <div class="detail-block">
      <h4>交易规则</h4>
      <div class="trade-status-line">
        <span class="trade-status-item ${psCls}">
          <span>申购状态</span>
          <strong>${psLabel}</strong>
        </span>
        <span class="trade-status-item ${rsCls}">
          <span>赎回状态</span>
          <strong>${rsLabel}</strong>
        </span>
        <span class="trade-status-item muted">
          <span>状态截止</span>
          <strong>${date}</strong>
        </span>
      </div>
      <div id="feeBlock" class="fee-block"><p class="hint">正在读取费率…</p></div>
    </div>
  `;
}

function fundCard(fund, index = 0) {
  const checked = state.compare.has(fund.code) ? "checked" : "";
  const isFav = state.favorites.has(fund.code);
  const favLabel = isFav ? "★" : "☆";
  const favTitle = getSession() ? (isFav ? "取消收藏" : "加入自选") : "登录后可收藏";
  const delay = (index % 12) * 0.05;
  return `
    <article class="fund-card" style="animation-delay: ${delay}s">
      <div class="fund-card__head">
        <div>
          <h3>${fund.name}</h3>
          <div class="code">${fund.code} · ${fund.date || "无净值日期"} · 成立 ${fund.inception || "--"}</div>
        </div>
        <div class="card-head-actions">
          <button class="card-ask-btn" type="button" data-ask="${fund.code}" title="就这只基金向 AI 投顾提问" aria-label="向 AI 提问">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button class="fav-btn ${isFav ? "active" : ""}" type="button" data-fav="${fund.code}" title="${favTitle}" aria-label="${favTitle}">${favLabel}</button>
        </div>
      </div>

      <div class="chips">
        <span class="chip">${fund.region}</span>
        <span class="chip">${fund.theme}</span>
        <span class="chip">${fund.role}</span>
        <span class="chip ${fund.risk === "高" ? "risk-high" : "risk-mid"}">${fund.risk}风险</span>
        ${tradeStatusBadge(fund)}
      </div>

      <div class="metric-grid">
        <div class="metric">
          <span>近3月</span>
          <strong class="${pctClass(fund.return3m)}">${formatPct(fund.return3m)}</strong>
        </div>
        <div class="metric">
          <span>近1年</span>
          <strong class="${pctClass(fund.return1y)}">${formatPct(fund.return1y)}</strong>
        </div>
        <div class="metric">
          <span>今年以来</span>
          <strong class="${pctClass(fund.returnYtd)}">${formatPct(fund.returnYtd)}</strong>
        </div>
      </div>

      ${morningstarHtml(fund)}

      ${proMetricsHtml(fund)}

      ${fundCommentary(fund)}

      <div class="card-actions">
        <button class="button" type="button" data-detail="${fund.code}">详情</button>
        <label class="button compare-toggle ${checked ? "is-on" : ""}">
          <input type="checkbox" data-compare="${fund.code}" ${checked} hidden />
          对比
        </label>
      </div>
    </article>
  `;
}

function updateLoadMoreState() {
  const shown = Math.min(state.renderedCount, state.filtered.length);
  if (!els.loadMoreSentinel) return;
  const hasMore = shown < state.filtered.length;
  els.loadMoreSentinel.classList.toggle("hidden", !hasMore);
  els.loadMoreSentinel.textContent = hasMore ? "继续下拉加载更多" : "";
}

function renderFunds({ append = false } = {}) {
  if (!state.filtered.length) {
    const tip = state.favOnly ? "你还没有收藏任何基金。" : "没有匹配的 QDII 基金。换一个筛选条件试试。";
    els.fundGrid.innerHTML = `<div class="empty">${tip}</div>`;
    state.renderedCount = 0;
    updateLoadMoreState();
    return;
  }

  const nextCount = Math.min(state.visibleCount, state.filtered.length);
  const toRender = state.filtered.slice(append ? state.renderedCount : 0, nextCount);
  
  const html = toRender.map((fund, index) => fundCard(fund, index)).join("");

  if (append && state.renderedCount > 0 && nextCount > state.renderedCount) {
    els.fundGrid.insertAdjacentHTML("beforeend", html);
  } else {
    els.fundGrid.innerHTML = html;
  }
  
  state.renderedCount = nextCount;
  updateLoadMoreState();
}

function loadMoreFunds() {
  if (state.renderedCount >= state.filtered.length) return;
  state.visibleCount = Math.min(state.visibleCount + LOAD_MORE_BATCH_SIZE, state.filtered.length);
  renderFunds({ append: true });
}

function renderCompare() {
  const funds = Array.from(state.compare.values());
  els.comparePanel.classList.toggle("hidden", funds.length === 0);
  els.compareCount.textContent = `${funds.length}/6`;
  els.compareBody.innerHTML = funds.map((fund) => `
    <tr>
      <td><strong>${fund.code}</strong> ${fund.name}</td>
      <td>${fund.role} · ${fund.theme}</td>
      <td class="${pctClass(fund.return3m)}">${formatPct(fund.return3m)}</td>
      <td class="${pctClass(fund.return1y)}">${formatPct(fund.return1y)}</td>
      <td class="${pctClass(fund.returnYtd)}">${formatPct(fund.returnYtd)}</td>
      <td>${fund.ratingMorningstar ? "★".repeat(fund.ratingMorningstar) + "☆".repeat(5 - fund.ratingMorningstar) : "--"}</td>
      <td>${fund.risk}</td>
    </tr>
  `).join("");
}

function openDrawer(html) {
  els.drawerContent.innerHTML = html;
  els.drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  els.drawer.setAttribute("aria-hidden", "true");
  els.drawer.classList.remove("drawer--from-chat");
  els.drawer.dataset.code = "";
  activeManagerId = null;

  const panel = $("managerPanel");
  if (panel) {
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    panel.innerHTML = "";
  }

  document.querySelectorAll(".fund-card, .chat-card").forEach((card) => {
    card.classList.remove("is-selected");
  });
}

function drawerMorningstarInlineHtml(fund) {
  const star = fund.ratingMorningstar;
  if (!star) {
    return `<div class="drawer-rating-inline muted"><span class="drawer-rating-label">晨星</span><span class="rating-stars muted">暂无</span></div>`;
  }
  const filled = "★".repeat(star);
  const empty = "☆".repeat(5 - star);
  return `<div class="drawer-rating-inline"><span class="drawer-rating-label">晨星</span><span class="rating-stars">${filled}<span class="rating-stars-empty">${empty}</span></span><span class="drawer-rating-meta">${star} 星</span></div>`;
}

function drawerProMetricsHtml(fund) {
  const aum = formatAum(fund.aumBillion, fund);
  const dd = fund.maxDrawdown1y !== null && fund.maxDrawdown1y !== undefined ? `${Number(fund.maxDrawdown1y).toFixed(2)}%` : "--";
  const sharpe = fund.sharpe1y !== null && fund.sharpe1y !== undefined ? Number(fund.sharpe1y).toFixed(2) : "--";
  const vol = fund.volatility1y !== null && fund.volatility1y !== undefined ? `${fund.volatility1y.toFixed(2)}%` : "--";
  const managers = fund.managerNames || "--";
  const aumDate = fund.aumDate ? `<span class="pro-meta">规模截止 ${fund.aumDate}</span>` : "";
  const tip = (text) => `<span class="info-tip" tabindex="0" aria-label="${escapeHtml(text)}"><span aria-hidden="true">i</span><span class="info-tip__bubble" role="tooltip">${escapeHtml(text)}</span></span>`;
  return `
      <h4>专业指标</h4>
      <div class="pro-detail-grid">
        <div class="pro-detail-item">
          <div class="pro-detail-head">
            <span class="pro-label">基金规模 ${tip("在管资产，太小有清盘风险；主动基金过大可能跑不动")}</span>
            ${aumDate}
          </div>
          <strong>${aum}</strong>
        </div>
        <div class="pro-detail-item">
          <span class="pro-label">近1年最大回撤 ${tip("历史从高点跌到低点的最大幅度，越接近 0 越平稳")}</span>
          <strong class="${fund.maxDrawdown1y !== null && fund.maxDrawdown1y < -20 ? "down" : ""}">${dd}</strong>
        </div>
        <div class="pro-detail-item">
          <span class="pro-label">夏普比率（近1年） ${tip("每承担一份风险获得多少超额收益，>1 优秀，>2 极好")}</span>
          <strong class="${fund.sharpe1y !== null && fund.sharpe1y > 1 ? "up" : ""}">${sharpe}</strong>
        </div>
        <div class="pro-detail-item">
          <span class="pro-label">年化波动率（近1年） ${tip("价格波动剧烈程度，越小越平稳")}</span>
          <strong>${vol}</strong>
        </div>
      </div>
  `;
}

function drawerInsightsBlockHtml(fund) {
  return `
    <div class="detail-block detail-block--insights">
      ${drawerProMetricsHtml(fund)}
      <h4 class="detail-subhead">AI 点评</h4>
      ${aiSummarySkeletonHtml(fund)}
    </div>
  `;
}

let activeManagerId = null;

function normalizeManagers(managers, fund) {
  if (Array.isArray(managers) && managers.length) return managers;
  const names = (fund?.managerNames || "").split(/[、,，]/).map((n) => n.trim()).filter(Boolean);
  return names.map((name) => ({ id: null, name }));
}

function drawerManagersLinksHtml(managers, fund) {
  const list = normalizeManagers(managers, fund);
  if (!list.length) return `<span class="managers-plain">--</span>`;
  return list
    .map((m, index) => {
      const sep = index < list.length - 1 ? '<span class="managers-sep">、</span>' : "";
      if (m.id) {
        return `<button type="button" class="manager-link" data-manager-id="${m.id}" data-manager-name="${escapeHtml(m.name)}">${escapeHtml(m.name)}</button>${sep}`;
      }
      return `<span class="managers-plain">${escapeHtml(m.name)}</span>${sep}`;
    })
    .join("");
}


function formatManagerTenure(period) {
  return String(period || "")
    .replace(/^自/, "")
    .replace(/起任职\s*\)?$/, "至今")
    .replace(/任职\s*\)?$/, "");
}

function renderManagerBioHtml(bioStructured) {
  const bio = bioStructured || {};
  const blocks = [];

  if (bio.education) {
    blocks.push(
      `<div class="manager-panel__section"><span class="manager-panel__label">学历资质</span><p class="manager-panel__text">${escapeHtml(bio.education)}</p></div>`,
    );
  }
  if (bio.companyRole) {
    blocks.push(
      `<div class="manager-panel__section"><span class="manager-panel__label">现任职务</span><p class="manager-panel__text">${escapeHtml(bio.companyRole)}</p></div>`,
    );
  }
  if (bio.activeRoles?.length) {
    const items = bio.activeRoles
      .map(
        (r) =>
          `<li><span class="manager-role-title">${escapeHtml(r.title)}</span><span class="manager-role-period">${escapeHtml(formatManagerTenure(r.period))}</span></li>`,
      )
      .join("");
    blocks.push(
      `<div class="manager-panel__section"><span class="manager-panel__label">在管产品</span><ul class="manager-role-list">${items}</ul></div>`,
    );
  }
  if (bio.pastRoles?.length) {
    const items = bio.pastRoles
      .map(
        (r) =>
          `<li><span class="manager-role-title">${escapeHtml(r.title)}</span><span class="manager-role-period">${escapeHtml(formatManagerTenure(r.period))}</span></li>`,
      )
      .join("");
    blocks.push(
      `<div class="manager-panel__section manager-panel__section--muted"><span class="manager-panel__label">历任节选</span><ul class="manager-role-list">${items}</ul></div>`,
    );
  }

  return blocks.join("");
}

function renderManagerPanel(profile, fundCode) {
  const meta = [
    profile.tenure ? `累计任职 ${profile.tenure}` : "",
    profile.startDate ? `起始 ${profile.startDate}` : "",
    profile.company || "",
    profile.totalAumText ? `在管规模 ${profile.totalAumText}` : "",
  ].filter(Boolean);

  const funds = (profile.currentFunds || [])
    .slice(0, 8)
    .map((f) => {
      const currentCls = f.code === fundCode ? " is-current" : "";
      return `<li class="manager-fund-item${currentCls}"><button type="button" class="manager-fund-link" data-detail="${f.code}">${escapeHtml(f.name)} <span class="code">${f.code}</span></button></li>`;
    })
    .join("");

  return `
    <div class="manager-panel__inner">
      ${meta.length ? `<div class="manager-panel__meta">${meta.map((t) => `<span>${escapeHtml(t)}</span>`).join("")}</div>` : ""}
      ${renderManagerBioHtml(profile.bioStructured)}
      ${funds ? `<div class="manager-panel__section"><span class="manager-panel__label">现任基金</span><ul class="manager-fund-list">${funds}</ul></div>` : ""}
    </div>
  `;
}

async function toggleManagerPanel(managerId, managerName, fundCode) {
  const panel = $("managerPanel");
  if (!panel) return;

  if (activeManagerId === managerId && !panel.hidden) {
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    activeManagerId = null;
    els.drawerContent.querySelectorAll(".manager-link.is-active").forEach((el) => el.classList.remove("is-active"));
    return;
  }

  activeManagerId = managerId;
  els.drawerContent.querySelectorAll(".manager-link").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.managerId === managerId);
  });

  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");
  panel.innerHTML = `<p class="hint">正在加载 ${escapeHtml(managerName)} 的档案…</p>`;

  try {
    const res = await fetch(`/api/manager/${managerId}`);
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "加载失败");
    panel.innerHTML = renderManagerPanel(data, fundCode);
  } catch (error) {
    panel.innerHTML = `<p class="hint">加载失败：${escapeHtml(error.message)}</p>`;
  }
}

function aiSummarySkeletonHtml(fund) {
  if (fund.aiSummary) {
    return `<div id="aiSummaryBox" class="ai-summary-box">
      <p class="ai-summary">${escapeHtml(fund.aiSummary)}</p>
    </div>`;
  }
  return `<div id="aiSummaryBox" class="ai-summary-box"><p class="hint">正在加载 AI 点评...</p></div>`;
}

function detailSkeleton(fund, { navReady = false, detailReady = false, managers = null } = {}) {
  const ddVal = fund.maxDrawdown1y !== null && fund.maxDrawdown1y !== undefined ? Number(fund.maxDrawdown1y) : null;
  const dd = ddVal !== null ? `${ddVal.toFixed(1)}%` : "--";
  const ddCls = ddVal !== null && ddVal < 0 ? "down" : "";
  
  let riskCls = "";
  if (fund.risk && fund.risk.includes("高")) riskCls = "up";
  else if (fund.risk && fund.risk.includes("低")) riskCls = "down";
  else riskCls = "warn-text";

  const navBlock = navReady
    ? `<div id="navChart" class="nav-chart-wrap"></div>`
    : `<div id="navChart" class="nav-chart-wrap"><p class="hint">正在加载历史净值...</p></div>`;
  const remoteBlock = detailReady
    ? `<div class="detail-block" id="remoteDetail"></div>`
    : `<div class="detail-block" id="remoteDetail"><h4>基金资料</h4><p class="hint">正在读取基金公司披露资料...</p></div>`;
  
  return `
    <div class="drawer-header">
      <div class="drawer-head-actions">
        <button class="drawer-act-btn" type="button" data-ask="${fund.code}" title="就这只基金向 AI 投顾提问" aria-label="向 AI 提问">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
        <button class="drawer-act-btn" type="button" data-fav-ph="${fund.code}" title="收藏（账号系统上线后开放）" aria-label="收藏">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </button>
      </div>
      <h2>${fund.name}</h2>
      <div class="drawer-subtitle">
        <p class="code">${fund.code} · ${fund.region} · ${fund.theme} · ${fund.role}</p>
        <p class="managers"><span class="managers-label">现任经理：</span>${drawerManagersLinksHtml(managers, fund)}</p>
      </div>
      <div id="managerPanel" class="manager-panel" hidden aria-hidden="true"></div>
    </div>
    <div class="detail-block detail-block--nav">
      <div class="detail-block-top">
        <h4>净值走势</h4>
        ${drawerMorningstarInlineHtml(fund)}
      </div>
      ${navBlock}
    </div>
    <div class="summary-grid">
      <div class="summary"><span>单位净值</span><strong>${formatNumber(fund.nav, 2)}</strong></div>
      <div class="summary"><span>近1年</span><strong class="${pctClass(fund.return1y)}">${formatPct(fund.return1y)}</strong></div>
      <div class="summary"><span>近1年回撤</span><strong class="${ddCls}">${dd}</strong></div>
      <div class="summary"><span>风险</span><strong class="${riskCls}">${fund.risk}</strong></div>
    </div>
    ${drawerInsightsBlockHtml(fund)}
    ${tradeStatusBlock(fund)}
    ${remoteBlock}
  `;
}

function renderAiSummaryBox(summary, model, generatedAt) {
  const box = $("aiSummaryBox");
  if (!box) return;
  if (!summary) {
    box.innerHTML = '<p class="hint">这只基金还没有 AI 点评。</p>';
    return;
  }
  box.innerHTML = `<p class="ai-summary">${escapeHtml(summary)}</p>`;
}

let toastTimer = null;
function flashToast(message) {
  let el = document.getElementById("appToast");
  if (!el) {
    el = document.createElement("div");
    el.id = "appToast";
    el.className = "app-toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 2400);
}

async function showDetail(code, options = {}) {
  const fund = state.funds.find((item) => item.code === code);
  if (!fund) return;
  if (options.fromChat) {
    els.drawer.classList.add("drawer--from-chat");
  } else {
    els.drawer.classList.remove("drawer--from-chat");
    window.qdiiCompass?.closeChat?.();
  }
  els.drawer.dataset.code = code;

  // Update selected state on fund cards
  document.querySelectorAll('.fund-card').forEach(card => {
    card.classList.remove('is-selected');
  });
  
  // Find the button that opened this detail and select its parent card
  // Search in both main grid and chat panel
  const detailButtons = document.querySelectorAll(`button[data-detail="${code}"]`);
  detailButtons.forEach(btn => {
    const card = btn.closest('.fund-card');
    if (card) {
      card.classList.add('is-selected');
    }
    const chatCard = btn.closest('.chat-card');
    if (chatCard) {
      chatCard.classList.add('is-selected');
    }
  });

  const memCached = state.detailCache.get(code);
  const sessionCached = readDetailCache(code);
  const cached = memCached || sessionCached;
  if (sessionCached && !memCached) state.detailCache.set(code, sessionCached);

  activeManagerId = null;
  openDrawer(
    detailSkeleton(fund, {
      navReady: Boolean(cached?.navHistory?.length),
      detailReady: Boolean(cached?.goal || cached?.scope),
      managers: cached?.managers || null,
    }),
  );
  if (cached) applyDetail(code, fund, cached);

  try {
    const response = await fetch(`/api/fund/${code}`);
    const detail = await response.json();
    if (!response.ok || detail.error) throw new Error(detail.error || "详情读取失败");
    state.detailCache.set(code, detail);
    writeDetailCache(code, detail);
    if (els.drawer.dataset.code === code) applyDetail(code, fund, detail);
  } catch (error) {
    if (!cached && els.drawer.dataset.code === code) {
      const box = $("remoteDetail");
      if (box) box.innerHTML = `<h4>基金资料</h4><p>详情读取失败：${error.message}</p>`;
    }
  }
}

function applyDetail(code, fund, detail) {
  const managersEl = els.drawerContent.querySelector(".drawer-subtitle .managers");
  if (managersEl && detail.managers) {
    managersEl.innerHTML = `<span class="managers-label">现任经理：</span>${drawerManagersLinksHtml(detail.managers, fund)}`;
  }

  if (detail.maxDrawdown1y !== null && detail.maxDrawdown1y !== undefined && fund.maxDrawdown1y !== detail.maxDrawdown1y) {
    fund.maxDrawdown1y = detail.maxDrawdown1y;
    const ddEl = els.drawerContent.querySelector(".summary-grid .summary:nth-child(3) strong");
    if (ddEl) {
      ddEl.textContent = `${Number(detail.maxDrawdown1y).toFixed(1)}%`;
      ddEl.className = detail.maxDrawdown1y < 0 ? "down" : "";
    }
  }
  const feeEl = $("feeBlock");
  if (feeEl) feeEl.innerHTML = feeRateTable(detail.buyFees, detail.redeemFees, detail.operatingFees);
  renderNavChart($("navChart"), detail.navHistory || []);
  renderAiSummaryBox(
    detail.aiSummary || fund.aiSummary,
    detail.aiSummaryModel || fund.aiSummaryModel,
    detail.aiSummaryAt || fund.aiSummaryAt,
  );
  const box = $("remoteDetail");
  if (box) {
    box.innerHTML = `
      ${holdingsHtml(detail)}
      ${assetAllocationHtml(detail)}
      <h4>AI 实时分析</h4>
      ${analysisHtml(detail.analysis)}
      <div class="detail-block nested">
        <h4>基金资料</h4>
        <p><strong>投资目标：</strong>${detail.goal || "暂无解析结果，可打开原始资料查看。"}</p>
        <p><strong>投资范围：</strong>${detail.scope || "暂无解析结果。"}</p>
        <div class="drawer-actions">
          <a class="button primary" href="${detail.detailUrl}" target="_blank" rel="noreferrer">打开完整 F10</a>
        </div>
      </div>
    `;
  }
}

const FUNDS_CACHE_KEY = "qdii-funds-cache-v2";
const FUNDS_CACHE_TTL_MS = 7 * 24 * 3600 * 1000;
const DETAIL_CACHE_PREFIX = "qdii-detail-v2-";
const DETAIL_CACHE_TTL_MS = 24 * 3600 * 1000;

function readDetailCache(code) {
  try {
    const raw = localStorage.getItem(`${DETAIL_CACHE_PREFIX}${code}`);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || Date.now() - (data.cachedAt || 0) > DETAIL_CACHE_TTL_MS) return null;
    return data.detail;
  } catch {
    return null;
  }
}

function evictOldDetailCache(keepCount = 30) {
  try {
    const entries = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DETAIL_CACHE_PREFIX)) {
        let at = 0;
        try { at = JSON.parse(localStorage.getItem(k))?.cachedAt || 0; } catch {}
        entries.push({ k, at });
      }
    }
    entries.sort((a, b) => a.at - b.at);
    for (const e of entries.slice(0, Math.max(0, entries.length - keepCount))) {
      localStorage.removeItem(e.k);
    }
  } catch {
    // ignore
  }
}

function writeDetailCache(code, detail) {
  const payload = JSON.stringify({ cachedAt: Date.now(), detail });
  try {
    localStorage.setItem(`${DETAIL_CACHE_PREFIX}${code}`, payload);
  } catch {
    // 配额满：清掉最旧的缓存后重试一次
    evictOldDetailCache(20);
    try {
      localStorage.setItem(`${DETAIL_CACHE_PREFIX}${code}`, payload);
    } catch {
      // 仍失败则忽略
    }
  }
}

function readFundsCache() {
  try {
    const raw = localStorage.getItem(FUNDS_CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.funds) || !data.funds.length) return null;
    if (Date.now() - (data.cachedAt || 0) > FUNDS_CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function writeFundsCache(payload) {
  try {
    localStorage.setItem(
      FUNDS_CACHE_KEY,
      JSON.stringify({
        fetchedAt: payload.fetchedAt,
        fetchedAtText: payload.fetchedAtText,
        total: payload.total,
        funds: payload.funds,
        cachedAt: Date.now(),
      })
    );
  } catch {
    // 配额满或隐私模式，忽略
  }
}

function renderFundsPayload(payload, statusText) {
  state.funds = payload.funds;
  renderSummary(payload);
  renderFilters();
  applyFilters();
  if (statusText) els.statusText.textContent = statusText;
}

async function loadFunds() {
  let renderedFromCache = false;
  const cached = readFundsCache();
  if (cached) {
    const cacheAgeMin = Math.round((Date.now() - cached.cachedAt) / 60000);
    renderFundsPayload(
      cached,
      `已加载 ${cached.total} 只 QDII 基金（${cacheAgeMin} 分钟前本地缓存，正在同步最新…）`
    );
    renderedFromCache = true;
  } else {
    els.statusText.textContent = "正在加载 QDII 基金数据...";
  }

  try {
    const response = await fetch("/api/funds");
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || "数据加载失败");
    writeFundsCache(payload);
    const updateHint = payload.fetchedAtText ? `数据更新至 ${payload.fetchedAtText}。` : "";
    renderFundsPayload(
      payload,
      `已加载 ${payload.total} 只 QDII 基金。${updateHint}数据来自东方财富 + 天天基金 F10 公开页面，不构成投资建议。`
    );
  } catch (error) {
    if (renderedFromCache) {
      els.statusText.textContent = `同步失败：${error.message}（仍在使用本地缓存）`;
    } else {
      els.statusText.textContent = `加载失败：${error.message}`;
      els.fundGrid.innerHTML = `<div class="empty">无法获取数据，请稍后重试或联系管理员检查服务配置。</div>`;
    }
  }
}

async function loadFavorites() {
  if (!getSession()) {
    state.favorites = new Set();
    return;
  }
  try {
    const res = await authedFetch("/api/favorites");
    if (!res.ok) return;
    const data = await res.json();
    state.favorites = new Set(data.favorites || []);
    renderFunds();
  } catch {
    // ignore
  }
}

async function toggleFavorite(code) {
  if (!getSession()) {
    openAuthModal("login");
    return;
  }
  const isFav = state.favorites.has(code);
  try {
    if (isFav) {
      state.favorites.delete(code);
      renderFunds();
      await authedFetch(`/api/favorites/${code}`, { method: "DELETE" });
    } else {
      state.favorites.add(code);
      renderFunds();
      await authedFetch("/api/favorites", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
    }
  } catch (error) {
    // 回滚
    if (isFav) state.favorites.add(code); else state.favorites.delete(code);
    renderFunds();
    alert("收藏操作失败：" + error.message);
  }
}

function openAuthModal(mode = "login") {
  authMode = mode;
  els.authError.classList.add("hidden");
  els.authError.textContent = "";
  els.authForm.reset();
  if (mode === "login") {
    els.authTitle.textContent = "登录";
    els.authHint.textContent = "登录后即可使用 AI 投顾、收藏和基金对比。";
    els.authSubmit.textContent = "登录";
    els.authSwitchText.textContent = "还没有账号？";
    els.authSwitchLink.textContent = "注册一个";
    els.authInviteRow.classList.add("hidden");
  } else {
    els.authTitle.textContent = "注册";
    els.authHint.textContent = "注册需要邀请码，邮箱不会发送验证邮件。";
    els.authSubmit.textContent = "注册并登录";
    els.authInviteRow.classList.remove("hidden");
    els.authSwitchText.textContent = "已有账号？";
    els.authSwitchLink.textContent = "直接登录";
  }
  els.authModal.setAttribute("aria-hidden", "false");
}

function closeAuthModal() {
  els.authModal.setAttribute("aria-hidden", "true");
}

async function openProfileModal() {
  let current = {};
  try {
    const res = await authedFetch("/api/profile");
    if (res.ok) {
      const data = await res.json();
      current = data.profile || {};
    }
  } catch {}

  const REGIONS = ["美国", "欧洲", "日本", "印度", "港股", "亚太/新兴", "全球"];
  const currentRegions = new Set(Array.isArray(current.regions) ? current.regions : []);
  const colMap = { riskPref: 'risk_pref', amountBand: 'amount_band', fundYears: 'fund_years' };
  const opt = (val, label, group) => `<label class="profile-opt"><input type="${group === 'regions' ? 'checkbox' : 'radio'}" name="${group}" value="${val}" ${group === 'regions' ? (currentRegions.has(val) ? 'checked' : '') : (current[colMap[group] || group] === val ? 'checked' : '')}><span>${label}</span></label>`;

  const wrap = document.createElement("div");
  wrap.className = "modal";
  wrap.setAttribute("aria-hidden", "false");
  wrap.innerHTML = `
    <div class="modal-card">
      <button class="icon-button" type="button" data-close>×</button>
      <h3>偏好设置（5 题，可跳过）</h3>
      <p class="muted">这些偏好会影响 AI 投顾帮你筛选/排序基金，也会让它的回答更贴合你的经验和风险偏好，不会影响你点开看任何基金。</p>
      <form id="profileForm" class="profile-form">
        <fieldset><legend>1. 风险偏好</legend>
          ${opt("low", "保守（中低波动优先）", "riskPref")}
          ${opt("mid", "平衡", "riskPref")}
          ${opt("high", "进取（高波动可接受）", "riskPref")}
        </fieldset>
        <fieldset><legend>2. 计划持有期</legend>
          ${opt("short", "1 年内", "horizon")}
          ${opt("mid", "1-3 年", "horizon")}
          ${opt("long", "3 年以上", "horizon")}
        </fieldset>
        <fieldset><legend>3. 已经配置过的海外区域（可多选）</legend>
          <div class="profile-regions">${REGIONS.map((r) => opt(r, r, "regions")).join("")}</div>
        </fieldset>
        <fieldset><legend>4. 可投资金额区间</legend>
          ${opt("<10w", "10 万以内", "amountBand")}
          ${opt("10-50w", "10-50 万", "amountBand")}
          ${opt("50-200w", "50-200 万", "amountBand")}
          ${opt(">200w", "200 万以上", "amountBand")}
        </fieldset>
        <fieldset><legend>5. 投资基金年限</legend>
          ${opt("none", "没买过基金", "fundYears")}
          ${opt("lt1", "1 年以内", "fundYears")}
          ${opt("1to3", "1-3 年", "fundYears")}
          ${opt("3to5", "3-5 年", "fundYears")}
          ${opt("gt5", "5 年以上", "fundYears")}
        </fieldset>
        <div class="modal-actions">
          <button type="button" class="button" data-close>取消</button>
          <button type="submit" class="button primary">保存</button>
        </div>
        <p class="profile-error muted hidden"></p>
      </form>
    </div>`;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", close));
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });

  wrap.querySelector("#profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const regions = fd.getAll("regions");
    const payload = {
      riskPref: fd.get("riskPref") || null,
      horizon: fd.get("horizon") || null,
      amountBand: fd.get("amountBand") || null,
      fundYears: fd.get("fundYears") || null,
      regions,
    };
    const errEl = wrap.querySelector(".profile-error");
    errEl.classList.add("hidden");
    try {
      const res = await authedFetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      close();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove("hidden");
    }
  });
}

function renderAuthArea(session) {
  if (session?.user?.email) {
    els.authArea.innerHTML = `
      <span class="user-email" title="${session.user.email}">${session.user.email}</span>
      <button id="profileBtn" class="button" type="button">偏好</button>
      <button id="logoutBtn" class="button" type="button">退出</button>
    `;
    $("logoutBtn").addEventListener("click", async () => {
      await signOut();
    });
    $("profileBtn").addEventListener("click", () => openProfileModal());
    els.favOnlyToggle.classList.remove("hidden");
  } else {
    els.authArea.innerHTML = `<button id="loginBtn" class="button" type="button">登录</button>`;
    $("loginBtn").addEventListener("click", () => openAuthModal("login"));
    els.favOnlyToggle.classList.add("hidden");
    state.favOnly = false;
    els.favOnlyCheckbox.checked = false;
  }
}

els.searchInput.addEventListener("input", (event) => {
  state.filters.search = event.target.value;
  deactivateChipIfAny();
  applyFilters();
});

els.regionFilter.addEventListener("change", (event) => {
  state.filters.region = event.target.value;
  deactivateChipIfAny();
  applyFilters();
});

els.themeFilter.addEventListener("change", (event) => {
  state.filters.theme = event.target.value;
  deactivateChipIfAny();
  applyFilters();
});

els.roleFilter.addEventListener("change", (event) => {
  state.filters.role = event.target.value;
  deactivateChipIfAny();
  applyFilters();
});

els.purchaseFilter?.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-purchase]");
  if (!btn) return;
  state.filters.purchase = state.filters.purchase === btn.dataset.purchase ? "全部" : btn.dataset.purchase;
  syncPurchaseSeg();
  deactivateChipIfAny();
  applyFilters();
});

if (els.quickChipRow) {
  els.quickChipRow.addEventListener("click", (event) => {
    const clearBtn = event.target.closest("[data-chip-clear]");
    if (clearBtn) { clearChip(); return; }
    const chipBtn = event.target.closest("[data-chip]");
    if (chipBtn) applyChip(chipBtn.dataset.chip);
  });
  renderQuickChips();
}

els.sortSelect.addEventListener("change", (event) => {
  state.filters.sort = event.target.value;
  deactivateChipIfAny();
  applyFilters();
});

els.clearCompareBtn.addEventListener("click", () => {
  state.compare.clear();
  renderCompare();
  renderFunds();
});

els.favOnlyCheckbox.addEventListener("change", (event) => {
  state.favOnly = event.target.checked;
  applyFilters();
});

els.fundGrid.addEventListener("change", (event) => {
  const code = event.target?.dataset?.compare;
  if (!code) return;
  if (!getSession()) {
    event.target.checked = false;
    const toggle = event.target.closest(".compare-toggle");
    if (toggle) toggle.classList.remove("is-on");
    openAuthModal("login");
    return;
  }
  const fund = state.funds.find((item) => item.code === code);
  if (!fund) return;
  if (event.target.checked) {
    if (state.compare.size >= 6) {
      event.target.checked = false;
      return;
    }
    state.compare.set(code, fund);
  } else {
    state.compare.delete(code);
  }
  renderCompare();
  const toggle = event.target.closest(".compare-toggle");
  if (toggle) toggle.classList.toggle("is-on", event.target.checked);
});

els.fundGrid.addEventListener("click", (event) => {
  const askBtn = event.target.closest?.("[data-ask]");
  if (askBtn) {
    event.stopPropagation();
    window.qdiiCompass?.askAboutFund?.(askBtn.dataset.ask);
    return;
  }
  const detailCode = event.target?.dataset?.detail;
  if (detailCode) {
    showDetail(detailCode);
    return;
  }
  const favCode = event.target?.dataset?.fav;
  if (favCode) {
    toggleFavorite(favCode);
  }
});

if (els.loadMoreSentinel) {
  const loadMoreObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMoreFunds();
    },
    { rootMargin: "700px 0px" }
  );
  loadMoreObserver.observe(els.loadMoreSentinel);
}

els.closeDrawerBtn.addEventListener("click", closeDrawer);
els.drawer.addEventListener("click", (event) => {
  if (event.target === els.drawer) closeDrawer();
});

els.drawerContent.addEventListener("click", (event) => {
  const managerBtn = event.target.closest(".manager-link");
  if (managerBtn?.dataset.managerId) {
    event.preventDefault();
    toggleManagerPanel(managerBtn.dataset.managerId, managerBtn.dataset.managerName, els.drawer.dataset.code);
    return;
  }
  const fundBtn = event.target.closest(".manager-fund-link");
  if (fundBtn?.dataset.detail) {
    event.preventDefault();
    showDetail(fundBtn.dataset.detail, { fromChat: els.drawer.classList.contains("drawer--from-chat") });
    return;
  }
  const askBtn = event.target.closest("[data-ask]");
  if (askBtn) {
    event.preventDefault();
    const code = askBtn.dataset.ask;
    window.qdiiCompass?.askAboutFund?.(code);
    return;
  }
  const favPhBtn = event.target.closest("[data-fav-ph]");
  if (favPhBtn) {
    event.preventDefault();
    favPhBtn.classList.toggle("is-on");
    flashToast("收藏功能将随账号系统上线后开放");
    return;
  }
  const feeTabBtn = event.target.closest("[data-fee-tab]");
  if (feeTabBtn) {
    event.preventDefault();
    const wrap = feeTabBtn.closest(".fee-tabs");
    const target = feeTabBtn.dataset.feeTab;
    wrap.querySelectorAll("[data-fee-tab]").forEach((b) => b.classList.toggle("is-active", b.dataset.feeTab === target));
    wrap.querySelectorAll("[data-fee-pane]").forEach((p) => { p.hidden = p.dataset.feePane !== target; });
  }
});

els.closeAuthBtn.addEventListener("click", closeAuthModal);
els.authModal.addEventListener("click", (event) => {
  if (event.target === els.authModal) closeAuthModal();
});

els.authSwitchLink.addEventListener("click", (event) => {
  event.preventDefault();
  openAuthModal(authMode === "login" ? "signup" : "login");
});

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  const inviteCode = els.authInvite.value.trim();
  els.authSubmit.disabled = true;
  els.authError.classList.add("hidden");
  try {
    if (authMode === "login") {
      await signIn(email, password);
    } else {
      await signUp(email, password, inviteCode);
    }
    closeAuthModal();
  } catch (error) {
    els.authError.textContent = error.message;
    els.authError.classList.remove("hidden");
  } finally {
    els.authSubmit.disabled = false;
  }
});

if (els.loginBtn) {
  els.loginBtn.addEventListener("click", () => openAuthModal("login"));
}

await initAuth();
onAuthChange((session) => {
  renderAuthArea(session);
  loadFavorites();
});

window.qdiiCompass = window.qdiiCompass || {};
window.qdiiCompass.showDetail = showDetail;
window.qdiiCompass.showChatDetail = (code) => {
  const isOpen = els.drawer.getAttribute("aria-hidden") === "false";
  const sameCode = els.drawer.dataset.code === code;
  const fromChat = els.drawer.classList.contains("drawer--from-chat");
  if (isOpen && sameCode && fromChat) {
    closeDrawer();
    return;
  }
  showDetail(code, { fromChat: true });
};
window.qdiiCompass.closeDrawer = closeDrawer;
window.qdiiCompass.getFund = (code) => state.funds.find((f) => f.code === code) || null;
window.qdiiCompass.getAccessToken = () => getToken();
window.qdiiCompass.isLoggedIn = () => !!getSession();
window.qdiiCompass.requireLogin = () => openAuthModal("login");

loadFunds();
