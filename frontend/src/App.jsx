/* QDII Compass — App shell */
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  TopBar,
  Hero,
  Toolbar,
  ListControls,
  QuickChips,
  FundCard,
  FundCardSkeleton,
  FundDrawer,
  AIDrawer,
} from "./components.jsx";
import { QUICK_CHIPS } from "./data.js";
import AuthModal from "./AuthModal.jsx";
import AiSettingsModal from "./AiSettingsModal.jsx";
import { init as initAuth, onAuthChange, signOut, getSession, authedFetch } from "./auth.js";
import { readFundsCache, writeFundsCache } from "./fundsCache.js";

const ACCENT = "#3480F4";

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

// "综合配置" 是未归类的兜底桶，不算一个有意义的板块，不展示
const BOARD_EXCLUDE = new Set(["综合配置"]);

function computeBoards(funds) {
  const g = new Map();
  for (const f of funds) {
    const theme = f.theme;
    if (!theme || BOARD_EXCLUDE.has(theme)) continue;
    let e = g.get(theme);
    if (!e) { e = { theme, count: 0, sum: 0, valued: 0 }; g.set(theme, e); }
    e.count += 1;
    if (typeof f.return1d === "number") { e.sum += f.return1d; e.valued += 1; }
  }
  return [...g.values()]
    .map((e) => ({ theme: e.theme, count: e.count, avg1d: e.valued ? +(e.sum / e.valued).toFixed(2) : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

function App() {
  const t = { accent: ACCENT };

  const [q, setQ] = useState("");
  const [sort, setSort] = useState("return1y");
  const [sortDir, setSortDir] = useState("desc");
  const [activeChip, setActiveChip] = useState(null);
  const [themeSel, setThemeSel] = useState(null);
  const [favs, setFavs] = useState(new Set());
  const [favOnly, setFavOnly] = useState(false);
  const [session, setSession] = useState(null);
  const [authModal, setAuthModal] = useState(null); // null | "login" | "register"
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);

  useEffect(() => {
    initAuth();
    const off = onAuthChange((s) => setSession(s));
    return off;
  }, []);

  useEffect(() => {
    if (!session) { setFavs(new Set()); setFavOnly(false); return; }
    let alive = true;
    authedFetch("/api/favorites")
      .then((r) => (r.ok ? r.json() : { favorites: [] }))
      .then((d) => { if (alive) setFavs(new Set(d.favorites || [])); })
      .catch(() => {});
    return () => { alive = false; };
  }, [session]);

  useEffect(() => {
    if (!session) { setAiConfigured(false); return; }
    authedFetch("/api/profile").then((r) => r.json())
      .then((d) => setAiConfigured(!!d?.profile?.aiConfigured)).catch(() => setAiConfigured(false));
  }, [session]);
  const [openFund, setOpenFund] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatContextFund, setChatContextFund] = useState(null);

  const [allFunds, setAllFunds] = useState([]);
  const [meta, setMeta] = useState({ total: 0, fetchedAtText: "" });
  const [loading, setLoading] = useState(() => !readFundsCache());
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
    if (cached) applyPayload(cached);

    fetch("/api/funds")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        if (!alive) return;
        writeFundsCache(data);
        applyPayload(data);
      })
      .catch((e) => {
        if (!alive) return;
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

  const handleOpenFund = useCallback((fund) => {
    setOpenFund((cur) => (cur?.code === fund?.code ? null : fund));
  }, []);

  const openFundByCode = useCallback((f) => {
    const code = typeof f === "string" ? f : f?.code;
    if (!code) return;
    const fromList = allFunds.find((x) => x.code === code);
    setOpenFund((cur) => {
      if (cur?.code === code) return null;
      if (fromList) return fromList;
      return {
        code, name: f?.name || code,
        region: "", theme: "", role: "", risk: "",
        manager: "—", rating: 0, sharpe: 0, aum: 0, drawdown: 0,
        return3m: 0, return1y: 0, returnYtd: 0,
        status: "open", limitYuan: null, sparkSeed: parseInt(code, 10) || 1,
      };
    });
  }, [allFunds]);

  const boards = useMemo(() => computeBoards(allFunds), [allFunds]);
  const toggleTheme = useCallback((th) => {
    setThemeSel((s) => (s === th ? null : th));
  }, []);

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
  if (themeSel) funds = funds.filter((f) => f.theme === themeSel);
  if (favOnly) funds = funds.filter((f) => favs.has(f.code));
  funds = [...funds].sort((a, b) => {
    let diff = 0;
    if (sort === "return1y") diff = a.return1y - b.return1y;
    else if (sort === "sharpe") diff = a.sharpe - b.sharpe;
    else if (sort === "rating") diff = a.rating - b.rating;
    else if (sort === "aum") diff = a.aum - b.aum;
    return sortDir === "asc" ? diff : -diff;
  });

  return (
    <>
      <TopBar
        onOpenChat={() => { if (!session) { setAuthModal("login"); } else { setChatOpen(true); } }}
        session={session}
        onLogin={() => setAuthModal("login")}
        onLogout={signOut}
        onOpenAiSettings={() => setAiSettingsOpen(true)}
      />
      <main className="shell">
        <Hero boards={boards} selected={themeSel} onSelect={toggleTheme} total={meta.total} updatedText={meta.fetchedAtText}/>

        <div className="filter-row">
          <Toolbar q={q} setQ={setQ} />
          <QuickChips active={activeChip} setActive={setActiveChip}/>
        </div>

        <div className="results-head">
          <h2>
            QDII 基金列表
            <span className="count-wrap">
              <span className="count">{funds.length}</span>
              <span className="total"> / {allFunds.length}</span>
            </span>
            <span className="list-controls" style={{ marginLeft: "10px" }}>
              <button
                className={`list-controls__btn ${favOnly ? "is-active" : ""}`}
                onClick={() => {
                  if (!favOnly && !session) { setAuthModal("login"); return; }
                  setFavOnly(!favOnly);
                }}
              >
                自选（{favs.size}）
              </button>
            </span>
          </h2>
          <div className="results-meta">
            <ListControls
              sort={sort}
              sortDir={sortDir}
              onSortChange={(k, d) => { setSort(k); setSortDir(d); }}
            />
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
        {allFunds.length > 0 && funds.length === 0 && (
          <div className="empty-hint">
            {favOnly ? "你还没有收藏任何基金，或当前筛选下没有匹配的自选。" : "没有匹配的 QDII 基金，试试调整搜索或筛选条件。"}
          </div>
        )}
        {allFunds.length > 0 && funds.length > 0 && (
        <div className="fund-grid">
          {funds.map((f, i) => (
            <FundCard
              key={f.code}
              fund={f}
              idx={i}
              isFav={favs.has(f.code)}
              onFav={toggleFav}
              onOpen={handleOpenFund}
              isOpen={openFund?.code === f.code}
            />
          ))}
        </div>
        )}

        <footer className="page-foot">
          <div className="page-foot__inner">
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
        aiConfigured={aiConfigured}
      />

      <AIDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        fundDrawerOpen={!!openFund}
        openFundCode={openFund?.code || null}
        onOpenFund={openFundByCode}
        loggedIn={!!session}
        onRequireLogin={() => setAuthModal("login")}
        contextFund={chatContextFund}
        onClearContext={() => setChatContextFund(null)}
        onNewSession={() => { setOpenFund(null); setChatContextFund(null); }}
        aiConfigured={aiConfigured}
        onOpenAiSettings={() => setAiSettingsOpen(true)}
      />

      <AuthModal
        open={!!authModal}
        mode={authModal === "register" ? "register" : "login"}
        onClose={() => setAuthModal(null)}
        onSwitch={(m) => setAuthModal(m)}
        onSuccess={() => setAuthModal(null)}
      />

      <AiSettingsModal
        open={aiSettingsOpen}
        onClose={() => setAiSettingsOpen(false)}
        onSaved={(ok) => setAiConfigured(ok)}
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
