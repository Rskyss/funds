import React, { useState, useEffect, useCallback } from "react";

const TOKEN_KEY = "qdii_admin_token";
const getToken = () => sessionStorage.getItem(TOKEN_KEY);
const setToken = (t) => t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY);

// 后台请求：带 token、20s 超时、统一解析 JSON；非 2xx 抛错（message 取服务端 error），401 清 token
async function af(path, opts = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(path, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
      signal: opts.signal || AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error(err?.name === "TimeoutError" ? "请求超时，请稍后重试" : "网络异常，请稍后重试");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { setToken(null); throw new Error("登录已失效，请刷新页面重新登录"); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function LoadError({ message }) {
  return <div className="adm-empty" style={{ color: "#c0392b" }}>加载失败：{message}</div>;
}

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── Login ───────────────────────────────────────────────
function AdminLogin({ onLogin }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(""); setLoading(true);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "登录失败"); return; }
      setToken(d.token);
      onLogin();
    } catch { setErr("网络错误，请重试"); }
    finally { setLoading(false); }
  }

  return (
    <div className="adm-gate">
      <div className="adm-gate__card">
        <div className="adm-gate__logo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        </div>
        <h1 className="adm-gate__title">管理后台</h1>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="password"
            className="adm-input"
            placeholder="管理员密码"
            value={pw}
            onChange={e => setPw(e.target.value)}
            disabled={loading}
            autoFocus
          />
          {err && <p className="adm-form-err">{err}</p>}
          <button type="submit" className="adm-btn adm-btn--primary" disabled={loading || !pw}>
            {loading ? "验证中…" : "进入"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── 概览 ─────────────────────────────────────────────────
function sum(arr) { return (arr || []).reduce((a, b) => a + b, 0); }
function fmtMs(ms) { return ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`; }

// 纯 CSS 迷你柱状图（不引入图表库）
function MiniBars({ data, color }) {
  const max = Math.max(1, ...(data || []));
  return (
    <div className="adm-bars">
      {(data || []).map((v, i) => (
        <div key={i} className="adm-bars__col" title={`${v}`}>
          <div className="adm-bars__bar" style={{ height: `${(v / max) * 100}%`, background: color, opacity: v ? 1 : 0.16 }} />
        </div>
      ))}
    </div>
  );
}

function TrendBlock({ title, total, totalLabel = "合计", data, color }) {
  return (
    <div className="adm-trend">
      <div className="adm-trend__head">
        <span className="adm-trend__title">{title}</span>
        <span className="adm-trend__total">{totalLabel} {total}</span>
      </div>
      <MiniBars data={data} color={color} />
    </div>
  );
}

function StatsTab() {
  const [stats, setStats] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { af("/api/admin/stats").then(setStats).catch(e => setErr(e.message)); }, []);
  if (err) return <LoadError message={err} />;
  if (!stats) return <div className="adm-empty">加载中…</div>;

  const kpis = [
    { label: "注册用户", value: stats.totalUsers, color: "#3480F4", sub: `近 7 天新增 ${stats.newUsers7d}` },
    { label: "近 7 天活跃", value: stats.activeUsers7d, color: "#22c55e", sub: "用过 AI 投顾的人" },
    { label: "沉默用户", value: stats.silentUsers, color: "#f59e0b", sub: "注册后从未对话" },
    { label: "自带模型配置率", value: `${stats.aiConfiguredRate}%`, color: "#8b5cf6", sub: `${stats.aiConfiguredUsers}/${stats.totalUsers} 人已配置` },
    { label: "累计对话", value: stats.totalChats, color: "#0ea5e9", sub: `近 14 天 ${sum(stats.chatTrend)} 次` },
  ];

  const h = stats.health || {};
  const healthTiles = [
    { label: "回答成功率", value: h.okRate != null ? `${h.okRate}%` : "—", tone: h.okRate >= 95 ? "good" : "warn", hint: `近 ${h.sampleSize || 0} 次对话` },
    { label: "掉链子率（走兜底）", value: h.degradedRate != null ? `${h.degradedRate}%` : "—", tone: h.degradedRate >= 10 ? "bad" : "good", hint: `报错 ${h.errorCount || 0} 次` },
    { label: "响应中位速度", value: fmtMs(h.latencyP50), tone: "neutral", hint: "一半请求快于此" },
    { label: "最慢档（P95）", value: fmtMs(h.latencyP95), tone: "neutral", hint: "95% 请求快于此" },
    { label: "筛选没给卡片", value: h.zeroCardFilterRate != null ? `${h.zeroCardFilterRate}%` : "—", tone: h.zeroCardFilterRate >= 25 ? "bad" : "good", hint: `${h.filterZeroCard || 0}/${h.filterTotal || 0} 次筛选` },
  ];

  const intentMax = Math.max(1, ...(stats.intentDist || []).map(d => d.count));
  const intentTotal = sum((stats.intentDist || []).map(d => d.count));
  const activePeak = Math.max(0, ...(stats.activeTrend || [0]));

  return (
    <div className="adm-dash">
      <div className="adm-kpi-grid">
        {kpis.map(c => (
          <div key={c.label} className="adm-stat-card">
            <div className="adm-stat-card__num" style={{ color: c.color }}>{c.value}</div>
            <div className="adm-stat-card__label">{c.label}</div>
            <div className="adm-stat-card__sub">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="adm-panel">
        <h3 className="adm-panel__title">近 14 天趋势</h3>
        <div className="adm-trend-grid">
          <TrendBlock title="每日新增注册" total={sum(stats.registerTrend)} data={stats.registerTrend} color="#3480F4" />
          <TrendBlock title="每日对话量" total={sum(stats.chatTrend)} data={stats.chatTrend} color="#0ea5e9" />
          <TrendBlock title="每日活跃用户" totalLabel="峰值" total={activePeak} data={stats.activeTrend} color="#22c55e" />
        </div>
      </div>

      <div className="adm-two-col">
        <div className="adm-panel">
          <h3 className="adm-panel__title">用户都在问什么</h3>
          {!(stats.intentDist || []).length && <div className="adm-empty">暂无对话数据</div>}
          <div className="adm-barlist">
            {(stats.intentDist || []).map(d => (
              <div key={d.intent} className="adm-barlist__row">
                <span className="adm-barlist__label">{INTENT_LABEL[d.intent] || d.intent}</span>
                <div className="adm-barlist__track">
                  <div className="adm-barlist__fill" style={{ width: `${(d.count / intentMax) * 100}%` }} />
                </div>
                <span className="adm-barlist__val">{d.count} · {intentTotal ? Math.round(d.count / intentTotal * 100) : 0}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="adm-panel">
          <h3 className="adm-panel__title">最受欢迎的基金（按收藏数）</h3>
          {!(stats.topFavorites || []).length && <div className="adm-empty">暂无收藏数据</div>}
          <div className="adm-toplist">
            {(stats.topFavorites || []).map((f, i) => (
              <div key={f.code} className="adm-toplist__row">
                <span className="adm-toplist__rank">{i + 1}</span>
                <span className="adm-toplist__name" title={f.name}>{f.name}</span>
                <span className="adm-toplist__code mono">{f.code}</span>
                <span className="adm-toplist__count">{f.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="adm-panel">
        <h3 className="adm-panel__title">产品健康度</h3>
        <div className="adm-health-grid">
          {healthTiles.map(t => (
            <div key={t.label} className={`adm-health-tile adm-health-tile--${t.tone}`}>
              <div className="adm-health-tile__val">{t.value}</div>
              <div className="adm-health-tile__label">{t.label}</div>
              <div className="adm-health-tile__hint">{t.hint}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 用户 ─────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { af("/api/admin/users").then(d => setUsers(d.users || [])).catch(e => setErr(e.message)); }, []);
  if (err) return <LoadError message={err} />;
  if (!users) return <div className="adm-empty">加载中…</div>;
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr><th>邮箱</th><th>注册时间</th><th>最后登录</th><th>对话次数</th><th>使用的邀请码</th></tr>
        </thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td className="mono">{fmtDate(u.createdAt)}</td>
              <td className="mono">{fmtDate(u.lastSignIn)}</td>
              <td className="mono" style={{ textAlign: "center" }}>{u.chatCount}</td>
              <td className="mono adm-code">{u.inviteCode || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!users.length && <p className="adm-empty">暂无用户</p>}
    </div>
  );
}

// ─── 邀请码 ───────────────────────────────────────────────
function InvitesTab() {
  const [invites, setInvites] = useState(null);
  const [err, setErr] = useState("");
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [newCodes, setNewCodes] = useState([]);

  const load = useCallback(() => {
    af("/api/admin/invites").then(d => { setInvites(d.invites || []); setErr(""); }).catch(e => { setErr(e.message); setInvites([]); });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setGenLoading(true); setNewCodes([]);
    try {
      const d = await af("/api/admin/invites", { method: "POST", body: JSON.stringify({ count, note: note || null }) });
      setNewCodes(d.codes || []); setNote(""); setErr(""); load();
    } catch (e) { setErr(e.message); }
    finally { setGenLoading(false); }
  }

  async function del(code) {
    if (!confirm(`确认删除邀请码 ${code}？`)) return;
    try { await af(`/api/admin/invites/${code}`, { method: "DELETE" }); load(); }
    catch (e) { setErr(e.message); }
  }

  const unused = (invites || []).filter(i => i.status === "unused");
  const used = (invites || []).filter(i => i.status === "used");

  return (
    <div>
      {/* 生成工具栏 */}
      <div className="adm-gen-bar">
        <span className="adm-gen-bar__label">生成邀请码</span>
        <input type="number" min="1" max="50" value={count}
          onChange={e => setCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
          className="adm-input adm-input--xs" />
        <input type="text" placeholder="备注（可选）" value={note}
          onChange={e => setNote(e.target.value)}
          className="adm-input adm-input--md" />
        <button className="adm-btn adm-btn--primary" onClick={generate} disabled={genLoading}>
          {genLoading ? "生成中…" : "生成"}
        </button>
      </div>

      {err && <p className="adm-form-err">{err}</p>}

      {/* 刚生成的码高亮展示 */}
      {newCodes.length > 0 && (
        <div className="adm-new-codes">
          <span className="adm-new-codes__label">已生成（可复制发给用户）</span>
          <div className="adm-new-codes__list">
            {newCodes.map(c => <span key={c} className="adm-new-codes__item">{c}</span>)}
          </div>
        </div>
      )}

      {/* 可用 */}
      <h3 className="adm-section-title">可用邀请码（{unused.length}）</h3>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>邀请码</th><th>创建时间</th><th>备注</th><th>操作</th></tr></thead>
          <tbody>
            {unused.map(i => (
              <tr key={i.code}>
                <td className="mono adm-code">{i.code}</td>
                <td className="mono">{fmtDate(i.created_at)}</td>
                <td style={{ color: "var(--muted)" }}>{i.note || "—"}</td>
                <td>
                  <button className="adm-btn adm-btn--danger adm-btn--xs" onClick={() => del(i.code)}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!unused.length && <p className="adm-empty">暂无可用邀请码</p>}
      </div>

      {/* 已使用 */}
      <h3 className="adm-section-title">已使用邀请码（{used.length}）</h3>
      <div className="adm-table-wrap">
        <table className="adm-table">
          <thead><tr><th>邀请码</th><th>使用时间</th><th>备注</th></tr></thead>
          <tbody>
            {used.map(i => (
              <tr key={i.code}>
                <td className="mono adm-code">{i.code}</td>
                <td className="mono">{fmtDate(i.used_at)}</td>
                <td style={{ color: "var(--muted)" }}>{i.note || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!used.length && <p className="adm-empty">暂无已使用记录</p>}
      </div>
    </div>
  );
}

// ─── 对话记录 ─────────────────────────────────────────────
const INTENT_LABEL = {
  filter: "筛选基金", compare: "对比", concept: "概念解释",
  event: "热点事件", inquire: "个股查询", general: "综合问答",
  mixed: "混合问答",
};

function ChatsTab() {
  const [users, setUsers] = useState(null);
  const [selUser, setSelUser] = useState(null); // {id, email, chatCount}
  const [chats, setChats] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [issuesOnly, setIssuesOnly] = useState(false);

  // 加载有过对话的用户列表
  useEffect(() => {
    af("/api/admin/users").then(d => {
      const list = (d.users || []).filter(u => u.chatCount > 0).sort((a, b) => b.chatCount - a.chatCount);
      setUsers(list);
      if (list.length) setSelUser(list[0]);
    }).catch(() => setUsers([]));
  }, []);

  // 加载对话（issues=只看异常/降级，跨全部用户）
  const loadChats = useCallback((uid, p, issues) => {
    setChats(null);
    const params = new URLSearchParams({ page: String(p) });
    if (uid) params.set("userId", uid);
    if (issues) params.set("issues", "1");
    af(`/api/admin/chats?${params.toString()}`)
      .then(d => { setChats(d.chats || []); setHasMore(d.hasMore || false); })
      .catch(() => setChats([]));
  }, []);

  useEffect(() => {
    setPage(0);
    if (issuesOnly) loadChats(null, 0, true);
    else if (selUser) loadChats(selUser.id, 0, false);
  }, [selUser, issuesOnly, loadChats]);

  return (
    <div className="adm-chats-layout">
      {/* 左：用户列表 */}
      <aside className="adm-user-sidebar">
        <div className="adm-user-sidebar__title">用户（有对话）</div>
        {users === null && <div className="adm-empty" style={{ padding: "16px 12px" }}>加载中…</div>}
        {users && !users.length && <div className="adm-empty" style={{ padding: "16px 12px" }}>暂无对话用户</div>}
        <div className={issuesOnly ? "adm-user-list--dim" : ""}>
          {(users || []).map(u => (
            <button
              key={u.id}
              className={`adm-user-item ${!issuesOnly && selUser?.id === u.id ? "is-sel" : ""}`}
              onClick={() => { setIssuesOnly(false); setSelUser(u); }}
            >
              <span className="adm-user-item__email">{u.email}</span>
              <span className="adm-user-item__count">{u.chatCount}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* 右：对话内容 */}
      <div className="adm-convo-panel">
        <div className="adm-convo-header">
          {issuesOnly ? (
            <span className="adm-convo-header__email">全部异常 / 降级对话</span>
          ) : selUser ? (
            <>
              <span className="adm-convo-header__email">{selUser.email}</span>
              <span className="adm-convo-header__count">共 {selUser.chatCount} 次对话</span>
            </>
          ) : (
            <span className="adm-convo-header__email">对话记录</span>
          )}
          <button
            className={`adm-btn adm-btn--xs ${issuesOnly ? "adm-btn--danger" : "adm-btn--ghost-light"}`}
            style={{ marginLeft: "auto" }}
            onClick={() => setIssuesOnly(v => !v)}
          >
            {issuesOnly ? "← 返回按用户查看" : "只看异常 / 降级"}
          </button>
        </div>

        {!selUser && !issuesOnly && <div className="adm-empty" style={{ paddingTop: 60 }}>← 选择左侧用户查看对话</div>}

        {(selUser || issuesOnly) && (
          <>
            {chats === null && <div className="adm-empty" style={{ paddingTop: 40 }}>加载中…</div>}
            {chats && !chats.length && (
              <div className="adm-empty" style={{ paddingTop: 40 }}>
                {issuesOnly ? "近期没有异常或降级的对话 🎉" : "暂无记录"}
              </div>
            )}

            <div className="adm-convo-list">
              {(chats || []).map(c => (
                <div key={c.id} className={`adm-convo-card ${(!c.ok || c.degraded) ? "adm-convo-card--err" : ""}`}>
                  <div className="adm-convo-card__meta">
                    <span className="mono">{fmtDate(c.created_at)}</span>
                    <span className="adm-intent-tag">{INTENT_LABEL[c.intent] || c.intent || "—"}</span>
                    {c.latency_ms && <span className="adm-convo-card__lat">{(c.latency_ms / 1000).toFixed(1)}s</span>}
                    {!c.ok && <span className="adm-badge adm-badge--err">异常</span>}
                    {c.degraded && <span className="adm-badge adm-badge--warn">降级</span>}
                    {issuesOnly && c.userEmail && <span className="adm-convo-card__user">{c.userEmail}</span>}
                  </div>
                  <div className="adm-convo-card__q">
                    <span className="adm-convo-card__role adm-convo-card__role--user">问</span>
                    <p>{c.user_message}</p>
                  </div>
                  <div className="adm-convo-card__a">
                    <span className="adm-convo-card__role adm-convo-card__role--ai">答</span>
                    <p>{c.reply_preview || "（无回复记录）"}</p>
                  </div>
                  {c.error && <p className="adm-chat-detail__err" style={{ margin: "4px 0 0" }}>错误：{c.error}</p>}
                </div>
              ))}
            </div>

            {(page > 0 || hasMore) && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center", padding: "16px 0" }}>
                {page > 0 && (
                  <button className="adm-btn adm-btn--primary" onClick={() => { const p = page - 1; setPage(p); loadChats(issuesOnly ? null : selUser.id, p, issuesOnly); }}>
                    上一页
                  </button>
                )}
                {hasMore && (
                  <button className="adm-btn adm-btn--primary" onClick={() => { const p = page + 1; setPage(p); loadChats(issuesOnly ? null : selUser.id, p, issuesOnly); }}>
                    下一页
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── 行为 ─────────────────────────────────────────────────
function BehaviorTab() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { af("/api/admin/behavior").then(setData).catch(e => setErr(e.message)); }, []);
  if (err) return <LoadError message={err} />;
  if (!data) return <div className="adm-empty">加载中…</div>;

  const f = data.funnel || {};
  const r = data.retention || {};
  const tt = data.typeTotals || {};
  const funnelSteps = [
    { label: "访问网站", value: f.visitors || 0, color: "#3480F4" },
    { label: "打开基金详情", value: f.openedFund || 0, color: "#0ea5e9" },
    { label: "用了 AI 投顾", value: f.askedAI || 0, color: "#22c55e" },
  ];
  const fMax = Math.max(1, ...funnelSteps.map(s => s.value));
  const hasAny = (tt.page_view || 0) + (tt.fund_open || 0) + (tt.search || 0) + (tt.filter || 0) + (tt.buy_click || 0) > 0;
  const kpis = [
    { label: "页面浏览", value: tt.page_view || 0, color: "#3480F4" },
    { label: "打开基金详情", value: tt.fund_open || 0, color: "#0ea5e9" },
    { label: "搜索次数", value: tt.search || 0, color: "#8b5cf6" },
    { label: "筛选点击", value: tt.filter || 0, color: "#f59e0b" },
    { label: "点击购买渠道", value: tt.buy_click || 0, color: "#ef4444" },
  ];

  return (
    <div className="adm-dash">
      {!hasAny && (
        <div className="adm-panel">
          <div className="adm-empty" style={{ padding: "8px" }}>
            行为采集刚上线，目前还没有数据。用户开始浏览后，这里会陆续出现浏览热度、搜索热词、转化漏斗和留存。
          </div>
        </div>
      )}

      <div className="adm-kpi-grid" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        {kpis.map(c => (
          <div key={c.label} className="adm-stat-card">
            <div className="adm-stat-card__num" style={{ color: c.color }}>{c.value}</div>
            <div className="adm-stat-card__label">{c.label}</div>
            <div className="adm-stat-card__sub">近 14 天</div>
          </div>
        ))}
      </div>

      <div className="adm-panel">
        <h3 className="adm-panel__title">近 14 天趋势</h3>
        <div className="adm-trend-grid">
          <TrendBlock title="每日访客（去重）" totalLabel="峰值" total={Math.max(0, ...(data.visitorTrend || [0]))} data={data.visitorTrend} color="#3480F4" />
          <TrendBlock title="每日打开基金" total={sum(data.openTrend)} data={data.openTrend} color="#0ea5e9" />
          <TrendBlock title="每日搜索" total={sum(data.searchTrend)} data={data.searchTrend} color="#8b5cf6" />
        </div>
      </div>

      <div className="adm-two-col">
        <div className="adm-panel">
          <h3 className="adm-panel__title">转化漏斗（近 14 天）</h3>
          <div className="adm-funnel">
            {funnelSteps.map((s, i) => {
              const prev = i > 0 ? funnelSteps[i - 1].value : null;
              const conv = prev ? Math.round(s.value / prev * 100) : null;
              return (
                <div key={s.label} className="adm-funnel__row">
                  <span className="adm-funnel__label">{s.label}</span>
                  <div className="adm-funnel__track">
                    <div className="adm-funnel__fill" style={{ width: `${(s.value / fMax) * 100}%`, background: s.color }}>
                      <span className="adm-funnel__num">{s.value}</span>
                    </div>
                  </div>
                  <span className="adm-funnel__conv">{conv != null ? `↘ ${conv}%` : "起点"}</span>
                </div>
              );
            })}
          </div>
          <p className="adm-note">「用了 AI 投顾」需登录后使用，按账号关联统计。</p>
        </div>

        <div className="adm-panel">
          <h3 className="adm-panel__title">访客次日回访留存</h3>
          <div className="adm-retention">
            <div className="adm-retention__big">{r.rate || 0}%</div>
            <div className="adm-retention__hint">
              昨天及更早首次到访的 {r.cohort || 0} 位访客里，有 {r.returned || 0} 位之后又回来了。
            </div>
          </div>
          <p className="adm-note">数据从今天开始累积，越往后越准。</p>
        </div>
      </div>

      <div className="adm-two-col">
        <div className="adm-panel">
          <h3 className="adm-panel__title">基金浏览热度 Top（打开详情次数）</h3>
          {!(data.topViewedFunds || []).length && <div className="adm-empty">暂无数据</div>}
          <div className="adm-toplist">
            {(data.topViewedFunds || []).map((x, i) => (
              <div key={x.code} className="adm-toplist__row">
                <span className="adm-toplist__rank">{i + 1}</span>
                <span className="adm-toplist__name" title={x.name}>{x.name}</span>
                <span className="adm-toplist__code mono">{x.code}</span>
                <span className="adm-toplist__count">{x.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="adm-panel">
          <h3 className="adm-panel__title">搜索热词 Top</h3>
          {!(data.topSearches || []).length && <div className="adm-empty">暂无搜索数据</div>}
          <div className="adm-toplist">
            {(data.topSearches || []).map((x, i) => (
              <div key={x.q + i} className="adm-toplist__row">
                <span className="adm-toplist__rank">{i + 1}</span>
                <span className="adm-toplist__name" title={x.q}>{x.q}</span>
                <span className="adm-toplist__count">{x.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 主壳 ─────────────────────────────────────────────────
export default function Admin() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState("stats");

  useEffect(() => {
    if (!getToken()) { setChecking(false); return; }
    af("/api/admin/verify")
      .then(() => setAuthed(true))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="adm-gate"><div className="adm-empty">验证中…</div></div>;
  if (!authed) return <AdminLogin onLogin={() => setAuthed(true)} />;

  const tabs = [{ key: "stats", label: "概览" }, { key: "users", label: "用户" }, { key: "behavior", label: "行为" }, { key: "invites", label: "邀请码" }, { key: "chats", label: "对话记录" }];

  return (
    <div className="adm-app">
      <header className="adm-header">
        <span className="adm-header__brand">QDII 管理后台</span>
        <nav className="adm-nav">
          {tabs.map(t => (
            <button key={t.key} className={`adm-nav__btn ${tab === t.key ? "is-on" : ""}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
        <button className="adm-btn adm-btn--ghost" onClick={() => { setToken(null); setAuthed(false); }}>退出</button>
      </header>
      <main className="adm-body">
        {tab === "stats" && <StatsTab />}
        {tab === "users" && <UsersTab />}
        {tab === "behavior" && <BehaviorTab />}
        {tab === "invites" && <InvitesTab />}
        {tab === "chats" && <ChatsTab />}
      </main>
    </div>
  );
}
