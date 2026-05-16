const SESSION_STORAGE_KEY = "qdii-compass-chat-session";
const HISTORY_STORAGE_KEY = "qdii-compass-chat-history";
const SESSIONS_INDEX_KEY = "qdii-compass-chat-sessions-index";
const HISTORY_MAX_TURNS = 20;
const SESSIONS_MAX = 50;

const RECOMMENDED_QUESTIONS = {
  filter: [
    "找几只欧洲底仓基金，按观察分排序",
    "近 1 年涨幅最高的纳指基金",
    "申购费打折后最低的 5 只 QDII",
    "成立满 3 年的港股科技基金",
    "晨星 4 星以上的美国主动基金",
    "规模超过 30 亿的大盘宽基 QDII",
  ],
  compare: [
    "000614 和 513030 哪个更值得长期持有",
    "纳指 ETF 里挑 3 只对比一下",
  ],
  concept: [
    "QDII 限购是怎么回事",
    "跟踪误差是什么意思",
    "场内 ETF 溢价有什么风险",
    "夏普比率和最大回撤怎么看",
  ],
  event: [
    "最近美元兑人民币走势对纳指基金有啥影响",
    "纳指最近为什么跌",
    "美联储加息会怎么影响 QDII",
    "印度市场最近怎么样",
  ],
};

function pickRandomSuggestions(count = 6) {
  const groups = Object.values(RECOMMENDED_QUESTIONS);
  const picked = [];
  for (const g of groups) {
    picked.push(g[Math.floor(Math.random() * g.length)]);
  }
  const pool = groups.flat().filter((q) => !picked.includes(q));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  while (picked.length < count && pool.length) picked.push(pool.shift());
  return picked.slice(0, count);
}

const els = {
  panel: document.getElementById("chatPanel"),
  openBtn: document.getElementById("openChatBtn"),
  closeBtn: document.getElementById("closeChatBtn"),
  resetBtn: document.getElementById("chatResetBtn"),
  historyBtn: document.getElementById("chatHistoryBtn"),
  historyPanel: document.getElementById("chatHistoryPanel"),
  historyList: document.getElementById("chatHistoryList"),
  historyEmpty: document.getElementById("chatHistoryEmpty"),
  historyBack: document.getElementById("chatHistoryBack"),
  messages: document.getElementById("chatMessages"),
  form: document.getElementById("chatForm"),
  input: document.getElementById("chatInput"),
  submit: document.getElementById("chatSubmit"),
  attach: document.getElementById("chatAttach"),
};

let attachedFund = null;

if (!els.panel) {
  console.warn("chat panel not found, skip chat.js");
}

let sessionId = loadSessionId();
let busy = false;
let history = [];
let restored = false;
let startedInsideChatPanel = false;

function rememberChatInteractionStart(e) {
  const path = typeof e.composedPath === "function" ? e.composedPath() : null;
  startedInsideChatPanel = path ? path.includes(els.panel) : els.panel.contains(e.target);
}

function loadSessionId() {
  try {
    return localStorage.getItem(SESSION_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function saveSessionId(id) {
  try {
    if (id) localStorage.setItem(SESSION_STORAGE_KEY, id);
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function loadLocalHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.sessionId !== sessionId || !Array.isArray(parsed.turns)) return null;
    return parsed.turns;
  } catch {
    return null;
  }
}

function persistHistory() {
  try {
    if (!sessionId || !history.length) {
      localStorage.removeItem(HISTORY_STORAGE_KEY);
      return;
    }
    const trimmed = history.slice(-HISTORY_MAX_TURNS);
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ sessionId, turns: trimmed }));
  } catch {
    // ignore quota
  }
}

function clearLocalHistory() {
  try { localStorage.removeItem(HISTORY_STORAGE_KEY); } catch {}
}

