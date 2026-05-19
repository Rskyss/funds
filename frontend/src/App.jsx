/* QDII Compass — App shell */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  TopBar,
  Hero,
  Toolbar,
  QuickChips,
  FundCard,
  FundCardSkeleton,
  FundDrawer,
  AIDrawer,
} from "./components.jsx";
import { QUICK_CHIPS } from "./data.js";
import AuthModal from "./AuthModal.jsx";
import { init as initAuth, onAuthChange, signOut, getSession, authedFetch } from "./auth.js";
import { readFundsCache, writeFundsCache } from "./fundsCache.js";

const ACCENT = "#1E40FF";

// 真实接口字段 → 原型组件期望字段（旧业务口径：purchaseStatus = 开放/限购/暂停/null）
function normalizeFund(f) {
  const status =
    f.purchaseStatus === "限购" ? "limit" :
    f.purchaseStatus === "暂停" ? "stop" : "open";
  const hasReturn1y = typeof f.return1y === "number";
  const hasReturn3m = typeof f.return3m === "number";
  const hasReturn3y = typeof f.return3y === "number";
  const hasReturnYtd = typeof f.returnYtd === "number";
  const hasAum = typeof f.aumBillion === "number";
  const hasRating = typeof f.ratingMorningstar === "number" && f.ratingMorningstar > 0;
  const hasSharpe = typeof f.sharpe1y === "number";
  const hasDrawdown = typeof f.maxDrawdown1y === "number";
  return {
    ...f,
    status,
    limitYuan: f.purchaseLimitYuan ?? null,
    manager: f.managerNames || "—",
    aum: hasAum ? f.aumBillion : 0,
    rating: hasRating ? f.ratingMorningstar : 0,
    sharpe: hasSharpe ? f.sharpe1y : 0,
    drawdown: hasDrawdown ? f.maxDrawdown1y : 0,
    return3m: f.return3m ?? 0,
    return1y: f.return1y ?? 0,
    return3y: f.return3y ?? null,
    returnYtd: f.returnYtd ?? 0,
    // 次新/无完整数据基金：缺近1年收益即视为次新
    isNew: !hasReturn1y,
    hasReturn1y, hasReturn3m, hasReturn3y, hasReturnYtd, hasAum, hasRating, hasSharpe, hasDrawdown,
    sparkSeed: (parseInt(f.code, 10) || 1) % 100000,
  };
}

function computeKpis(funds, total) {
  const n = funds.length;
  const rated4 = funds.filter((f) => f.ratingMorningstar && f.ratingMorningstar >= 4).length;
  const techPct = n ? Math.round((funds.filter((f) => f.theme === "科技成长").length / n) * 100) : 0;
  const avg1y = n ? +(funds.reduce((s, f) => s + (f.return1y || 0), 0) / n).toFixed(1) : 0;
  return [
    { id: "total", label: "QDII 全市场基金", tag: "ALL", value: total || n, unit: "只", delta: "实时收录", deltaKind: "neutral", sparkSeed: 7, drift: 0.05, vol: 0.012 },
    { id: "stars", label: "晨星 4+ 星", tag: "★", value: rated4, unit: "只", delta: "评级 ≥ 4 星", deltaKind: "up", sparkSeed: 17, drift: 0.08, vol: 0.014 },
    { id: "tech", label: "科技成长占比", tag: "%", value: techPct, unit: "%", delta: "主题分布", deltaKind: "up", sparkSeed: 27, drift: 0.07, vol: 0.010 },
    { id: "avg1y", label: "QDII 平均 1Y 回报", tag: "1Y", value: avg1y, unit: "%", delta: "近 1 年均值", deltaKind: avg1y >= 0 ? "up" : "down", sparkSeed: 37, drift: 0.15, vol: 0.018 },
  ];
}

