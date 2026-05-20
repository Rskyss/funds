/* QDII Compass — UI components */
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  QUICK_CHIPS,
} from "./data.js";
import { getToken, getSession } from "./auth.js";
import { readDetailCache, writeDetailCache } from "./detailCache.js";

// 清洗 AI 卡片点评：去掉模型可能带出来的「(42字)」字数标注与整句外包的引号
function cleanAiSummary(s) {
  if (!s) return s;
  let t = String(s).trim();
  t = t.replace(/[（(]\s*\d+\s*字\s*[)）]\s*$/g, "").trim();
  const head = /^[“”‘’「『"']+/;
  const tail = /[“”‘’」』"']+$/;
  for (let i = 0; i < 3; i++) {
    const before = t;
    t = t.replace(head, "").replace(tail, "").trim();
    if (t === before) break;
  }
  return t;
}

// ============== Number count-up ==============
function CountUp({ value, duration = 1100, decimals = 0, prefix = "", suffix = "" }) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const start = Date.now();
    const format = (v) => {
      const disp = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString();
      return `${prefix}${disp}${suffix}`;
    };
    if (ref.current) ref.current.textContent = format(0);
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      const p = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const cur = value * eased;
      if (ref.current) ref.current.textContent = format(cur);
      if (p >= 1) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [value, duration, decimals, prefix, suffix]);

  const initial = decimals > 0 ? (0).toFixed(decimals) : "0";
  return <span className="num" ref={ref}>{prefix}{initial}{suffix}</span>;
}

// ============== Sparkline ==============
function Sparkline({
  data, width = 100, height = 28, stroke,
  fill = false, fillStops = null, animate = true, glow = false,
  thickness = 1.5, endpoint = false, gridLines = 0,
}) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 2;
  const step = (width - pad * 2) / (data.length - 1);

  const pts = data.map((v, i) => [
    pad + i * step,
    pad + (height - pad * 2) * (1 - (v - min) / range),
  ]);
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join(" ");
  const areaPath = `${path} L${pts[pts.length - 1][0].toFixed(2)} ${height - pad} L${pts[0][0].toFixed(2)} ${height - pad} Z`;
  const last = pts[pts.length - 1];
  const trend = data[data.length - 1] >= data[0] ? "up" : "down";
  const strokeColor = stroke || (trend === "up" ? "var(--up)" : "var(--down)");

  // unique grad id
  const gid = useMemo(() => "g" + Math.random().toString(36).slice(2, 8), []);

  return (
    <svg className="spark-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" width={width} height={height}>
      <defs>
        {fill && (
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity={fillStops ? fillStops[0] : 0.22}/>
            <stop offset="100%" stopColor={strokeColor} stopOpacity={fillStops ? fillStops[1] : 0}/>
          </linearGradient>
        )}
      </defs>

      {gridLines > 0 && Array.from({ length: gridLines }).map((_, i) => {
        const y = pad + (height - pad * 2) * ((i + 1) / (gridLines + 1));
        return <line key={i} className="grid-line" x1={pad} x2={width - pad} y1={y} y2={y}/>;
      })}

      {fill && (
        <path d={areaPath} fill={`url(#${gid})`} className={`nav-area ${animate ? "draw-area" : ""}`}/>
      )}
      <path d={path} className={`nav-line ${trend} ${animate ? "draw-line" : ""}`} stroke={strokeColor} strokeWidth={thickness}/>

      {endpoint && (
        <g>
          <circle className="endpoint-pulse" cx={last[0]} cy={last[1]} r={3} fill={strokeColor}/>
          <circle className="endpoint" cx={last[0]} cy={last[1]} r={3} stroke={strokeColor}/>
        </g>
      )}
    </svg>
  );
}

