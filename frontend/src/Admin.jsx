import React, { useState, useEffect, useCallback } from "react";

const TOKEN_KEY = "qdii_admin_token";
const getToken = () => sessionStorage.getItem(TOKEN_KEY);
const setToken = (t) => t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY);

function af(path, opts = {}) {
  const token = getToken();
  return fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
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
function StatsTab() {
  const [stats, setStats] = useState(null);
  useEffect(() => { af("/api/admin/stats").then(r => r.json()).then(setStats).catch(() => {}); }, []);
  if (!stats) return <div className="adm-empty">加载中…</div>;
  const cards = [
    { label: "注册用户", value: stats.totalUsers, color: "#3480F4" },
    { label: "总对话次数", value: stats.totalChats, color: "#22c55e" },
    { label: "可用邀请码", value: stats.unusedInvites, color: "#f59e0b" },
    { label: "已使用邀请码", value: stats.usedInvites, color: "#8b5cf6" },
  ];
  return (
    <div className="adm-stats-grid">
      {cards.map(c => (
        <div key={c.label} className="adm-stat-card">
          <div className="adm-stat-card__num" style={{ color: c.color }}>{c.value}</div>
          <div className="adm-stat-card__label">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── 用户 ─────────────────────────────────────────────────
function UsersTab() {
  const [users, setUsers] = useState(null);
  useEffect(() => { af("/api/admin/users").then(r => r.json()).then(d => setUsers(d.users)).catch(() => {}); }, []);
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
  const [count, setCount] = useState(1);
  const [note, setNote] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [newCodes, setNewCodes] = useState([]);

  const load = useCallback(() => {
    af("/api/admin/invites").then(r => r.json()).then(d => setInvites(d.invites)).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setGenLoading(true); setNewCodes([]);
    try {
      const r = await af("/api/admin/invites", { method: "POST", body: JSON.stringify({ count, note: note || null }) });
      const d = await r.json();
      if (r.ok) { setNewCodes(d.codes || []); setNote(""); load(); }
    } finally { setGenLoading(false); }
  }

  async function del(code) {
    if (!confirm(`确认删除邀请码 ${code}？`)) return;
    await af(`/api/admin/invites/${code}`, { method: "DELETE" });
    load();
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
};

function ChatsTab() {
  const [users, setUsers] = useState(null);
  const [selUser, setSelUser] = useState(null); // {id, email, chatCount}
  const [chats, setChats] = useState(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  // 加载有过对话的用户列表
  useEffect(() => {
    af("/api/admin/users").then(r => r.json()).then(d => {
      const list = (d.users || []).filter(u => u.chatCount > 0).sort((a, b) => b.chatCount - a.chatCount);
      setUsers(list);
      if (list.length) setSelUser(list[0]);
    }).catch(() => setUsers([]));
  }, []);

  // 切用户时加载对话
  const loadChats = useCallback((uid, p) => {
    setChats(null);
    af(`/api/admin/chats?userId=${uid}&page=${p}`)
      .then(r => r.json())
      .then(d => { setChats(d.chats || []); setHasMore(d.hasMore || false); })
      .catch(() => setChats([]));
  }, []);

  useEffect(() => {
    if (selUser) { setPage(0); loadChats(selUser.id, 0); }
  }, [selUser, loadChats]);

  return (
    <div className="adm-chats-layout">
      {/* 左：用户列表 */}
      <aside className="adm-user-sidebar">
        <div className="adm-user-sidebar__title">用户（有对话）</div>
        {users === null && <div className="adm-empty" style={{ padding: "16px 12px" }}>加载中…</div>}
        {users && !users.length && <div className="adm-empty" style={{ padding: "16px 12px" }}>暂无对话用户</div>}
        {(users || []).map(u => (
          <button
            key={u.id}
            className={`adm-user-item ${selUser?.id === u.id ? "is-sel" : ""}`}
            onClick={() => setSelUser(u)}
          >
            <span className="adm-user-item__email">{u.email}</span>
            <span className="adm-user-item__count">{u.chatCount}</span>
          </button>
        ))}
      </aside>

      {/* 右：对话内容 */}
      <div className="adm-convo-panel">
        {!selUser && <div className="adm-empty" style={{ paddingTop: 60 }}>← 选择左侧用户查看对话</div>}

        {selUser && (
          <>
            <div className="adm-convo-header">
              <span className="adm-convo-header__email">{selUser.email}</span>
              <span className="adm-convo-header__count">共 {selUser.chatCount} 次对话</span>
            </div>

            {chats === null && <div className="adm-empty" style={{ paddingTop: 40 }}>加载中…</div>}

            {chats && !chats.length && <div className="adm-empty" style={{ paddingTop: 40 }}>暂无记录</div>}

            <div className="adm-convo-list">
              {(chats || []).map(c => (
                <div key={c.id} className={`adm-convo-card ${!c.ok ? "adm-convo-card--err" : ""}`}>
                  <div className="adm-convo-card__meta">
                    <span className="mono">{fmtDate(c.created_at)}</span>
                    <span className="adm-intent-tag">{INTENT_LABEL[c.intent] || c.intent || "—"}</span>
                    {c.latency_ms && <span className="adm-convo-card__lat">{(c.latency_ms / 1000).toFixed(1)}s</span>}
                    {!c.ok && <span className="adm-badge adm-badge--err">异常</span>}
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
                  <button className="adm-btn adm-btn--primary" onClick={() => { const p = page - 1; setPage(p); loadChats(selUser.id, p); }}>
                    上一页
                  </button>
                )}
                {hasMore && (
                  <button className="adm-btn adm-btn--primary" onClick={() => { const p = page + 1; setPage(p); loadChats(selUser.id, p); }}>
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

// ─── 主壳 ─────────────────────────────────────────────────
export default function Admin() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState("stats");

  useEffect(() => {
    if (!getToken()) { setChecking(false); return; }
    af("/api/admin/verify")
      .then(r => { if (r.ok) setAuthed(true); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="adm-gate"><div className="adm-empty">验证中…</div></div>;
  if (!authed) return <AdminLogin onLogin={() => setAuthed(true)} />;

  const tabs = [{ key: "stats", label: "概览" }, { key: "users", label: "用户" }, { key: "invites", label: "邀请码" }, { key: "chats", label: "对话记录" }];

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
        {tab === "invites" && <InvitesTab />}
        {tab === "chats" && <ChatsTab />}
      </main>
    </div>
  );
}