function App() {
  const t = { accent: ACCENT };

  const [q, setQ] = useState("");
  const [sort, setSort] = useState("return1y");
  const [activeChip, setActiveChip] = useState(null);
  const [favs, setFavs] = useState(new Set());
  const [session, setSession] = useState(null);
  const [authModal, setAuthModal] = useState(null); // null | "login" | "register"

  useEffect(() => {
    initAuth();
    const off = onAuthChange((s) => setSession(s));
    return off;
  }, []);

  useEffect(() => {
    if (!session) { setFavs(new Set()); return; }
    let alive = true;
    authedFetch("/api/favorites")
      .then((r) => (r.ok ? r.json() : { favorites: [] }))
      .then((d) => { if (alive) setFavs(new Set(d.favorites || [])); })
      .catch(() => {});
    return () => { alive = false; };
  }, [session]);
  const [openFund, setOpenFund] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatContextFund, setChatContextFund] = useState(null);

  const [allFunds, setAllFunds] = useState([]);
  const [meta, setMeta] = useState({ total: 0, fetchedAtText: "" });
  const [loading, setLoading] = useState(() => !readFundsCache());
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let alive = true;

    const applyPayload = (data) => {
      const list = (data.funds || []).map(normalizeFund);
      setAllFunds(list);
      setMeta({ total: data.total || list.length, fetchedAtText: data.fetchedAtText || "" });
      setLoading(false);
      setLoadError(null);
    };

    const cached = readFundsCache();
    if (cached) {
      applyPayload(cached);
      setSyncing(true);
    }

    fetch("/api/funds")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        if (!alive) return;
        writeFundsCache(data);
        applyPayload(data);
        setSyncing(false);
      })
      .catch((e) => {
        if (!alive) return;
        setSyncing(false);
        if (!cached) {
          setLoadError(e.message);
          setLoading(false);
        }
      });
    return () => { alive = false; };
  }, []);

  // apply accent
  useEffect(() => {
    document.documentElement.style.setProperty("--accent", t.accent);
    // derive hover by darkening 12%
    const dark = shade(t.accent, -0.18);
    document.documentElement.style.setProperty("--accent-hover", dark);
    const soft = mixWithWhite(t.accent, 0.92);
    document.documentElement.style.setProperty("--accent-soft", soft);
    const edge = mixWithWhite(t.accent, 0.62);
    document.documentElement.style.setProperty("--accent-edge", edge);
    document.documentElement.style.setProperty("--accent-glow", hexToRgba(t.accent, 0.22));
  }, [t.accent]);

  const toggleFav = useCallback(async (code) => {
    if (!getSession()) { setAuthModal("login"); return; }
    setFavs((s) => {
      const n = new Set(s);
      if (s.has(code)) n.delete(code); else n.add(code);
      return n;
    });
    const wasFav = favs.has(code);
    try {
      const res = wasFav
        ? await authedFetch(`/api/favorites/${code}`, { method: "DELETE" })
        : await authedFetch("/api/favorites", { method: "POST", body: JSON.stringify({ code }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      setFavs((s) => {
        const n = new Set(s);
        if (wasFav) n.add(code); else n.delete(code);
        return n;
      });
      alert("收藏操作失败：" + (err.message || "请重试"));
    }
  }, [favs]);

  const openFundByCode = useCallback((f) => {
    const code = typeof f === "string" ? f : f?.code;
    if (!code) return;
    const fromList = allFunds.find((x) => x.code === code);
    if (fromList) { setOpenFund(fromList); return; }
    setOpenFund({
      code, name: f?.name || code,
      region: "", theme: "", role: "", risk: "",
      manager: "—", rating: 0, sharpe: 0, aum: 0, drawdown: 0,
      return3m: 0, return1y: 0, returnYtd: 0,
      status: "open", limitYuan: null, sparkSeed: parseInt(code, 10) || 1,
    });
  }, [allFunds]);

  const kpis = useMemo(() => computeKpis(allFunds, meta.total), [allFunds, meta.total]);

  // filter funds
  let funds = allFunds;
  if (q.trim()) {
    const k = q.trim().toLowerCase();
    funds = funds.filter((f) =>
      `${f.code} ${f.name} ${f.theme} ${f.region} ${f.manager}`.toLowerCase().includes(k)
    );
  }
  if (activeChip) {
    const chip = QUICK_CHIPS.find((c) => c.id === activeChip);
    if (chip) {
      if (chip.region) funds = funds.filter((f) => f.region === chip.region);
      if (chip.theme) funds = funds.filter((f) => f.theme === chip.theme);
      if (chip.role) funds = funds.filter((f) => f.role === chip.role);
      if (chip.rating) funds = funds.filter((f) => f.rating === chip.rating);
      if (chip.status) funds = funds.filter((f) => f.status === chip.status);
      if (chip.keyword) funds = funds.filter((f) => f.name.includes(chip.keyword));
    }
  }
  funds = [...funds].sort((a, b) => {
    if (sort === "return1y") return b.return1y - a.return1y;
    if (sort === "sharpe")   return b.sharpe - a.sharpe;
    if (sort === "rating")   return b.rating - a.rating;
    if (sort === "aum")      return b.aum - a.aum;
    return 0;
  });

  return (
    <>
      <TopBar
        onOpenChat={() => { if (!session) { setAuthModal("login"); } else { setChatOpen(true); } }}
        session={session}
        onLogin={() => setAuthModal("login")}
        onLogout={signOut}
      />
      <main className="shell">
        <Hero kpis={kpis} total={meta.total} updatedText={meta.fetchedAtText}/>

        <Toolbar
          q={q} setQ={setQ}
          sort={sort} setSort={setSort}
        />

        <QuickChips active={activeChip} setActive={setActiveChip}/>

        <div className="results-head">
          <h2>
            QDII 基金列表
            <span className="count">{funds.length}</span>
            <span className="total"> / {allFunds.length}</span>
          </h2>
          <div className="results-meta">
            <span className="live-pill">
              <span className="live-pill__dot"/>
              LIVE · NAV
            </span>
            {syncing && <span className="sync-pill">同步中</span>}
            <span>自选 <strong style={{color: "#E8A50B", fontFamily: "var(--font-mono)"}}>{favs.size}</strong></span>
          </div>
        </div>

        {loading && !allFunds.length && (
          <div className="fund-grid">
            {Array.from({ length: 9 }, (_, i) => <FundCardSkeleton key={i} />)}
          </div>
        )}
        {!loading && loadError && !allFunds.length && (
          <div style={{ padding: "60px 0", textAlign: "center", color: "var(--down, #e5484d)" }}>
            数据加载失败：{loadError}
          </div>
        )}
        {allFunds.length > 0 && (
        <div className="fund-grid">
          {funds.map((f, i) => (
            <FundCard
              key={f.code}
              fund={f}
              idx={i}
              isFav={favs.has(f.code)}
              onFav={toggleFav}
              onOpen={setOpenFund}
            />
          ))}
        </div>
        )}

        <footer className="page-foot">
          <div className="page-foot__inner">
            <div className="page-foot__brand">
              <div className="brand__mark" aria-hidden="true"/>
              <div>
                <div className="brand__title">QDII 罗盘</div>
                <div className="brand__sub">FUND COMPASS · PRO</div>
              </div>
            </div>
            <p>本工具仅用于基金信息整理与分析，不构成投资建议。基金数据、持仓与申购状态可能存在延迟，最终以基金公司公告与销售平台为准。</p>
            <div className="page-foot__meta">
              <span>数据源 · 东方财富 / 天天基金 / 晨星</span>
              <span>·</span>
              <span>{new Date().getFullYear()} QDII Compass</span>
            </div>
          </div>
        </footer>
      </main>

      <FundDrawer
        fund={openFund}
        onClose={() => setOpenFund(null)}
        isFav={openFund ? favs.has(openFund.code) : false}
        onFav={() => openFund && toggleFav(openFund.code)}
        chatOpen={chatOpen}
        onOpenFund={openFundByCode}
        onOpenChat={() => { if (!session) { setAuthModal("login"); } else { setChatContextFund(openFund); setChatOpen(true); } }}
        onCloseChat={() => setChatOpen(false)}
      />

      <AIDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        fundDrawerOpen={!!openFund}
        onOpenFund={openFundByCode}
        loggedIn={!!session}
        onRequireLogin={() => setAuthModal("login")}
        contextFund={chatContextFund}
        onClearContext={() => setChatContextFund(null)}
        onNewSession={() => { setOpenFund(null); setChatContextFund(null); }}
      />

      <AuthModal
        open={!!authModal}
        mode={authModal === "register" ? "register" : "login"}
        onClose={() => setAuthModal(null)}
        onSwitch={(m) => setAuthModal(m)}
        onSuccess={() => setAuthModal(null)}
      />

    </>
  );
}

// ----- color helpers -----
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}
function rgbToHex(r,g,b) {
  return "#" + [r,g,b].map(x => Math.round(Math.max(0, Math.min(255,x))).toString(16).padStart(2,"0")).join("");
}
function shade(hex, pct) {
  const [r,g,b] = hexToRgb(hex);
  const f = pct < 0 ? 1 + pct : 1 - pct;
  if (pct < 0) return rgbToHex(r*f, g*f, b*f);
  return rgbToHex(r + (255-r)*pct, g + (255-g)*pct, b + (255-b)*pct);
}
function mixWithWhite(hex, amt) {
  const [r,g,b] = hexToRgb(hex);
  return rgbToHex(r + (255-r)*amt, g + (255-g)*amt, b + (255-b)*amt);
}
function hexToRgba(hex, a) {
  const [r,g,b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export default App;