// ============== Top bar ==============
function TopBar({ onOpenChat, session, onLogin, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const email = session?.user?.email || "";
  const initial = email ? email[0].toUpperCase() : "?";
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = () => setMenuOpen(false);
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [menuOpen]);
  return (
    <header className="topbar">
      <div className="topbar__inner">
        <div className="brand">
          <div className="brand__mark" aria-hidden="true"></div>
          <div>
            <div className="brand__title">QDII 罗盘</div>
            <div className="brand__sub">FUND COMPASS · PRO</div>
          </div>
        </div>

<div className="topbar__actions">
          <button className="icon-btn" title="通知">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/></svg>
          </button>
          <button className="btn btn--primary" onClick={onOpenChat}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-9-9"/><path d="M21 3v6h-6"/></svg>
            AI 投顾
          </button>
          {session ? (
            <div className="avatar-menu">
              <button
                className="avatar"
                title={email}
                onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              >
                {initial}
              </button>
              {menuOpen && (
                <div className="avatar-menu__pop" onClick={(e) => e.stopPropagation()}>
                  <div className="avatar-menu__email">{email}</div>
                  <button className="avatar-menu__item" onClick={() => { setMenuOpen(false); onLogout?.(); }}>
                    退出登录
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button className="btn btn--ghost" onClick={onLogin}>登录</button>
          )}
        </div>
      </div>
    </header>
  );
}

// ============== Hero / KPI ==============
function Hero({ boards = [], selected, onSelect, total, updatedText }) {
  return (
    <section className="hero">
      <div className="hero__grid"/>

      <div className="hero__meta-row">
        <span className="hero__eyebrow">QDII MARKET COMPASS · 海外配置罗盘</span>
        <div className="hero__time">
          数据更新 <strong>{updatedText || "—"}</strong>
        </div>
      </div>

      <div className="hero__layout">
        <div className="hero__content">
          <h1>看清海外基金<br/>把每个决策落到数据上</h1>
          <p className="hero__sub">汇总 {total || "全市场"} 只跨境 QDII 基金的实时净值、回撤、夏普与持仓变化，配合 AI 投顾给出可解释的研究依据。</p>
        </div>

        <div className="hero__data">
          <div className="boards-head">
            <span className="boards-head__title">今日 QDII 板块风向 <span className="boards-head__sub">今日平均涨跌</span></span>
          </div>
          <div className="boards">
            {boards.map((b) => {
              const up = b.avg1d >= 0;
              const active = selected === b.theme;
              return (
                <button
                  key={b.theme}
                  className={`board ${active ? "is-active" : ""}`}
                  onClick={() => onSelect(b.theme)}
                >
                  <div className="board__name">
                    {b.theme}
                    <span className="board__count">{b.count} 只</span>
                  </div>
                  <div className={`board__chg ${up ? "up" : "down"}`}>
                    {up ? "+" : ""}{b.avg1d.toFixed(2)}%
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

// ============== Toolbar / filters ==============
function Toolbar({ q, setQ }) {
  return (
    <div className="toolbar">
      <label className="search-box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input
          type="search"
          placeholder="搜索基金代码 / 名称 / 主题 / 经理…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <kbd>⌘ K</kbd>
      </label>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: "return1y", label: "近1年收益" },
  { value: "sharpe", label: "夏普比率" },
  { value: "rating", label: "晨星评级" },
  { value: "aum", label: "基金规模" },
];

function ListControls({ sort, sortDir, onSortChange }) {
  return (
    <div className="list-controls" role="group" aria-label="列表操作">
      <span className="list-controls__prefix">排序</span>
      {SORT_OPTIONS.map((o) => {
        const isActive = sort === o.value;
        return (
          <button
            key={o.value}
            type="button"
            className={`list-controls__btn ${isActive ? "is-active" : ""}`}
            onClick={() => {
              if (isActive) {
                onSortChange(o.value, sortDir === "desc" ? "asc" : "desc");
              } else {
                onSortChange(o.value, "desc");
              }
            }}
          >
            {o.label}
            {isActive && <span className="sort-dir">{sortDir === "asc" ? "↑" : "↓"}</span>}
          </button>
        );
      })}
    </div>
  );
}

function QuickChips({ active, setActive }) {
  return (
    <div className="chips-row">
      <span className="chips-row__label">热门筛选</span>
      {QUICK_CHIPS.map((c) => (
        <button
          key={c.id}
          className={`qchip ${active === c.id ? "is-on" : ""}`}
          onClick={() => setActive(active === c.id ? null : c.id)}
        >
          <span className="qchip__dot"/>{c.label}
        </button>
      ))}
    </div>
  );
}

function FundCardSkeleton() {
  return (
    <article className="fcard fcard--skeleton" aria-hidden="true">
      <div className="fcard-skel__head">
        <div className="fcard-skel__line fcard-skel__line--sm"/>
        <div className="fcard-skel__line fcard-skel__line--lg"/>
        <div className="fcard-skel__line fcard-skel__line--md"/>
      </div>
      <div className="fcard-skel__tags">
        <span/><span/><span/>
      </div>
      <div className="fcard-skel__block"/>
      <div className="fcard-skel__spark"/>
    </article>
  );
}

// ============== Fund Card (lightweight v2) ==============
const FundCard = React.memo(function FundCard({ fund, idx, isFav, onFav, onOpen, isOpen }) {
  const trend = fund.return1y >= 0 ? "up" : "down";

  const riskClass = fund.risk === "高" ? "tag--risk-high" : "tag--risk-mid";
  const statusInfo = ({
    open:  { cls: "tag--status-open",  text: "可申购" },
    limit: { cls: "tag--status-limit", text: `限购 ${fund.limitYuan ? (fund.limitYuan >= 10000 ? `${fund.limitYuan/10000}万` : `${fund.limitYuan}元`) : ""}/日` },
    stop:  { cls: "tag--status-stop",  text: "暂停申购" },
  })[fund.status] || { cls: "tag--status-open", text: "可申购" };


  const isNew = !!fund.isNew;

  return (
    <article
      className={`fcard ${isNew ? "fcard--new" : ""} ${isOpen ? "fcard--active" : ""}`}
      style={{ animationDelay: `${Math.min(idx, 11) * 0.04}s` }}
      onClick={() => onOpen && onOpen(fund)}
    >
      <header className="fcard__head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="fcard__meta-line">
            <span className="fcard__code mono">{fund.code}</span>
            {isNew && <span className="fcard__newbadge">次新</span>}
          </div>
          <h3 className="fcard__title">{fund.name}</h3>
        </div>
        <button
          className={`fav-btn ${isFav ? "is-on" : ""}`}
          onClick={(e) => { e.stopPropagation(); onFav(fund.code); }}
          title={isFav ? "取消自选" : "加入自选"}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" fill={isFav ? "currentColor" : "none"}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </button>
      </header>

      <div className="fcard__tags">
        <span className="tag tag--region">{fund.region}</span>
        <span className="tag tag--theme">{fund.theme}</span>
        <span className="tag tag--role">{fund.role}</span>
        <span className={`tag ${riskClass}`}>{fund.risk}风险</span>
        <span className={`fcard__status ${statusInfo.cls}`}>{statusInfo.text}</span>
      </div>

      <div className="fcard__numbers">
        <div className="fcard__primary">
          <span className="fcard__primary-label">近 1 年</span>
          {fund.hasReturn1y ? (
            <span className={`fcard__primary-val tick ${trend}`}>
              {fund.return1y > 0 ? "+" : ""}{fund.return1y.toFixed(2)}<span className="pct">%</span>
            </span>
          ) : (
            <span className="fcard__primary-val fcard__primary-val--none">暂无</span>
          )}
        </div>
        <div className="fcard__secondary">
          <div className="rating-stars">
            <span className="rating-stars__icons">
              {[...Array(5)].map((_, i) => (
                <span key={i} className={i < fund.rating ? "" : "off"}>★</span>
              ))}
            </span>
            <span className="rating-stars__meta mono">晨星 · {fund.rating} 星</span>
          </div>
          <div className="fcard__stats">
            <span>夏普 <strong className="mono">{fund.hasSharpe ? fund.sharpe.toFixed(2) : "暂无"}</strong></span>
            <span className="sep">·</span>
            <span>回撤 <strong className={`mono ${fund.hasDrawdown ? "down" : ""}`}>{fund.hasDrawdown ? `${fund.drawdown.toFixed(2)}%` : "暂无"}</strong></span>
          </div>
        </div>
      </div>

      <div className="fcard__returns-line">
        <span>近1月 {typeof fund.return1m === "number"
          ? <strong className={fund.return1m > 0 ? "up" : "down"}>{fund.return1m > 0 ? "+" : ""}{fund.return1m.toFixed(2)}%</strong>
          : <strong className="none">—</strong>}</span>
        <span className="sep">·</span>
        <span>近3月 {fund.hasReturn3m
          ? <strong className={fund.return3m > 0 ? "up" : "down"}>{fund.return3m > 0 ? "+" : ""}{fund.return3m.toFixed(2)}%</strong>
          : <strong className="none">—</strong>}</span>
      </div>

      <div className="fcard__quote">
        <span className="fcard__quote-mark fcard__quote-mark--open" aria-hidden="true">"</span>
        <p className="fcard__quote-text">
          {fund.aiSummary ? cleanAiSummary(fund.aiSummary) : "AI 点评生成中…"}
        </p>
        <span className="fcard__quote-mark fcard__quote-mark--close" aria-hidden="true">"</span>
      </div>

    </article>
  );
});


// 真实 /api/fund/:code → 原型抽屉所需结构（业务口径取自后端 analysis，与旧版一致）
function adaptDetail(api, fund) {
  const an = api.analysis || {};
  const navHist = (api.navHistory || []).map((p, i) => ({ i, nav: p.nav, date: p.date }));
  const top10 = (api.holdings || []).map((h) => ({
    rank: h.rank, code: h.stockCode, name: h.stockName, ratio: h.ratio,
  }));
  const top10Concentration = +top10.reduce((s, h) => s + (h.ratio || 0), 0).toFixed(2);
  const allocRaw = api.assetAllocation || [];
  const allocation = allocRaw.slice(0, 4).map((r, idx, arr) => {
    const prev = arr[idx + 1];
    let trend = "→";
    if (prev) trend = r.stock > prev.stock + 0.5 ? "加仓" : r.stock < prev.stock - 0.5 ? "减仓" : "→";
    return { date: r.date, stock: r.stock ?? 0, cash: r.cash ?? 0, netAsset: r.netAssetBillion ?? 0, trend };
  });
  const peer = an.peer || {};
  const lastNav = navHist.length ? navHist[navHist.length - 1].nav : (an.realtime?.nav ?? fund.nav ?? 0);
  return {
    navHist,
    top10,
    top10Concentration,
    allocation,
    holdingsDate: api.holdingsReportDate || (allocRaw[0] && allocRaw[0].date) || "—",
    pro: {
      aumDate: fund.aumDate || "—",
      maxDrawdown: typeof api.maxDrawdown1y === "number" ? api.maxDrawdown1y : (fund.drawdown || 0),
      sharpe: fund.sharpe || 0,
      volatility: typeof fund.volatility1y === "number" ? fund.volatility1y : 0,
      navUnit: lastNav,
      navDate: an.realtime?.navDate || fund.date || "—",
    },
    trading: {
      purchaseStatus: fund.status,
      purchaseLimit: fund.limitYuan,
      statusDate: (fund.statusFetchedAt || "").slice(0, 10) || "—",
      managementFee: (api.operatingFees && api.operatingFees.management) || "—",
      feesLoaded: true,
      buyFees: (api.buyFees || []).map((r) => ({ amount: r.amount, original: r.original, discount: r.discount || r.original })),
      redeemFees: (api.redeemFees || []).map((r) => ({ period: r.period, rate: r.rate })),
    },
    aiSummary: api.aiSummary || "暂无 AI 点评。",
    aiDetail: api.aiDetail || null,
    peer: {
      themeSamples: peer.themeCount ?? 0,
      themeRank1y: peer.themeRank1y ?? 0,
      regionRankScore: peer.regionRankScore ?? 0,
      themeMedian1y: peer.themeMedian1y ?? null,
      themeRankNum: (() => {
        const total = peer.themeCount ?? 0;
        const pct = peer.themeRank1y ?? null;
        if (!total || pct === null) return null;
        return Math.max(1, Math.min(total, total - Math.round(pct / 100 * total) + 1));
      })(),
      benchmark: (api.benchmark || peer.benchmark || "—").trim(),
    },
    suitability: an.suitability || [],
    riskNotes: an.riskNotes || [],
    investGoal: (api.goal || "").trim() || "—",
    investRange: (api.scope || "").trim() || "—",
    managers: Array.isArray(api.managers) ? api.managers : [],
  };
}

function drawerNavUnit(d, fund) {
  const fromDetail = d?.pro?.navUnit;
  if (typeof fromDetail === "number" && fromDetail > 0) return fromDetail;
  if (typeof fund?.nav === "number" && fund.nav > 0) return fund.nav;
  return 0;
}

function formatDrawerPct(v, { has = true, signed = false } = {}) {
  if (!has || typeof v !== "number" || !Number.isFinite(v)) return "—";
  const sign = signed && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
}

function formatDrawerDrawdown(v, has) {
  if (!has || typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

function drawerRiskLabel(risk) {
  return risk ? `${risk}风险` : "—";
}

/** 用列表卡片已有字段先渲染抽屉，避免整页空白等待接口 */
function buildPreviewDetail(fund) {
  const spark = Array.isArray(fund.spark) && fund.spark.length >= 2 ? fund.spark : null;
  const navHist = spark
    ? spark.map((nav, i) => ({ i, nav, date: "" }))
    : [];
  const managers = (fund.manager || "")
    .split(/[、,，]/)
    .map((name) => ({ id: null, name: name.trim() }))
    .filter((m) => m.name);
  const status = fund.status || "open";
  return {
    navHist,
    top10: [],
    top10Concentration: 0,
    allocation: [],
    holdingsDate: "—",
    pro: {
      aumDate: fund.aumDate || "—",
      maxDrawdown: fund.hasDrawdown ? fund.drawdown : 0,
      sharpe: fund.hasSharpe ? fund.sharpe : 0,
      volatility: typeof fund.volatility1y === "number" ? fund.volatility1y : 0,
      navUnit: typeof fund.nav === "number" ? fund.nav : 0,
      navDate: fund.date || "—",
    },
    trading: {
      purchaseStatus: status,
      purchaseLimit: fund.limitYuan,
      statusDate: (fund.statusFetchedAt || "").slice(0, 10) || "—",
      managementFee: "—",
      feesLoaded: false,
      buyFees: [],
      redeemFees: [],
    },
    aiSummary: "正在加载 AI 点评…",
    aiDetail: null,
    peer: { themeSamples: 0, themeRank1y: 0, regionRankScore: 0, benchmark: "—" },
    suitability: [],
    riskNotes: [],
    investGoal: "—",
    investRange: "—",
    managers: managers.length ? managers : [{ id: null, name: fund.manager || "—" }],
    _preview: true,
  };
}

function ManagerPanel({ managerId, onClose, onOpenFund }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!managerId) return;
    let alive = true;
    setData(null); setErr(null);
    fetch(`/api/manager/${managerId}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [managerId]);
  if (!managerId) return null;
  const bio = data?.bioStructured || {};
  return (
    <div className="mgr-panel">
      <div className="mgr-panel__backdrop" onClick={onClose}/>
      <div className="mgr-panel__card">
        <button className="mgr-panel__close" onClick={onClose} aria-label="关闭">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        {!data && !err && <p className="mgr-panel__loading">正在加载经理简历…</p>}
        {err && <p className="mgr-panel__loading">加载失败：{err}</p>}
        {data && (
          <>
            <h3 className="mgr-panel__name">{data.name}</h3>
            <div className="mgr-panel__meta">
              {data.company && <span>{data.company}</span>}
              {data.tenure && <span>任职 {data.tenure}</span>}
              {data.totalAumText && <span>在管规模 {data.totalAumText} 亿</span>}
              {data.bestReturnText && <span>最佳回报 {data.bestReturnText}</span>}
            </div>
            {bio.companyRole && (
              <div className="mgr-panel__section">
                <span className="mgr-panel__label">现任职务</span>
                <p>{bio.companyRole}</p>
              </div>
            )}
            {bio.education && (
              <div className="mgr-panel__section">
                <span className="mgr-panel__label">履历</span>
                <p className="mgr-panel__bio">{bio.education}</p>
              </div>
            )}
            {Array.isArray(data.currentFunds) && data.currentFunds.length > 0 && (
              <div className="mgr-panel__section">
                <span className="mgr-panel__label">现任基金</span>
                <ul className="mgr-panel__funds">
                  {data.currentFunds.map((f) => (
                    <li key={f.code}>
                      <button onClick={() => onOpenFund && onOpenFund({ code: f.code })}>
                        {f.name} <span className="mono">{f.code}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const DRAWER_ANIM_MS = 320;

// ============== Detail Drawer ==============
function FundDrawer({ fund, onClose, isFav, onFav, chatOpen, onOpenFund, onOpenChat, onCloseChat }) {
  const [renderFund, setRenderFund] = useState(null);
  const [active, setActive] = useState(false);
  const closeTimer = useRef(null);
  const [feeTab, setFeeTab] = useState("buy");
  const [detail, setDetail] = useState(null);
  const [dRefreshing, setDRefreshing] = useState(false);
  const [dError, setDError] = useState(null);
  const [mgrId, setMgrId] = useState(null);
  const [aiExpanded, setAiExpanded] = useState(false);

  const requestClose = useCallback(() => {
    if (!renderFund) return;
    setActive(false);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      setRenderFund(null);
      onClose();
    }, DRAWER_ANIM_MS);
  }, [renderFund, onClose]);

  useEffect(() => {
    if (fund) {
      clearTimeout(closeTimer.current);
      setRenderFund(fund);
      setActive(false);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setActive(true));
      });
      return () => cancelAnimationFrame(id);
    }
    if (renderFund) {
      setActive(false);
      clearTimeout(closeTimer.current);
      closeTimer.current = setTimeout(() => setRenderFund(null), DRAWER_ANIM_MS);
    }
    return () => clearTimeout(closeTimer.current);
  }, [fund]); // eslint-disable-line react-hooks/exhaustive-deps

  // ESC to close
  useEffect(() => {
    if (!renderFund) return;
    const onKey = (e) => { if (e.key === "Escape") requestClose(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [renderFund, requestClose]);

  useEffect(() => {
    if (!renderFund) {
      setDetail(null);
      setDError(null);
      setDRefreshing(false);
      return;
    }
    let alive = true;
    setDError(null);
    setFeeTab("buy");
    setAiExpanded(false);
    const cached = readDetailCache(renderFund.code);
    setDetail(cached ? adaptDetail(cached, renderFund) : buildPreviewDetail(renderFund));
    setDRefreshing(!cached);

    fetch(`/api/fund/${renderFund.code}`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((api) => {
        if (!alive) return;
        writeDetailCache(renderFund.code, api);
        setDetail(adaptDetail(api, renderFund));
        setDRefreshing(false);
      })
      .catch((e) => {
        if (!alive) return;
        setDError(e.message);
        setDRefreshing(false);
      });
    return () => { alive = false; };
  }, [renderFund]);

  if (!renderFund) return null;
  const trend = renderFund.return1y >= 0 ? "up" : "down";
  const d = detail || buildPreviewDetail(renderFund);
  const navUnit = drawerNavUnit(d, renderFund);
  const navText = navUnit > 0 ? navUnit.toFixed(2) : "—";
  const return1yText = formatDrawerPct(renderFund.return1y, { has: renderFund.hasReturn1y, signed: true });
  const drawdownText = formatDrawerDrawdown(renderFund.drawdown, renderFund.hasDrawdown);
  const drawdownCls = renderFund.hasDrawdown && renderFund.drawdown < 0 ? "down" : "";
  const riskText = drawerRiskLabel(renderFund.risk);
  const riskCls = renderFund.risk && String(renderFund.risk).includes("高") ? "up" : "neutral";
  const fundTypeText = renderFund.fundType || "—";
  const hasReturn1m = typeof renderFund.return1m === "number";
  const return1mText = formatDrawerPct(renderFund.return1m, { has: hasReturn1m, signed: true });
  const return3mText = formatDrawerPct(renderFund.return3m, { has: renderFund.hasReturn3m, signed: true });
  const return3yText = formatDrawerPct(renderFund.return3y, { has: renderFund.hasReturn3y, signed: true });
  const return3yCls = renderFund.hasReturn3y && typeof renderFund.return3y === "number" ? (renderFund.return3y > 0 ? "up" : renderFund.return3y < 0 ? "down" : "") : "";

  return (
    <>
      <div
        className={`drawer-backdrop ${active ? "is-visible" : ""}`}
        onClick={requestClose}
        aria-hidden="true"
      />
      <aside
        className={`drawer ${active ? "is-visible" : ""} ${chatOpen ? "drawer--shifted" : ""}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <header className="drawer__head">
          <div className="drawer__head-row">
            <h2 className="drawer__title">{renderFund.name}</h2>
            <div className="drawer__head-actions">
              <button className={`icon-btn ${isFav ? "is-fav" : ""}`} onClick={onFav} title={isFav ? "取消自选" : "加入自选"}>
                <svg width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.6" fill={isFav ? "currentColor" : "none"}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
              </button>
              <button className={`icon-btn ${chatOpen ? "is-chat" : ""}`} title={chatOpen ? "收起 AI 对话" : "向 AI 提问"} onClick={chatOpen ? onCloseChat : onOpenChat}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              </button>
            </div>
          </div>
          <div className="drawer__meta">
            <span className="mono">{renderFund.code}</span>
            <span className="drawer__dot"/>
            <span>{renderFund.region}</span>
            <span className="drawer__dot"/>
            <span>{renderFund.theme}</span>
            <span className="drawer__dot"/>
            <span>{renderFund.role}</span>
            <span className="drawer__dot"/>
            <span>{fundTypeText}</span>
            <span className="drawer__dot"/>
            <span className={riskCls}>{riskText}</span>
            <span className="drawer__manager">
              现任经理：
              {d && d.managers && d.managers.length ? (
                d.managers.map((mgr, i) => (
                  <React.Fragment key={mgr.id || mgr.name || i}>
                    {i > 0 && <span>、</span>}
                    {mgr.id ? (
                      <button className="drawer__manager-link" onClick={() => setMgrId(mgr.id)}>{mgr.name}</button>
                    ) : (
                      <span className="drawer__manager-link drawer__manager-link--plain">{mgr.name}</span>
                    )}
                  </React.Fragment>
                ))
              ) : (
                <span className="drawer__manager-link drawer__manager-link--plain">{renderFund.manager}</span>
              )}
            </span>
          </div>
        </header>

        <div className="drawer__body">
          {dError && (
            <p className="drawer__sync-hint drawer__sync-hint--err">{dError}</p>
          )}
          {/* 专业指标 */}
          <section className="dsection">
            <div className="pro-grid">
              <ProCell label="基金规模（元）" hint={`规模截止 ${d.pro.aumDate}`} value={`${renderFund.aum.toFixed(1)} 亿`}/>
              <ProCell label="最大回撤" hint="历史从高点到低点的最大幅度（近 1 年）" value={`${d.pro.maxDrawdown.toFixed(2)}%`} cls="down"/>
              <ProCell label="夏普比率" hint="每承担一份风险获得多少超额收益，>1 优秀（近 1 年）" value={d.pro.sharpe.toFixed(2)} cls={d.pro.sharpe > 1 ? "up" : ""}/>
              <ProCell label="年化波动率" hint="价格波动剧烈程度，越小越平稳（近 1 年）" value={`${d.pro.volatility.toFixed(2)}%`}/>
            </div>
          </section>

          {/* NAV chart */}
          <section className="dsection">
            <div className="dsection__head">
              <h3>净值走势</h3>
              <div className="nav-unit-inline">
                <span className="nav-unit-inline__label">单位净值</span>
                <strong className="nav-unit-inline__val mono">{navText}</strong>
              </div>
              <div className="drawer-rating">
                <span className="rating-stars__icons">{[...Array(5)].map((_, i) => <span key={i} className={i < renderFund.rating ? "" : "off"}>★</span>)}</span>
                <span className="drawer-rating__meta">晨星 · {renderFund.rating} 星</span>
              </div>
            </div>
            <div className="nav-chart-slot">
              <NavChartBig data={d.navHist} trend={trend} loading={d.navHist.length < 2} animate={false}/>
            </div>
          </section>

          {/* KPI strip — 历史收益四格一行 */}
          <section className="kpi-strip" aria-label="历史收益">
            <div className="kpi-strip__cell">
              <span className="kpi-strip__label">近 1 月</span>
              <strong className={`mono ${hasReturn1m && renderFund.return1m > 0 ? "up" : hasReturn1m && renderFund.return1m < 0 ? "down" : ""}`}>{return1mText}</strong>
            </div>
            <div className="kpi-strip__cell">
              <span className="kpi-strip__label">近 3 月</span>
              <strong className={`mono ${renderFund.hasReturn3m && renderFund.return3m > 0 ? "up" : renderFund.hasReturn3m && renderFund.return3m < 0 ? "down" : ""}`}>{return3mText}</strong>
            </div>
            <div className="kpi-strip__cell">
              <span className="kpi-strip__label">近 1 年</span>
              <strong className={`mono ${renderFund.hasReturn1y ? trend : ""}`}>{return1yText}</strong>
            </div>
            <div className="kpi-strip__cell">
              <span className="kpi-strip__label">近 3 年</span>
              <strong className={`mono ${return3yCls}`}>{return3yText}</strong>
            </div>
          </section>


          {/* AI 点评 */}
          {(() => {
            const aiText = d.aiDetail || d.aiSummary || "";
            const isLong = !!d.aiDetail && aiText.length > 80;
            const bodyCls =
              "ai-summary__body" +
              (isLong ? " ai-summary__body--long" : "") +
              (isLong && !aiExpanded ? " ai-summary__body--collapsed" : "");
            return (
              <section className="dsection">
                <div className="ai-summary">
                  <div className="ai-summary__head">
                    <span className="ai-summary__tag">AI 点评</span>
                    {isLong && (
                      <button
                        type="button"
                        className="ai-summary__toggle"
                        onClick={() => setAiExpanded((v) => !v)}
                      >
                        {aiExpanded ? "收起" : "展开全文"}
                      </button>
                    )}
                  </div>
                  <div className={bodyCls}>
                    <p>{cleanAiSummary(aiText)}</p>
                  </div>
                </div>
              </section>
            );
          })()}

          {/* 交易规则 + 费率 */}
          <section className="dsection">
            <h3 className="dsection__h">交易规则</h3>
            <div className="trade-strip">
              <div className="trade-strip__cell">
                <span>申购状态</span>
                <strong className={d.trading.purchaseStatus === "open" ? "" : d.trading.purchaseStatus === "limit" ? "warn" : "stop"}>
                  {d.trading.purchaseStatus === "open" ? "开放申购"
                    : d.trading.purchaseStatus === "limit" ? `限购 ${d.trading.purchaseLimit >= 10000 ? `${d.trading.purchaseLimit/10000}万` : `${d.trading.purchaseLimit}元`}/日`
                    : "暂停申购"}
                </strong>
              </div>
              <div className="trade-strip__cell">
                <span>赎回状态</span>
                <strong>开放赎回</strong>
              </div>
              <div className="trade-strip__cell">
                <span>状态截止</span>
                <strong className="mono muted">{d.trading.statusDate}</strong>
              </div>
            </div>

            <div className="fee-block">
              <div className="fee-tabs">
                <button className={feeTab === "buy" ? "is-on" : ""} onClick={() => setFeeTab("buy")}>买入费率</button>
                <button className={feeTab === "redeem" ? "is-on" : ""} onClick={() => setFeeTab("redeem")}>赎回费率</button>
                <span className="fee-mgmt">管理费 <strong className="mono">{d.trading.managementFee}</strong> / 年</span>
              </div>
              <div className="fee-table-slot">
              {feeTab === "buy" ? (
                <table className="fee-table">
                  <thead><tr><th>适用金额</th><th>原费率</th><th className="num">优惠费率</th></tr></thead>
                  <tbody>
                    {d.trading.buyFees.length
                      ? d.trading.buyFees.map((r, i) => (
                        <tr key={i}>
                          <td>{r.amount}</td>
                          <td className={`mono${r.discount && r.discount !== r.original ? " fee-original-struck" : ""}`}>{r.original}</td>
                          <td className="mono num">{r.discount || r.original}</td>
                        </tr>
                      ))
                      : d.trading.feesLoaded
                        ? <tr><td colSpan="3" className="fee-empty">暂无费率数据</td></tr>
                        : feeTableRows(null)}
                  </tbody>
                </table>
              ) : (
                <table className="fee-table fee-table--redeem">
                  <thead><tr><th>持有时间</th><th className="num">赎回费率</th></tr></thead>
                  <tbody>
                    {d.trading.redeemFees.length
                      ? d.trading.redeemFees.map((r, i) => (
                        <tr key={i}><td>{r.period}</td><td className="mono num">{r.rate}</td></tr>
                      ))
                      : d.trading.feesLoaded
                        ? <tr><td colSpan="2" className="fee-empty">暂无费率数据</td></tr>
                        : feeTableRows(null, 3).map((row, i) => (
                          <tr key={i} className="fee-row--skel" aria-hidden="true">
                            <td><span className="fee-skel"/></td>
                            <td><span className="fee-skel"/></td>
                          </tr>
                        ))}
                  </tbody>
                </table>
              )}
              </div>
            </div>
          </section>

          {/* 前 10 大重仓股 */}
          <section className="dsection">
            <div className="dsection__head">
              <h3 className="dsection__h">前 10 大重仓股</h3>
              <span className="dsection__meta mono">截止 {d.holdingsDate}</span>
            </div>
            <div className="holdings-slot">
              <ul className="holdings-list">
                {(d.top10.length > 0 ? d.top10 : Array.from({ length: 10 }, (_, i) => ({ skel: true, rank: i + 1 }))).map((h, i) => (
                  h.skel ? (
                    <li className="hrow hrow--skel" key={`sk-${i}`} aria-hidden="true">
                      <span className="hrow__rank">{h.rank}</span>
                      <span className="hrow__skel-line hrow__skel-line--sm"/>
                      <span className="hrow__skel-line hrow__skel-line--lg"/>
                      <span className="hrow__skel-bar"/>
                      <span className="hrow__skel-line hrow__skel-line--xs"/>
                    </li>
                  ) : (
                    <li className="hrow" key={h.code}>
                      <span className={`hrow__rank rank-${h.rank}`}>{h.rank}</span>
                      <span className="hrow__code mono">{h.code}</span>
                      <span className="hrow__name">{h.name}</span>
                      <div className="hrow__bar"><div className="hrow__bar-fill" style={{width: `${Math.min(100, h.ratio * 10)}%`}}/></div>
                      <span className="hrow__ratio mono">{h.ratio.toFixed(2)}%</span>
                    </li>
                  )
                ))}
              </ul>
              {d.top10.length > 0 ? (
                <p className="dsection__note">前 10 大集中度 <strong className="mono">{d.top10Concentration.toFixed(2)}%</strong> · 单只股票波动会显著影响净值</p>
              ) : !dRefreshing ? (
                <p className="dsection__note dsection__note--muted">暂无持仓数据</p>
              ) : null}
            </div>
          </section>

          {/* 资产配置变化 */}
          <section className="dsection">
            <div className="dsection__head">
              <h3 className="dsection__h">资产配置变化</h3>
              <span className="dsection__meta mono">最近 4 期季报</span>
            </div>
            <div className="alloc-table-slot">
            <table className="alloc-table">
              <thead><tr><th>报告期</th><th>股票 / 现金</th><th className="num">股票</th><th className="num">现金</th><th className="num">净资产</th><th>变化</th></tr></thead>
              <tbody>
                {allocTableRows(d.allocation)}
              </tbody>
            </table>
            </div>
          </section>

          {/* 同类对比 + 适合谁 */}
          <section className="dsection">
            <h3 className="dsection__h">同类对比 · 适合谁</h3>
            <div className="positioning-grid">
              <div className="pcell">
                <span className="pcell__label">主题排名 · 近1年</span>
                {d.peer.themeRankNum !== null
                  ? <><strong className={`mono ${d.peer.themeRankNum <= 3 ? "up" : ""}`}>第{d.peer.themeRankNum}名</strong><span className="pcell__meta">共 {d.peer.themeSamples} 只</span></>
                  : <strong className="mono">暂无</strong>}
              </div>
              <div className="pcell">
                <span className="pcell__label">区域评级</span>
                {(() => {
                  const s = d.peer.regionRankScore;
                  const [label, cls] = s >= 70 ? ["优秀", "up"] : s >= 40 ? ["一般", "neutral"] : ["差", "down"];
                  return <>
                    <strong className={`mono ${cls}`}>{label}</strong>
                    <span className="pcell__meta">高于约 {s}% 同区域</span>
                  </>;
                })()}
              </div>
              <div className="pcell">
                <span className="pcell__label">超同类中位</span>
                {d.peer.themeMedian1y !== null && typeof d.peer.themeMedian1y === "number"
                  ? (() => {
                      const excess = (renderFund.return1y ?? 0) - d.peer.themeMedian1y;
                      return <>
                        <strong className={`mono ${excess >= 0 ? "up" : "down"}`}>{excess >= 0 ? "+" : ""}{excess.toFixed(2)}%</strong>
                        <span className="pcell__meta">vs 同主题中位 {d.peer.themeMedian1y.toFixed(2)}%</span>
                      </>;
                    })()
                  : <strong className="mono">暂无</strong>}
              </div>
              <div className="pcell pcell--wide">
                <span className="pcell__label">适合谁</span>
                <ul className="pcell__list">
                  {d.suitability.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            </div>
          </section>

          {/* 主要风险 */}
          <section className="dsection">
            <h3 className="dsection__h">主要风险</h3>
            <ul className="risk-list">
              {d.riskNotes.map((r, i) => (
                <li key={i}>
                  <span className="risk-list__dot"/>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* 业绩基准 */}
          <section className="dsection dsection--muted">
            <h3 className="dsection__h">业绩基准</h3>
            <p className="benchmark">{d.peer.benchmark}</p>
          </section>

          <section className="dsection dsection--muted">
            <h3 className="dsection__h">基金资料</h3>
            <div className="basics">
              <div>
                <span className="basics__label">投资目标</span>
                <p>{d.investGoal}</p>
              </div>
              <div>
                <span className="basics__label">投资范围</span>
                <p>{d.investRange}</p>
              </div>
            </div>
          </section>

          <div className="drawer__foot-note">
            数据可能存在 1–3 个交易日延迟，最终以基金公司公告与销售平台为准。本工具不构成投资建议。
          </div>
        </div>
      </aside>
      {mgrId && (
        <ManagerPanel
          managerId={mgrId}
          onClose={() => setMgrId(null)}
          onOpenFund={(f) => { setMgrId(null); onOpenFund && onOpenFund(f); }}
        />
      )}
    </>
  );
}

function feeTableRows(rows, skelCount = 3) {
  if (rows && rows.length) {
    return rows.map((r, i) => (
      <tr key={i}>
        <td>{r.amount ?? r.period}</td>
        <td className="mono">{r.original ?? r.rate}</td>
        {r.discount !== undefined && <td className="mono num fee-discount">{r.discount}</td>}
      </tr>
    ));
  }
  return Array.from({ length: skelCount }, (_, i) => (
    <tr key={`sk-${i}`} className="fee-row--skel" aria-hidden="true">
      <td><span className="fee-skel"/></td>
      <td><span className="fee-skel"/></td>
      <td><span className="fee-skel"/></td>
    </tr>
  ));
}

function allocTableRows(rows) {
  if (rows && rows.length) {
    return rows.map((r) => (
      <tr key={r.date}>
        <td className="mono">{r.date}</td>
        <td>
          <div className="alloc-bar">
            <div className="alloc-bar__stock" style={{width: `${r.stock}%`}}/>
            <div className="alloc-bar__cash" style={{width: `${r.cash}%`}}/>
          </div>
        </td>
        <td className="mono num">{r.stock.toFixed(2)}%</td>
        <td className="mono num">{r.cash.toFixed(2)}%</td>
        <td className="mono num">{r.netAsset.toFixed(2)} 亿</td>
        <td><span className={`trend-pill ${r.trend === "加仓" ? "up" : r.trend === "减仓" ? "down" : "flat"}`}>{r.trend === "→" ? "稳定" : r.trend}</span></td>
      </tr>
    ));
  }
  return Array.from({ length: 4 }, (_, i) => (
    <tr key={`sk-${i}`} className="alloc-row--skel" aria-hidden="true">
      <td><span className="fee-skel fee-skel--short"/></td>
      <td><span className="fee-skel fee-skel--wide"/></td>
      <td><span className="fee-skel fee-skel--xs"/></td>
      <td><span className="fee-skel fee-skel--xs"/></td>
      <td><span className="fee-skel fee-skel--xs"/></td>
      <td><span className="fee-skel fee-skel--pill"/></td>
    </tr>
  ));
}

function ProCell({ label, hint, value, cls = "" }) {
  return (
    <div className="pro-cell">
      <div className="pro-cell__head">
        <span className="pro-cell__label">{label}</span>
        <span className="info-tip" tabIndex="0" data-tip={hint}>i</span>
      </div>
      <strong className={`mono ${cls}`}>{value}</strong>
    </div>
  );
}

function formatChartAxisDate(date) {
  if (!date) return "";
  const s = String(date);
  return s.length >= 7 ? s.slice(0, 7) : s;
}

function nearestNavPoint(points, svgX, bounds) {
  const clampedX = Math.max(bounds.padLeft, Math.min(bounds.W - bounds.padRight, svgX));
  let nearest = points[0];
  let minDistance = Math.abs(points[0].x - clampedX);
  for (let i = 1; i < points.length; i += 1) {
    const distance = Math.abs(points[i].x - clampedX);
    if (distance < minDistance) {
      nearest = points[i];
      minDistance = distance;
    }
  }
  return nearest;
}

// Big NAV chart for drawer（横纵坐标 + 鼠标左右移动十字线，对齐老版 chart.js）
function NavChartBig({ data, trend, loading = false, animate = true }) {
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const [active, setActive] = useState(null);
  const [tip, setTip] = useState(null);
  const gradId = useMemo(
    () => `navGradBig_${Math.random().toString(36).slice(2, 9)}`,
    [data?.length, data?.[0]?.nav]
  );

  const chart = useMemo(() => {
    const rows = (data || []).filter((p) => Number.isFinite(p?.nav));
    if (rows.length < 2) return null;

    const W = 640;
    const H = 220;
    const padLeft = 50;
    const padRight = 16;
    const padTop = 16;
    const padBottom = 30;
    const plotW = W - padLeft - padRight;
    const plotH = H - padTop - padBottom;

    const navs = rows.map((p) => p.nav);
    const minNav = Math.min(...navs);
    const maxNav = Math.max(...navs);
    const padding = (maxNav - minNav) * 0.1 || maxNav * 0.02 || 0.01;
    const yMin = minNav - padding;
    const yMax = maxNav + padding;

    const xAt = (i) => padLeft + (rows.length === 1 ? plotW / 2 : (i * plotW) / (rows.length - 1));
    const yAt = (v) => padTop + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    const points = rows.map((p, i) => ({
      ...p,
      x: xAt(i),
      y: yAt(p.nav),
      changePct: ((p.nav - rows[0].nav) / rows[0].nav) * 100,
    }));

    const linePath = rows
      .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(2)} ${yAt(p.nav).toFixed(2)}`)
      .join(" ");
    const areaPath = `${linePath} L ${xAt(rows.length - 1).toFixed(2)} ${padTop + plotH} L ${xAt(0).toFixed(2)} ${padTop + plotH} Z`;

    const ticks = 4;
    const yTicks = Array.from({ length: ticks + 1 }, (_, i) => {
      const v = yMin + ((yMax - yMin) * i) / ticks;
      return { value: v, y: yAt(v) };
    });

    const xIdxs = [
      0,
      Math.floor(rows.length / 4),
      Math.floor(rows.length / 2),
      Math.floor((3 * rows.length) / 4),
      rows.length - 1,
    ];
    const xLabels = xIdxs
      .filter((idx, i, arr) => rows[idx] && arr.indexOf(idx) === i)
      .map((idx) => ({ x: xAt(idx), label: formatChartAxisDate(rows[idx].date) }));

    const first = rows[0].nav;
    const last = rows[rows.length - 1].nav;
    const chg = ((last - first) / first) * 100;
    const color = trend === "up" ? "var(--up)" : "var(--down)";

    return {
      W, H, padLeft, padRight, padTop, padBottom, plotW, plotH,
      points, linePath, areaPath, yTicks, xLabels, color, chg,
      rangeStart: rows[0].date || "—",
      rangeEnd: rows[rows.length - 1].date || "—",
      count: rows.length,
    };
  }, [data, trend]);

  const hideHover = useCallback(() => {
    setActive(null);
    setTip(null);
  }, []);

  const showHover = useCallback((event) => {
    if (!chart || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const svgX = ((event.clientX - rect.left) / rect.width) * chart.W;
    const point = nearestNavPoint(chart.points, svgX, chart);
    if (!point) return;
    setActive(point);

    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const tooltipW = 148;
    const tooltipH = 72;
    let left = event.clientX - stageRect.left + 12;
    let top = event.clientY - stageRect.top - tooltipH - 14;
    if (left + tooltipW > stageRect.width - 8) left = event.clientX - stageRect.left - tooltipW - 12;
    if (top < 8) top = event.clientY - stageRect.top + 14;
    const maxTop = Math.max(8, stageRect.height - tooltipH - 8);
    setTip({
      date: point.date || "—",
      nav: Number(point.nav).toFixed(4),
      changePct: point.changePct,
      left: Math.max(8, left),
      top: Math.max(8, Math.min(maxTop, top)),
    });
  }, [chart]);

  if (!chart) {
    return (
      <div className="nav-chart-big nav-chart-big--placeholder">
        {loading ? "正在加载历史净值…" : "暂无净值走势"}
      </div>
    );
  }

  const drawCls = animate ? "draw-area" : "draw-area draw-area--static";
  const lineCls = animate ? "draw-line" : "draw-line draw-line--static";
  const {
    W, H, padLeft, padRight, padTop, plotH,
    linePath, areaPath, yTicks, xLabels, color, chg,
    rangeStart, rangeEnd, count,
  } = chart;

  return (
    <div className="nav-chart-big">
      <div className="nav-chart-stage" ref={stageRef}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="nav-chart-svg"
          onPointerMove={showHover}
          onPointerDown={showHover}
          onPointerLeave={hideHover}
          onPointerCancel={hideHover}
        >
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.25"/>
              <stop offset="100%" stopColor={color} stopOpacity="0"/>
            </linearGradient>
          </defs>
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={padLeft} x2={W - padRight} y1={t.y} y2={t.y} stroke="var(--border-soft)" strokeWidth="1"/>
              <text x={padLeft - 6} y={t.y} fontSize="10" fill="var(--muted)" textAnchor="end" dominantBaseline="middle" fontFamily="var(--font-mono)">
                {t.value.toFixed(3)}
              </text>
            </g>
          ))}
          <path d={areaPath} fill={`url(#${gradId})`} className={drawCls}/>
          <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={lineCls}/>
          {xLabels.map((t, i) => (
            <text key={i} x={t.x} y={H - 8} fontSize="10" fill="var(--muted)" textAnchor="middle" fontFamily="var(--font-mono)">
              {t.label}
            </text>
          ))}
          {active && (
            <g className="nav-chart-hover" style={{ color }}>
              <line className="nav-chart-crosshair-x" x1={padLeft} x2={W - padRight} y1={active.y} y2={active.y}/>
              <line className="nav-chart-crosshair-y" x1={active.x} x2={active.x} y1={padTop} y2={padTop + plotH}/>
              <circle className="nav-chart-point-ring" cx={active.x} cy={active.y} r="5" fill="#fff" stroke="currentColor" strokeWidth="2"/>
              <circle className="nav-chart-point-dot" cx={active.x} cy={active.y} r="2.5" fill="currentColor"/>
            </g>
          )}
          <rect x={padLeft} y={padTop} width={W - padLeft - padRight} height={plotH} fill="transparent"/>
        </svg>
        {tip && (
          <div
            className="nav-chart-tooltip visible"
            role="status"
            style={{ left: tip.left, top: tip.top }}
          >
            <strong>{tip.date}</strong>
            <span>单位净值 {tip.nav}</span>
            <span className={tip.changePct >= 0 ? "up" : "down"}>
              区间涨跌 {tip.changePct >= 0 ? "+" : ""}{tip.changePct.toFixed(2)}%
            </span>
          </div>
        )}
      </div>
      <div className="nav-chart-foot">
        <span>区间 {rangeStart} → {rangeEnd}</span>
        <span className={`mono ${chg >= 0 ? "up" : "down"}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>
        <span>{count} 个数据点</span>
      </div>
    </div>
  );
}


// ============== AI 投顾 Drawer ==============
// ============== AI 投顾 Drawer（真实流式） ==============
const CHAT_SESSION_KEY = "qdii-compass-chat-session";

function chatHeaders() {
  const h = { "content-type": "application/json", accept: "text/event-stream" };
  const token = getToken();
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

// 与旧版 parseSseStream 一致：按 \n\n 分块，解析 event:/data:
function parseSse(text, offset, onEvent) {
  let cursor = offset;
  while (true) {
    const sep = text.indexOf("\n\n", cursor);
    if (sep < 0) return cursor;
    const block = text.slice(cursor, sep);
    cursor = sep + 2;
    let eventName = "message";
    let dataStr = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
    }
    if (!dataStr) continue;
    try { onEvent(eventName, JSON.parse(dataStr)); } catch { /* 忽略半包 */ }
  }
}

function fmtLimitYuan(yuan) {
  if (yuan == null) return "大额";
  return yuan >= 10000 ? `${yuan / 10000}万` : `${yuan}元`;
}

// 真实卡片字段 → EmbedFundCard 展示字段（沿用旧版申购状态口径）
function normalizeCard(c) {
  const status =
    c.purchaseStatus === "限购" ? "limit" :
    c.purchaseStatus === "暂停" ? "stop" : "open";
  return {
    code: c.code,
    name: c.name,
    status,
    limitText: status === "limit" ? `限购 ${fmtLimitYuan(c.purchaseLimitYuan)}/日` : status === "stop" ? "暂停申购" : "可申购",
    tags: [c.region, c.theme, c.role].filter(Boolean),
    return3m: c.return3m ?? 0,
    return1y: c.return1y ?? 0,
    returnYtd: c.returnYtd ?? 0,
    score: c.score ?? "--",
  };
}

// 行内富文本：**加粗**、・/- 列表、按 6 位代码就近插卡（强提示），
// 同时把正文里所有 6 位代码渲染成蓝色加粗的弱链接（点击打开二级抽屉）。
function RichReply({ text, cards, onOpenFund, openFundCode }) {
  const cardByCode = new Map();
  for (const c of cards || []) if (c?.code) cardByCode.set(c.code, c);
  const shown = new Set();

  // 把一段不含加粗的纯文本，按 6 位代码切分，代码部分渲染成可点击的弱链接 button
  function renderTextWithCodes(s, keyBase) {
    // 清理 markdown 反引号包裹的代码：`123456` → 123456
    const cleaned = s.replace(/`(\d{6})`/g, "$1");
    const out = [];
    const re = /(\d{6})/g;
    let lastIdx = 0;
    let m;
    let i = 0;
    while ((m = re.exec(cleaned))) {
      if (m.index > lastIdx) out.push(
        <React.Fragment key={`${keyBase}-t${i++}`}>{cleaned.slice(lastIdx, m.index)}</React.Fragment>
      );
      const code = m[1];
      out.push(
        <button
          key={`${keyBase}-c${i++}`}
          type="button"
          className={`ai-inline-code${openFundCode === code ? " is-active" : ""}`}
          onClick={() => onOpenFund && onOpenFund({ code })}
        >
          {code}
        </button>
      );
      lastIdx = m.index + code.length;
    }
    if (lastIdx < cleaned.length) out.push(
      <React.Fragment key={`${keyBase}-t${i++}`}>{cleaned.slice(lastIdx)}</React.Fragment>
    );
    return out;
  }

  function renderInline(s, keyBase) {
    const parts = s.split(/(\*\*[^*\n]+\*\*)/g);
    return parts.flatMap((p, i) =>
      /^\*\*[^*\n]+\*\*$/.test(p)
        ? [<strong key={`${keyBase}-b${i}`}>{p.slice(2, -2)}</strong>]
        : renderTextWithCodes(p, `${keyBase}-s${i}`)
    );
  }

  const lines = (text || "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const nodes = [];
  let listBuf = [];
  const flushList = (k) => {
    if (!listBuf.length) return;
    nodes.push(<ul className="ai-msg__list" key={`ul${k}`}>{listBuf}</ul>);
    listBuf = [];
  };

  lines.forEach((line, idx) => {
    const isLi = line.startsWith("・") || line.startsWith("- ");
    const body = isLi ? line.replace(/^[・\-]\s*/, "") : line;
    if (isLi) listBuf.push(<li key={`li${idx}`}>{renderInline(body, `li${idx}`)}</li>);
    else { flushList(idx); nodes.push(<p className="ai-msg__text" key={`p${idx}`}>{renderInline(body, `p${idx}`)}</p>); }

    // 就近插卡：本行出现的、命中卡片且未展示的代码
    const codes = [];
    const re = /(\d{6})/g;
    let m;
    while ((m = re.exec(line))) {
      if (cardByCode.has(m[1]) && !shown.has(m[1]) && !codes.includes(m[1])) codes.push(m[1]);
    }
    if (codes.length) {
      flushList(idx);
      codes.forEach((code) => {
        if (shown.has(code)) return;
        shown.add(code);
        nodes.push(
          <EmbedFundCard key={`ic-${code}`} f={normalizeCard(cardByCode.get(code))} onOpen={() => onOpenFund && onOpenFund({ code })} isOpen={openFundCode === code}/>
        );
      });
    }
  });
  flushList("end");

  const rest = (cards || []).filter((c) => c?.code && !shown.has(c.code));
  return (
    <>
      {nodes}
      {rest.length > 0 && (
        <div className="ai-cards">
          {rest.map((c) => (
            <EmbedFundCard key={`rc-${c.code}`} f={normalizeCard(c)} onOpen={() => onOpenFund && onOpenFund({ code: c.code })} isOpen={openFundCode === c.code}/>
          ))}
        </div>
      )}
    </>
  );
}

function fundSuggestions(fund) {
  if (!fund?.name) return [];
  const n = fund.name;
  return [
    `${n} 重仓了哪些股票？投资策略是什么？`,
    `如果每月定投 1000 元 ${n}，过去 1 年回报率大概是多少？`,
    `${n} 最近涨跌的主要原因是什么？`,
    `${n} 和同类 QDII 相比有什么优势或风险？`,
    `${n} 适合长期持有吗？波动和最大回撤怎么样？`,
    `${n} 现在的位置在历史上算高还是低？`,
    `${n} 跟踪的是什么指数或市场？`,
    `${n} 的费率高不高？买入赎回有什么规则？`,
    `${n} 的基金经理是谁？管理得怎么样？`,
    `现在适合买入 ${n} 吗？需要注意什么风险？`,
    `${n} 受美元兑人民币汇率影响大吗？`,
    `${n} 限购吗？申购赎回到账要多久？`,
  ].map((text) => ({ text, hot: false }));
}

function rotate(pool, page, n = 6) {
  if (!pool.length) return [];
  if (pool.length <= n) return pool;
  const start = (page * n) % pool.length;
  const out = [];
  for (let i = 0; i < n; i++) out.push(pool[(start + i) % pool.length]);
  return out;
}

function pickSuggestions(groups, n = 6) {
  const out = [];
  for (const g of groups || []) {
    if (Array.isArray(g) && g.length) out.push(g[Math.floor(Math.random() * g.length)]);
    if (out.length >= n) break;
  }
  for (const g of groups || []) {
    for (const s of g || []) { if (out.length >= n) break; if (!out.includes(s)) out.push(s); }
  }
  return out.slice(0, n);
}

// 合并 AI 热议（最多 2 条，带 hot 标记）+ 固定库（按主题随机抽，补满到 6 条）
function buildSuggestions(data, n = 6) {
  const hotRaw = Array.isArray(data?.hot) ? data.hot.filter((s) => typeof s === "string" && s.trim()) : [];
  const hot = hotRaw.slice(0, 2).map((text) => ({ text, hot: true }));
  const fillerCount = Math.max(0, n - hot.length);
  const filler = pickSuggestions(data?.genericGroups || [], fillerCount)
    .filter((text) => !hot.some((h) => h.text === text))
    .map((text) => ({ text, hot: false }));
  return [...hot, ...filler].slice(0, n);
}

function AIDrawer({ open, onClose, onOpenFund, openFundCode, fundDrawerOpen, loggedIn, onRequireLogin, contextFund, onClearContext, onNewSession }) {
  const [view, setView] = useState("empty"); // "empty" | "chat" | "history"
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [sessions, setSessions] = useState([]);
  const sessionRef = useRef(localStorage.getItem(CHAT_SESSION_KEY) || null);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    if (!open || suggestions.length) return;
    fetch("/api/chat/suggestions")
      .then((r) => r.json())
      .then((d) => setSuggestions(buildSuggestions(d, 18)))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  function setSessionId(id) {
    sessionRef.current = id;
    if (id) localStorage.setItem(CHAT_SESSION_KEY, id);
  }

  async function loadSessions() {
    if (!getSession()) { setSessions([]); return; }
    try {
      const r = await fetch("/api/chat/sessions", { headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {} });
      const d = await r.json();
      setSessions(Array.isArray(d.sessions) ? d.sessions : []);
    } catch { setSessions([]); }
  }

  async function openSession(sid) {
    try {
      const r = await fetch(`/api/chat/history?sessionId=${encodeURIComponent(sid)}`, {
        headers: getToken() ? { authorization: `Bearer ${getToken()}` } : {},
      });
      const d = await r.json();
      const msgs = (d.messages || []).map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content || "",
        cards: Array.isArray(m.cards) ? m.cards : [],
        sources: Array.isArray(m.sources) ? m.sources : [],
      }));
      setMessages(msgs);
      setSessionId(d.sessionId || sid);
      setView("chat");
    } catch { /* ignore */ }
  }

  function newSession() {
    setMessages([]);
    setSessionId(null);
    setView("empty");
    onNewSession?.();
  }

  async function sendMsg(text) {
    let txt = (text ?? input).trim();
    if (!txt || busy) return;
    if (contextFund && messages.length === 0) {
      txt = `关于基金【${contextFund.name}（${contextFund.code}）】：${txt}`;
    }
    setInput("");
    setView("chat");
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: "user", content: txt },
      { role: "assistant", content: "", thinking: "", cards: [], sources: [], streaming: true },
    ]);

    const patchLast = (patch) =>
      setMessages((m) => {
        const n = m.slice();
        const i = n.length - 1;
        n[i] = { ...n[i], ...(typeof patch === "function" ? patch(n[i]) : patch) };
        return n;
      });

    let cards = [];
    let sources = [];
    let acc = "";
    let finalReply = "";
    let done = false;

    try {
      const res = await fetch("/api/chat?stream=1", {
        method: "POST",
        headers: chatHeaders(),
        body: JSON.stringify({ message: txt, sessionId: sessionRef.current }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let offset = 0;
      let streamErr = null;

      while (true) {
        const { value, done: rdDone } = await reader.read();
        if (rdDone) break;
        buffer += decoder.decode(value, { stream: true });
        offset = parseSse(buffer, offset, (event, data) => {
          if (event === "session") {
            if (data.sessionId) setSessionId(data.sessionId);
          } else if (event === "cards") {
            cards = Array.isArray(data) ? data : [];
          } else if (event === "sources") {
            sources = Array.isArray(data) ? data : [];
          } else if (event === "thinking") {
            patchLast((prev) => ({ thinking: (prev.thinking || "") + (data?.text || "") }));
          } else if (event === "delta") {
            acc += data?.text || "";
            patchLast({ content: acc });
          } else if (event === "final") {
            finalReply = data?.reply || acc;
            done = true;
            patchLast({ content: finalReply, cards, sources, streaming: false });
          } else if (event === "error") {
            streamErr = new Error(data?.message || "服务端错误");
          }
        });
        if (streamErr) throw streamErr;
      }
      if (!done) {
        patchLast({ content: finalReply || acc || "（无回复）", cards, sources, streaming: false });
      }
    } catch (err) {
      patchLast({ content: `出错了：${err.message}`, error: true, streaming: false });
    } finally {
      setBusy(false);
    }
  }

  const hasMsgs = messages.length > 0;

  return (
    <>
      <div
        className={`drawer-backdrop ${open ? "is-visible" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`aidrawer ${open ? "is-open" : ""} ${fundDrawerOpen ? "aidrawer--shifted" : ""}`}
        role="dialog"
        aria-modal="false"
        aria-hidden={!open}
        onClick={(e) => e.stopPropagation()}
      >
      <header className="aidrawer__head">
        <div>
          <p className="aidrawer__eyebrow">AI 投顾</p>
          <h2>问问基金</h2>
        </div>
        <div className="aidrawer__head-actions">
          <button
            className={`aidrawer__pill ${view === "history" ? "is-on" : ""}`}
            onClick={() => { if (view === "history") { setView(hasMsgs ? "chat" : "empty"); } else { loadSessions(); setView("history"); } }}
          >历史</button>
          <button className="aidrawer__pill" onClick={newSession}>新会话</button>
          <button className="aidrawer__close" onClick={onClose} aria-label="关闭">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </header>

      <div className="aidrawer__body">
        {!loggedIn ? (
          <div className="ai-gate">
            <div className="ai-gate__icon">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 2a3 3 0 0 0-3 3v3a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 11v1a7 7 0 0 1-14 0v-1M12 19v3"/></svg>
            </div>
            <h3>登录后即可使用 AI 投顾</h3>
            <p>AI 投顾会结合你的偏好与历史会话给出可解释的研究依据，需要登录后使用。</p>
            <button className="btn btn--primary ai-gate__btn" onClick={onRequireLogin}>登录 / 注册</button>
          </div>
        ) : view === "history" ? (
          <HistoryView
            sessions={sessions}
            loggedIn={!!getSession()}
            onBack={() => setView(hasMsgs ? "chat" : "empty")}
            onPick={openSession}
          />
        ) : view === "empty" || !hasMsgs ? (
          <EmptyView
            pool={contextFund ? fundSuggestions(contextFund) : suggestions}
            contextFund={contextFund}
            onPick={(s) => sendMsg(s)}
          />
        ) : (
          <div className="ai-chat" ref={scrollRef}>
            {messages.map((m, i) => (
              m.role === "user"
                ? <UserBubble key={i} text={m.content}/>
                : <AIBubble key={i} msg={m} onOpenFund={onOpenFund} openFundCode={openFundCode}/>
            ))}
          </div>
        )}
      </div>

      <footer className="aidrawer__foot">
        {contextFund && (
          <div className="aiform__ctx">
            <span className="aiform__ctx-label">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
              {contextFund.code}
            </span>
            <span className="aiform__ctx-name">{contextFund.name}</span>
            <button className="aiform__ctx-x" onClick={onClearContext} aria-label="移除上下文">×</button>
          </div>
        )}
        <form className="aiform" onSubmit={(e) => { e.preventDefault(); if (!loggedIn) { onRequireLogin && onRequireLogin(); return; } sendMsg(); }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={!loggedIn ? "登录后即可提问" : busy ? "正在回答…" : "输入你的问题"}
            rows={1}
            maxLength={500}
            disabled={busy || !loggedIn}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!loggedIn) { onRequireLogin && onRequireLogin(); return; } sendMsg(); } }}
          />
          <button type="submit" className="aiform__send" aria-label="发送" disabled={busy || !loggedIn}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
          </button>
        </form>
        <p className="aidrawer__disclaimer">本工具非投资建议，数据可能有延迟，决策请以基金公告为准。</p>
      </footer>
      </aside>
    </>
  );
}

function EmptyView({ pool, contextFund, onPick }) {
  const [page, setPage] = useState(0);
  const list = pool && pool.length ? pool : [];
  const shown = rotate(list, page, 6);
  const canShuffle = list.length > 6;
  return (
    <div className="ai-empty">
      <div className="ai-empty__greet">
        <span className="ai-empty__avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2a3 3 0 0 0-3 3v3a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 11v1a7 7 0 0 1-14 0v-1M12 19v3"/></svg></span>
        <p>
          {contextFund
            ? `你好，我是 QDII 基金 AI 投顾。关于【${contextFund.name}】，你可以问我：`
            : "你好，我是 QDII 基金 AI 投顾。可以从下面选个问题开始，或在底部输入框自由提问："}
        </p>
      </div>
      <div className="ai-empty__suggests">
        {(shown.length ? shown : [{ text: "加载推荐问题中…", hot: false }]).map((s, i) => {
          const text = typeof s === "string" ? s : s.text;
          const isHot = typeof s === "object" && s.hot;
          return (
            <button
              key={`${page}-${i}`}
              className={`ai-suggest${isHot ? " ai-suggest--hot" : ""}`}
              onClick={() => onPick(text)}
              disabled={!shown.length}
            >
              {isHot && <span className="ai-suggest__hot" aria-label="热议">🔥</span>}
              {text}
            </button>
          );
        })}
      </div>
      {canShuffle && (
        <button className="ai-empty__shuffle" onClick={() => setPage((p) => p + 1)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          换一换
        </button>
      )}
    </div>
  );
}

function HistoryView({ sessions, loggedIn, onBack, onPick }) {
  return (
    <div className="ai-history">
      <div className="ai-history__head">
        <span>会话历史</span>
        <button className="ai-history__back" onClick={onBack}>返回当前对话</button>
      </div>
      {!loggedIn ? (
        <p className="ai-history__empty">登录后可查看和恢复历史会话。</p>
      ) : sessions.length === 0 ? (
        <p className="ai-history__empty">还没有历史会话。</p>
      ) : (
        <ul className="ai-history__list">
          {sessions.map((it) => (
            <li key={it.sessionId} className="ai-history__item" onClick={() => onPick(it.sessionId)}>
              <div className="ai-history__title">{it.title || "未命名会话"}</div>
              <div className="ai-history__meta">{(it.updatedAt || "").slice(0, 16).replace("T", " ")} · {it.count} 条</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UserBubble({ text }) {
  return (
    <div className="ai-msg ai-msg--user">
      <div className="ai-bubble ai-bubble--user">{text}</div>
    </div>
  );
}

function AIBubble({ msg, onOpenFund, openFundCode }) {
  const hasThinking = !!msg.thinking;
  // 思考中（还没出回答）默认展开；回答开始后默认折叠
  const thinkingOpen = hasThinking && !msg.content;
  return (
    <div className="ai-msg ai-msg--ai">
      <div className="ai-msg__inner">
        {hasThinking && (
          <details className="ai-thinking" open={thinkingOpen}>
            <summary className="ai-thinking__head">
              <span className="ai-thinking__icon">💭</span>
              <span className="ai-thinking__label">
                {msg.content ? "已思考" : "思考中"}
                <span className="ai-thinking__count">· {msg.thinking.length} 字</span>
              </span>
              <span className="ai-thinking__chevron" aria-hidden="true">▾</span>
            </summary>
            <div className="ai-thinking__body">{msg.thinking}</div>
          </details>
        )}
        {msg.streaming && !msg.content && !hasThinking && <p className="ai-msg__text ai-typing">正在思考…</p>}
        {msg.content && <RichReply text={msg.content} cards={msg.cards} onOpenFund={onOpenFund} openFundCode={openFundCode}/>}
        {msg.sources && msg.sources.length > 0 && (
          <details className="ai-sources">
            <summary>引用 {msg.sources.length} 条来源</summary>
            <ol>
              {msg.sources.slice(0, 5).map((s, i) => (
                <li key={i}><a href={s.url || "#"} target="_blank" rel="noreferrer">{s.title || s.url || `来源 ${i + 1}`}</a></li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}

function EmbedFundCard({ f, onOpen, isOpen }) {
  const statusCls = f.status === "open" ? "tag--status-open" : f.status === "limit" ? "tag--status-limit" : "tag--status-stop";
  return (
    <div className={`ai-fcard${isOpen ? " ai-fcard--active" : ""}`} onClick={onOpen}>
      <div className="ai-fcard__head">
        <span className={`tag ${statusCls}`}>{f.status === "open" ? "可申购" : f.limitText || "暂停"}</span>
        <span className="ai-fcard__code mono">{f.code}</span>
      </div>
      <div className="ai-fcard__title">{f.name}</div>
      <div className="ai-fcard__tags">
        {f.tags.map((t, i) => (
          <span key={i} className={`tag tag--${i === 0 ? "region" : i === 1 ? "theme" : "role"}`}>{t}</span>
        ))}
      </div>
      <div className="ai-fcard__metrics">
        <div className="ai-fcard__cell">
          <span>近 3 月</span>
          <strong className={`mono ${f.return3m >= 0 ? "up" : "down"}`}>{f.return3m >= 0 ? "+" : ""}{Number(f.return3m).toFixed(2)}%</strong>
        </div>
        <div className="ai-fcard__cell">
          <span>近 1 年</span>
          <strong className={`mono ${f.return1y >= 0 ? "up" : "down"}`}>{f.return1y >= 0 ? "+" : ""}{Number(f.return1y).toFixed(2)}%</strong>
        </div>
        <div className="ai-fcard__cell">
          <span>今年</span>
          <strong className={`mono ${f.returnYtd >= 0 ? "up" : "down"}`}>{f.returnYtd >= 0 ? "+" : ""}{Number(f.returnYtd).toFixed(2)}%</strong>
        </div>
        <div className="ai-fcard__cell">
          <span>观察分</span>
          <strong className="mono">{f.score}</strong>
        </div>
      </div>
    </div>
  );
}

export { TopBar, Hero, Toolbar, ListControls, QuickChips, FundCard, FundCardSkeleton, FundDrawer, AIDrawer };