function loadSessionsIndex() {
  try {
    const raw = localStorage.getItem(SESSIONS_INDEX_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveSessionsIndex(list) {
  try {
    const trimmed = (list || []).slice(0, SESSIONS_MAX);
    localStorage.setItem(SESSIONS_INDEX_KEY, JSON.stringify(trimmed));
  } catch {}
}

function formatSessionTitle(title) {
  const text = String(title || "新会话").trim().replace(/\s+/g, " ");
  if (!text) return "新会话";
  return text.length > 30 ? `${text.slice(0, 30)}...` : text;
}

function upsertSessionIndexFromHistory() {
  if (!sessionId || !history.length) return;
  const firstUser = history.find((t) => t.role === "user");
  const title = formatSessionTitle(firstUser?.content);
  const idx = loadSessionsIndex();
  const found = idx.find((s) => s.sessionId === sessionId);
  const now = Date.now();
  if (found) {
    found.title = title;
    found.updatedAt = now;
    found.count = history.length;
  } else {
    idx.unshift({ sessionId, title, updatedAt: now, count: history.length });
  }
  idx.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  saveSessionsIndex(idx);
}

function removeSessionFromIndex(sid) {
  const idx = loadSessionsIndex().filter((s) => s.sessionId !== sid);
  saveSessionsIndex(idx);
}

function relativeTime(ts) {
  if (!ts) return "";
  const now = Date.now();
  const t = typeof ts === "number" ? ts : new Date(ts).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, now - t);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + " 分钟前";
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + " 小时前";
  if (diff < 7 * 86_400_000) return Math.floor(diff / 86_400_000) + " 天前";
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function fetchRemoteSessions() {
  try {
    const headers = { accept: "application/json" };
    const token = window.qdiiCompass?.getAccessToken?.();
    if (!token) return [];
    headers.authorization = `Bearer ${token}`;
    const res = await fetch("/api/chat/sessions", { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.sessions) ? data.sessions : [];
  } catch {
    return [];
  }
}

function mergeSessions(local, remote) {
  const map = new Map();
  for (const s of local) map.set(s.sessionId, { ...s });
  for (const s of remote) {
    const cur = map.get(s.sessionId);
    const remoteUpdated = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
    if (!cur || (remoteUpdated && remoteUpdated > (cur.updatedAt || 0))) {
      map.set(s.sessionId, {
        sessionId: s.sessionId,
        title: s.title || cur?.title || "新会话",
        updatedAt: remoteUpdated || cur?.updatedAt || 0,
        count: s.count ?? cur?.count ?? 0,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

async function openHistoryPanel() {
  if (!els.historyPanel) return;
  els.messages.hidden = true;
  els.historyPanel.hidden = false;
  els.historyList.innerHTML = '<li class="chat-history__loading">加载中…</li>';
  const local = loadSessionsIndex();
  const remote = await fetchRemoteSessions();
  const merged = mergeSessions(local, remote);
  saveSessionsIndex(merged);
  renderSessionsList(merged);
}

function closeHistoryPanel() {
  if (!els.historyPanel) return;
  els.historyPanel.hidden = true;
  els.messages.hidden = false;
}

function renderSessionsList(list) {
  if (!list.length) {
    els.historyList.innerHTML = "";
    els.historyEmpty.hidden = false;
    return;
  }
  els.historyEmpty.hidden = true;
  els.historyList.innerHTML = list.map((s) => {
    const active = s.sessionId === sessionId ? " is-active" : "";
    const safeTitle = escapeHtml(formatSessionTitle(s.title));
    return `
      <li class="chat-history__item${active}" data-session="${s.sessionId}">
        <button class="chat-history__item-main" type="button" data-session="${s.sessionId}">
          <span class="chat-history__title">${safeTitle}</span>
          <span class="chat-history__meta">${relativeTime(s.updatedAt)} · ${s.count} 条</span>
        </button>
        <button class="chat-history__del" type="button" data-del="${s.sessionId}" title="删除">×</button>
      </li>
    `;
  }).join("");
}

async function switchToSession(targetSid) {
  if (!targetSid) return;
  sessionId = targetSid;
  saveSessionId(sessionId);
  history = [];
  restored = false;
  clearLocalHistory();
  els.messages.innerHTML = "";
  closeHistoryPanel();
  const remote = await fetchRemoteHistory(targetSid);
  if (remote && remote.length) {
    history = remote;
    history.forEach(renderTurn);
    persistHistory();
    upsertSessionIndexFromHistory();
  } else {
    showWelcome();
  }
  restored = true;
}

async function deleteSession(targetSid) {
  removeSessionFromIndex(targetSid);
  if (targetSid === sessionId) {
    resetSession();
  } else {
    // 仅刷新列表
    const merged = mergeSessions(loadSessionsIndex(), await fetchRemoteSessions());
    saveSessionsIndex(merged);
    renderSessionsList(merged);
  }
}

async function openChat(opts = {}) {
  const drawer = document.getElementById("drawer");
  if (!opts.keepDrawer && drawer && drawer.getAttribute("aria-hidden") === "false" && !drawer.classList.contains("drawer--from-chat")) {
    drawer.setAttribute("aria-hidden", "true");
    drawer.dataset.code = "";
  }
  els.panel.setAttribute("aria-hidden", "false");
  document.body.classList.add("chat-panel-open");
  setTimeout(() => els.input.focus(), 50);
  if (restored) return;
  restored = true;

  const local = loadLocalHistory();
  if (local && local.length) {
    history = local;
    history.forEach(renderTurn);
    return;
  }
  if (sessionId) {
    const remote = await fetchRemoteHistory(sessionId);
    if (remote && remote.length) {
      history = remote;
      history.forEach(renderTurn);
      persistHistory();
      return;
    }
  }
  showWelcome();
}

async function fetchRemoteHistory(sid) {
  try {
    const headers = { accept: "application/json" };
    const token = window.qdiiCompass?.getAccessToken?.();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`/api/chat/history?sessionId=${encodeURIComponent(sid)}`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.messages)) return null;
    return data.messages.map((m) => ({
      role: m.role,
      content: m.content,
      cards: Array.isArray(m.cards) ? m.cards : [],
      sources: Array.isArray(m.sources) ? m.sources : [],
      plan: m.plan || null,
    }));
  } catch {
    return null;
  }
}

function closeChat() {
  const chatDrawer = document.querySelector(".drawer.drawer--from-chat");
  if (chatDrawer) {
    chatDrawer.setAttribute("aria-hidden", "true");
    chatDrawer.classList.remove("drawer--from-chat");
    chatDrawer.dataset.code = "";
  }
  els.panel.setAttribute("aria-hidden", "true");
  document.body.classList.remove("chat-panel-open");
}

window.qdiiCompass = window.qdiiCompass || {};
window.qdiiCompass.closeChat = closeChat;
window.qdiiCompass.isChatOpen = () => els.panel?.getAttribute("aria-hidden") === "false";
window.qdiiCompass.askAboutFund = (code) => {
  if (!code) return;
  const fund = window.qdiiCompass?.getFund?.(code) || { code, name: code };
  attachedFund = fund;
  renderAttach();
  openChat({ keepDrawer: true });
  setTimeout(() => els.input.focus(), 80);
};

function fundChipHtml(fund, { removable = false } = {}) {
  const icon = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>`;
  const rm = removable
    ? `<button type="button" class="chat-chip__remove" aria-label="移除" title="移除">×</button>`
    : "";
  return `<span class="chat-fund-chip"${fund.code ? ` data-code="${fund.code}"` : ""}>${icon}<span class="chat-fund-chip__name">${escapeHtml(fund.name || fund.code)}</span>${rm}</span>`;
}

function renderAttach() {
  if (!els.attach) return;
  if (!attachedFund) {
    els.attach.hidden = true;
    els.attach.innerHTML = "";
    return;
  }
  els.attach.hidden = false;
  els.attach.innerHTML = fundChipHtml(attachedFund, { removable: true });
}

function clearAttach() {
  attachedFund = null;
  renderAttach();
}

// 用户消息渲染：还原"挂载基金"为小芯片（发送和历史回放统一走这里）
function renderUserContent(content) {
  const s = String(content || "");
  const m = s.match(/^(?:关于|介绍一下)\s*`(\d{6})\s+([^`]+)`(?:，)?\s*([\s\S]*)$/);
  if (m) {
    const fund = { code: m[1], name: m[2].trim() };
    const rest = m[3].trim();
    const chip = `<div class="chat-user-chip">${fundChipHtml(fund)}</div>`;
    return `${chip}${rest ? `<p>${escapeHtml(rest)}</p>` : ""}`;
  }
  return `<p>${escapeHtml(s)}</p>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtPct(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "--";
  return `${v > 0 ? "+" : ""}${Number(v).toFixed(2)}%`;
}

function pctClass(v) {
  if (v === null || v === undefined) return "";
  return v >= 0 ? "up" : "down";
}

function renderInlineCodes(text) {
  return escapeHtml(text).replace(/`(\d{6})\s*([^`]*?)`/g, (_, code, name) => {
    const label = escapeHtml(name.trim()) || code;
    return `<span class="chat-fund-ref" data-code="${code}" title="点击查看详情">${label}</span>`;
  });
}

function renderReplyText(text) {
  const safe = renderInlineCodes(text)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  return safe
    .split(/\n+/)
    .map((line) => {
      if (line.startsWith("・") || line.startsWith("- ")) {
        return `<li>${line.replace(/^[・\-]\s*/, "")}</li>`;
      }
      return `<p>${line}</p>`;
    })
    .reduce((acc, line) => {
      if (line.startsWith("<li>")) {
        if (acc.endsWith("</ul>")) return acc.slice(0, -5) + line + "</ul>";
        return acc + "<ul>" + line + "</ul>";
      }
      return acc + line;
    }, "");
}

function buildCardByCode(cards) {
  const cardByCode = new Map();
  for (const c of cards || []) {
    cardByCode.set(c.code, c);
    for (const alt of c.altShares || []) {
      cardByCode.set(alt.code, c);
    }
  }
  return cardByCode;
}

function formatLimitYuan(yuan) {
  if (yuan === null || yuan === undefined) return null;
  if (yuan >= 1e8) return `${(yuan / 1e8).toFixed(yuan % 1e8 === 0 ? 0 : 1)}亿`;
  if (yuan >= 1e4) return `${(yuan / 1e4).toFixed(yuan % 1e4 === 0 ? 0 : 1)}万`;
  return `${yuan}元`;
}

function purchaseStatusHtml(card) {
  const ps = card.purchaseStatus;
  if (!ps || ps === "场内交易") return "";
  if (ps === "限购") {
    const lim = formatLimitYuan(card.purchaseLimitYuan);
    const text = lim ? `限购 ${lim}/日` : "大额限购";
    return `<div class="chat-card__status chat-card__status--limit"><span class="chat-card__status-dot"></span>${text}</div>`;
  }
  if (ps === "开放") {
    return `<div class="chat-card__status chat-card__status--open"><span class="chat-card__status-dot"></span>可申购</div>`;
  }
  if (ps === "暂停" || ps === "封闭") {
    return `<div class="chat-card__status chat-card__status--unavail"><span class="chat-card__status-dot"></span>暂停申购</div>`;
  }
  return "";
}

function altSharesFootnoteHtml(altShares) {
  if (!altShares?.length) return "";
  const parts = altShares.map((alt) => {
    const hint = alt.retailHard
      ? "多数 App 不代销"
      : alt.purchaseStatus === "限购"
        ? `限购 ${formatLimitYuan(alt.purchaseLimitYuan) || "大额"}`
        : "";
    const hintPart = hint ? `（${hint}）` : "";
    return `${escapeHtml(alt.shareLabel || "其他份额")} <span class="linkish" data-code="${alt.code}" role="button" tabindex="0">${alt.code}</span>${hintPart}`;
  });
  return `<p class="chat-card__footnote">同基金另有 ${parts.join("；")}，持仓相同。普通人民币申购看本卡即可。</p>`;
}

function renderReplyWithCards(text, cards) {
  const cardByCode = buildCardByCode(cards);
  const safe = renderInlineCodes(text).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  const blocks = safe.split(/\n+/).filter((l) => l.trim()).map((line) =>
    line.startsWith("・") || line.startsWith("- ")
      ? { type: "li", html: line.replace(/^[・\-]\s*/, "") }
      : { type: "p", html: line }
  );
  const shown = new Set();
  let out = "";
  let pending = [];

  const flushText = () => {
    if (!pending.length) return;
    let buf = "";
    for (const b of pending) {
      if (b.type === "li") {
        if (buf.endsWith("</ul>")) buf = buf.slice(0, -5) + `<li>${b.html}</li></ul>`;
        else buf += `<ul><li>${b.html}</li></ul>`;
      } else {
        buf += `<p>${b.html}</p>`;
      }
    }
    out += buf;
    pending = [];
  };

  for (const blk of blocks) {
    pending.push(blk);
    const codes = [];
    const re = /(\d{6})/g;
    let m;
    while ((m = re.exec(blk.html))) {
      if (cardByCode.has(m[1]) && !shown.has(m[1]) && !codes.includes(m[1])) codes.push(m[1]);
    }
    if (codes.length) {
      flushText();
      for (const code of codes) {
        const card = cardByCode.get(code);
        if (!card || shown.has(card.code)) continue;
        out += cardHtml(card);
        shown.add(card.code);
      }
    }
  }
  flushText();

  const rest = (cards || []).filter((c) => !shown.has(c.code));
  if (rest.length) out += `<div class="chat-cards">${rest.map((c) => cardHtml(c)).join("")}</div>`;
  return out;
}

function cardHtml(card, animDelayMs = 0) {
  const delayAttr = animDelayMs > 0 ? ` style="animation-delay:${animDelayMs}ms"` : "";
  const status = purchaseStatusHtml(card);
  const footnote = altSharesFootnoteHtml(card.altShares);
  return `
    <button class="chat-card" type="button" data-code="${card.code}" title="查看详情"${delayAttr}>
      ${status}
      <div class="chat-card__head">
        <strong>${escapeHtml(card.name)}</strong>
        <span>${card.code}</span>
      </div>
      <div class="chat-card__chips">
        <span>${escapeHtml(card.region || "?")}</span>
        <span>${escapeHtml(card.theme || "?")}</span>
        <span>${escapeHtml(card.role || "?")}</span>
      </div>
      <div class="chat-card__metrics">
        <div><span>近3月</span><strong class="${pctClass(card.return3m)}">${fmtPct(card.return3m)}</strong></div>
        <div><span>近1年</span><strong class="${pctClass(card.return1y)}">${fmtPct(card.return1y)}</strong></div>
        <div><span>今年</span><strong class="${pctClass(card.returnYtd)}">${fmtPct(card.returnYtd)}</strong></div>
        <div><span>观察分</span><strong>${card.score ?? "--"}</strong></div>
      </div>
      ${footnote}
    </button>
  `;
}

function sourcesHtml(sources) {
  if (!sources || !sources.length) return "";
  const items = sources.slice(0, 5).map((s, i) => {
    const title = escapeHtml(s.title || s.url || `来源 ${i + 1}`);
    const url = escapeHtml(s.url || "#");
    return `<li><a href="${url}" target="_blank" rel="noreferrer">[${i + 1}] ${title}</a></li>`;
  }).join("");
  return `<details class="chat-sources"><summary>引用 ${sources.length} 条来源</summary><ol>${items}</ol></details>`;
}

function appendMessage(role, html, extraClass = "") {
  const wrap = document.createElement("div");
  wrap.className = `chat-bubble chat-bubble--${role} ${extraClass}`.trim();
  wrap.innerHTML = html;
  els.messages.appendChild(wrap);
  els.messages.scrollTop = els.messages.scrollHeight;
  return wrap;
}

function removeWelcomePrompt() {
  els.messages.querySelector(".chat-welcome")?.remove();
}

function buildAssistantHtml({ content, cards = [], sources = [], plan = null, showExtras = true }) {
  const intentTag = plan?.intent ? `<span class="chat-intent-tag" title="本轮识别意图">${plan.intent}</span>` : "";
  if (!showExtras || !cards || !cards.length) {
    const replyHtml = content ? `<div class="chat-reply">${renderReplyText(content)}</div>` : "";
    return `${intentTag}${replyHtml}`;
  }
  const replyHtml = content ? `<div class="chat-reply">${renderReplyWithCards(content, cards)}</div>` : "";
  return `${intentTag}${replyHtml}`;
}

function renderTurn(turn) {
  if (turn.role === "user") {
    appendMessage("user", renderUserContent(turn.content));
  } else if (turn.role === "assistant") {
    appendMessage("assistant", buildAssistantHtml(turn));
  } else if (turn.role === "system") {
    appendMessage("system", turn.content);
  }
}

function showWelcome() {
  const items = pickRandomSuggestions(6);
  const chips = items
    .map((q) => `<button class="chat-suggestion" type="button" data-question="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
    .join("");
  appendMessage(
    "system",
    `<p>你好，我是 QDII 基金 AI 投顾。可以从下面选个问题开始，或在底部输入框自由提问：</p>
     <div class="chat-suggestions">${chips}</div>`,
    "chat-welcome"
  );
}

function setBusy(state) {
  busy = state;
  els.submit.disabled = state;
  els.input.disabled = state;
  els.submit.innerHTML = state
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="4" cy="12" r="2"><animate attributeName="opacity" values="1;0.3;1" dur="1s" begin="0s" repeatCount="indefinite"/></circle><circle cx="12" cy="12" r="2"><animate attributeName="opacity" values="1;0.3;1" dur="1s" begin="0.3s" repeatCount="indefinite"/></circle><circle cx="20" cy="12" r="2"><animate attributeName="opacity" values="1;0.3;1" dur="1s" begin="0.6s" repeatCount="indefinite"/></circle></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
}

function parseSseStream(text, offset, onEvent) {
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
    try {
      onEvent(eventName, JSON.parse(dataStr));
    } catch {
      // 忽略
    }
  }
}

async function sendMessage(text) {
  if (busy || !text) return;
  setBusy(true);
  removeWelcomePrompt();
  appendMessage("user", renderUserContent(text));
  const bubble = appendMessage("assistant", `<p class="chat-typing">正在思考…</p>`, "is-typing");
  history.push({ role: "user", content: text });
  persistHistory();

  let cards = [];
  let sources = [];
  let plan = null;
  let replyAccum = "";
  let finalReply = "";
  let streamComplete = false;

  function renderStreaming() {
    const replyText = finalReply || replyAccum;
    if (!replyText) {
      bubble.innerHTML = `<p class="chat-typing">正在思考…</p>`;
      return;
    }
    bubble.innerHTML = buildAssistantHtml({
      content: replyText,
      cards: [],
      sources: [],
      plan,
      showExtras: false,
    });
  }

  try {
    const res = await fetch("/api/chat?stream=1", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ message: text, sessionId }),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let offset = 0;
    bubble.classList.remove("is-typing");

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      offset = parseSseStream(buffer, offset, (event, data) => {
        if (event === "session") {
          if (data.sessionId) {
            sessionId = data.sessionId;
            saveSessionId(sessionId);
          }
        } else if (event === "plan") {
          plan = data;
          if (replyAccum || finalReply) renderStreaming();
        } else if (event === "cards") {
          cards = Array.isArray(data) ? data : [];
        } else if (event === "sources") {
          sources = Array.isArray(data) ? data : [];
        } else if (event === "delta") {
          replyAccum += data?.text || "";
          renderStreaming();
          els.messages.scrollTop = els.messages.scrollHeight;
        } else if (event === "final") {
          finalReply = data?.reply || replyAccum;
          streamComplete = true;
          bubble.innerHTML = buildAssistantHtml({ content: finalReply, cards, sources, plan, showExtras: true });
          els.messages.scrollTop = els.messages.scrollHeight;
        } else if (event === "error") {
          throw new Error(data?.message || "服务端错误");
        }
      });
    }
    if (!streamComplete && (finalReply || replyAccum)) {
      finalReply = finalReply || replyAccum;
      bubble.innerHTML = buildAssistantHtml({ content: finalReply, cards, sources, plan, showExtras: true });
      els.messages.scrollTop = els.messages.scrollHeight;
    }
    history.push({
      role: "assistant",
      content: finalReply || replyAccum,
      cards,
      sources,
      plan,
    });
    persistHistory();
    upsertSessionIndexFromHistory();
  } catch (err) {
    bubble.classList.remove("is-typing");
    bubble.classList.add("chat-bubble--error");
    bubble.innerHTML = `<p>出错了：${escapeHtml(err.message)}</p>
      <button class="button small" type="button" data-retry="${escapeHtml(text)}">重试</button>`;
  } finally {
    setBusy(false);
  }
}

function resetSession() {
  sessionId = null;
  history = [];
  restored = true;
  saveSessionId(null);
  clearLocalHistory();
  closeHistoryPanel();
  els.messages.innerHTML = "";
  showWelcome();
  clearAttach();
  window.qdiiCompass?.closeDrawer?.();
}

function autosizeTextarea() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 140) + "px";
}

if (els.panel) {
  els.openBtn?.addEventListener("click", openChat);
  els.closeBtn?.addEventListener("click", closeChat);
  els.panel.addEventListener("click", (e) => e.stopPropagation());

  document.addEventListener("pointerdown", rememberChatInteractionStart, true);
  document.addEventListener("touchstart", rememberChatInteractionStart, true);
  document.addEventListener("mousedown", rememberChatInteractionStart, true);

  document.addEventListener("click", (e) => {
    if (els.panel.getAttribute("aria-hidden") !== "false") return;
    if (startedInsideChatPanel) {
      startedInsideChatPanel = false;
      return;
    }
    const path = typeof e.composedPath === "function" ? e.composedPath() : null;
    const clickedInsidePanel = path ? path.includes(els.panel) : els.panel.contains(e.target);
    const clickedOpenButton = path ? path.includes(els.openBtn) : els.openBtn?.contains(e.target);
    if (clickedInsidePanel || clickedOpenButton) return;
    const fromChatDrawer = document.querySelector(".drawer.drawer--from-chat");
    const clickedChatDrawer = path ? path.includes(fromChatDrawer) : fromChatDrawer?.contains(e.target);
    if (clickedChatDrawer) return;
    closeChat();
  });
  els.resetBtn?.addEventListener("click", resetSession);
  els.historyBtn?.addEventListener("click", () => {
    if (els.historyPanel.hidden) openHistoryPanel(); else closeHistoryPanel();
  });
  els.historyBack?.addEventListener("click", closeHistoryPanel);
  els.historyList?.addEventListener("click", (e) => {
    const delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      e.stopPropagation();
      const sid = delBtn.dataset.del;
      if (sid && confirm("删除这条历史会话？")) deleteSession(sid);
      return;
    }
    const itemBtn = e.target.closest("[data-session]");
    if (itemBtn) {
      const sid = itemBtn.dataset.session;
      if (sid && sid !== sessionId) switchToSession(sid);
      else closeHistoryPanel();
    }
  });

  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text && !attachedFund) return;
    const fund = attachedFund;
    els.input.value = "";
    autosizeTextarea();
    let sendText = text;
    if (fund) {
      const ref = `\`${fund.code} ${fund.name}\``;
      sendText = text ? `关于 ${ref}，${text}` : `介绍一下 ${ref}`;
    }
    clearAttach();
    sendMessage(sendText);
  });

  els.attach?.addEventListener("click", (e) => {
    if (e.target.closest(".chat-chip__remove")) clearAttach();
  });

  els.input.addEventListener("input", autosizeTextarea);
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      els.form.requestSubmit();
    }
  });

  els.messages.addEventListener("click", (e) => {
    const linkish = e.target.closest(".linkish[data-code]");
    if (linkish) {
      e.preventDefault();
      e.stopPropagation();
      const code = linkish.dataset.code;
      const open = window.qdiiCompass?.showChatDetail || window.qdiiCompass?.showDetail;
      if (code && open) open(code);
      return;
    }
    const codeTarget = e.target.closest("[data-code]");
    if (codeTarget) {
      const code = codeTarget.dataset.code;
      const open = window.qdiiCompass?.showChatDetail || window.qdiiCompass?.showDetail;
      if (code && open) {
        // 高亮选中的卡片
        els.messages.querySelectorAll(".chat-card.is-selected").forEach((el) => el.classList.remove("is-selected"));
        const card = codeTarget.closest(".chat-card");
        if (card) card.classList.add("is-selected");
        open(code);
      }
      return;
    }
    const suggBtn = e.target.closest("[data-question]");
    if (suggBtn) {
      e.stopPropagation();
      const q = suggBtn.dataset.question;
      if (q && !busy) sendMessage(q);
      return;
    }
    const retryBtn = e.target.closest("[data-retry]");
    if (retryBtn) {
      const text = retryBtn.dataset.retry;
      retryBtn.parentElement.remove();
      sendMessage(text);
    }
  });
}
