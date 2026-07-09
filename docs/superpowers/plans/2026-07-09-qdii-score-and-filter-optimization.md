# QDII 罗盘：筛选多选 + 同类内评分 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 热门筛选增加"标普500"并支持多选（主题并集+条件交集）；评分改为同主题内排名并去掉重复计权；列表合并同基金多份额；AI 点评标注生成时间。

**Architecture:** 前端筛选逻辑在 `App.jsx` 内存过滤，改 chip 状态从单值到 Set；评分在 `lib/eastmoney.mjs` 的 `computeRawScore` + `applyPercentileScores`，服务器每次读库时实时重算（**改公式无需重刷数据，重启即生效**）；份额合并复用已有的 `lib/agent/shareClass.mjs`，在 `server.mjs` 列表响应处套用。

**Tech Stack:** React 18 + Vite（前端），Node 原生 HTTP（后端），`node --test` 写纯函数单测（项目原本无测试套件，本计划新建 `tests/` 目录）。

## Global Constraints

- 项目无 linter、无既有测试框架；纯函数用 `node --test`，UI 改动用 `npm run build && npm start` 浏览器实测
- 改 `frontend/` 后必须 `npm run build` 才会反映到 `public/`；**禁止手编 `public/`**
- UI 文案一律中文；DB `snake_case`、JS `camelCase`，转换只在 `lib/store.mjs`
- 本计划**不改数据库表结构**，不新增抓取脚本
- 每个 Task 结束单独 commit，消息格式沿用仓库惯例（`feat:` / `fix:` 中文描述）

---

### Task 1: 标普500 标签 + 多选筛选（主题并集、条件交集）

**Files:**
- Modify: `frontend/src/data.js:197-205`（QUICK_CHIPS）
- Modify: `frontend/src/components.jsx:271-286`（QuickChips 组件）
- Modify: `frontend/src/App.jsx:81`、`App.jsx:155-159`（埋点）、`App.jsx:232-242`（过滤逻辑）、`App.jsx:268`（传参）

**Interfaces:**
- Produces: `QUICK_CHIPS` 每项新增 `kind: "union" | "and"` 字段；`App.jsx` 状态 `activeChips` 为 `Set<string>`；`QuickChips` 组件 props `active`（Set）、`setActive`（setState 函数）

**分组约定（已与用户确认）：** 主题类（美股科技/纳指100/标普500/港股科技/黄金主题）之间取**并集**；条件类（进攻型/晨星5★/可申购）与前者取**交集**。

- [ ] **Step 1: 修改 QUICK_CHIPS，加标普500 与 kind 字段**

`frontend/src/data.js` 中把整个 `QUICK_CHIPS` 替换为：

```js
const QUICK_CHIPS = [
  { id: "us-tech",   label: "美股科技",   kind: "union", region: "美国",  theme: "科技成长" },
  { id: "nasdaq100", label: "纳指100",    kind: "union", keyword: "纳指" },
  { id: "sp500",     label: "标普500",    kind: "union", keyword: "标普" },
  { id: "hk-tech",   label: "港股科技",   kind: "union", region: "港股",  theme: "科技成长" },
  { id: "gold",      label: "黄金主题",   kind: "union", theme: "贵金属" },
  { id: "attack",    label: "进攻型",     kind: "and",   role: "进攻仓" },
  { id: "fivestar",  label: "晨星 5★",   kind: "and",   rating: 5 },
  { id: "buyable",   label: "可申购",     kind: "and",   status: "open" },
];
```

（"标普500"用名称关键词"标普"匹配，与"纳指100"同一套路。）

- [ ] **Step 2: QuickChips 组件支持多选**

`frontend/src/components.jsx` 的 `QuickChips` 整个函数替换为：

```jsx
function QuickChips({ active, setActive }) {
  const toggle = (id) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  return (
    <div className="chips-row">
      <span className="chips-row__label">热门筛选</span>
      {QUICK_CHIPS.map((c) => (
        <button
          key={c.id}
          className={`qchip ${active.has(c.id) ? "is-on" : ""}`}
          onClick={() => toggle(c.id)}
        >
          <span className="qchip__dot"/>{c.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: App.jsx 改状态、埋点、过滤逻辑**

`frontend/src/App.jsx:81` 状态改为：

```jsx
const [activeChips, setActiveChips] = useState(() => new Set());
```

`App.jsx:155-159` 埋点 effect 替换为：

```jsx
useEffect(() => {
  if (!activeChips.size) return;
  const labels = QUICK_CHIPS.filter((c) => activeChips.has(c.id)).map((c) => c.label);
  track("filter", { label: labels.join("+") });
}, [activeChips]);
```

`App.jsx:232-242` 过滤块替换为：

```jsx
if (activeChips.size) {
  const chips = QUICK_CHIPS.filter((c) => activeChips.has(c.id));
  const matchChip = (chip, f) =>
    (chip.region  ? f.region === chip.region   : true) &&
    (chip.theme   ? f.theme === chip.theme     : true) &&
    (chip.role    ? f.role === chip.role       : true) &&
    (chip.rating  ? f.rating === chip.rating   : true) &&
    (chip.status  ? f.status === chip.status   : true) &&
    (chip.keyword ? f.name.includes(chip.keyword) : true);
  const unionChips = chips.filter((c) => c.kind === "union");
  const andChips = chips.filter((c) => c.kind === "and");
  if (unionChips.length) funds = funds.filter((f) => unionChips.some((c) => matchChip(c, f)));
  for (const c of andChips) funds = funds.filter((f) => matchChip(c, f));
}
```

`App.jsx:268` 传参改为：

```jsx
<QuickChips active={activeChips} setActive={setActiveChips}/>
```

- [ ] **Step 4: 构建并浏览器验证**

Run: `npm run build && npm start`，浏览器打开 http://localhost:5173 检查：
1. 出现"标普500"标签，点击后列表只剩名字含"标普"的基金
2. 同时点亮"纳指100"+"标普500" → 列表 = 两者之和（并集，数量应大于单选任一个）
3. 再点亮"可申购" → 数量只减不增（交集生效）
4. 再次点击已点亮标签可取消；全部取消恢复全量

- [ ] **Step 5: Commit**

```bash
git add frontend/src/data.js frontend/src/components.jsx frontend/src/App.jsx public/
git commit -m "feat: 热门筛选新增标普500，支持多选（主题并集+条件交集）"
```

---

### Task 2: 评分公式去重复计权、删品类偏好分

**Files:**
- Modify: `lib/eastmoney.mjs:55-72`（computeRawScore）
- Create: `tests/score.test.mjs`

**Interfaces:**
- Produces: `annualizedReturn3y(r3y)`（导出，输入三年累计涨幅百分数，返回年化百分数或 null）；`computeRawScore(fund)` 签名不变，但只用 `return6m / return1y / 三年年化` 三段不重叠收益，删除 1 年二次加分和"美国宽基/底仓候选 +4"

**公式变更清单（口径，测试据此写）：**
- 收益段：`[return6m, return1y, annualized(return3y)]` 取均值 + 正收益段计数，替代原五段
- 删除：`raw += fund.return1y / 8`（1 年二次计权）
- 删除：`if (fund.theme === "美国宽基" || fund.role === "底仓候选") raw += 4`（写死的品类偏好）
- 保留：近3月大跌扣分、次新扣分、高风险扣分、费率加减分（费率真实影响持有成本）

- [ ] **Step 1: 写失败测试**

创建 `tests/score.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import { computeRawScore, annualizedReturn3y } from "../lib/eastmoney.mjs";

const base = {
  return3m: 5, return6m: 10, return1y: 20, returnYtd: 8, return3y: 33.1,
  ageYears: 5, risk: "中高", theme: "科技成长", role: "卫星配置", discountFee: null,
};

test("三年收益做年化：33.1% 累计 ≈ 10% 年化", () => {
  assert.ok(Math.abs(annualizedReturn3y(33.1) - 10) < 0.1);
  assert.equal(annualizedReturn3y(null), null);
});

test("删除品类偏好：美国宽基/底仓候选不再额外加分", () => {
  const wide = { ...base, theme: "美国宽基", role: "底仓候选" };
  assert.equal(computeRawScore(wide), computeRawScore(base));
});

test("重叠周期不再参与均值：改 returnYtd/return3m 不影响均值部分", () => {
  // return3m 仅在 < -8 时作为惩罚项，5 → 6 不应改变分数；returnYtd 完全退出公式
  const noisy = { ...base, returnYtd: 999, return3m: 6 };
  assert.equal(computeRawScore(noisy), computeRawScore(base));
});

test("1 年收益不再二次计权：单独拉高 return1y 只通过均值影响分数", () => {
  const a = computeRawScore(base);
  const b = computeRawScore({ ...base, return1y: 28 }); // +8 个点，只走均值：+8/3/2.8
  assert.ok(Math.abs((b - a) - 8 / 3 / 2.8) < 0.01);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/score.test.mjs`
Expected: FAIL（`annualizedReturn3y` 未导出；品类偏好断言不等）

- [ ] **Step 3: 改 computeRawScore**

`lib/eastmoney.mjs:55-72` 替换为：

```js
export function annualizedReturn3y(r3y) {
  if (r3y === null || r3y === undefined || !Number.isFinite(r3y)) return null;
  const total = 1 + r3y / 100;
  if (total <= 0) return -100;
  return (Math.cbrt(total) - 1) * 100;
}

export function computeRawScore(fund) {
  const values = [fund.return6m, fund.return1y, annualizedReturn3y(fund.return3y)]
    .filter((value) => value !== null && value !== undefined && Number.isFinite(value));
  const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const positiveCount = values.filter((value) => value > 0).length;

  let raw = 50;
  raw += avg / 2.8;
  raw += positiveCount * 3;
  if (fund.return3m !== null && fund.return3m < -8) raw -= 8;
  if (fund.ageYears !== null && fund.ageYears < 1) raw -= 8;
  if (fund.risk === "高") raw -= 4;
  if (fund.discountFee !== null && fund.discountFee <= 0.15) raw += 3;
  if (fund.discountFee !== null && fund.discountFee >= 1) raw -= 3;
  return raw;
}
```

（原五段收益数组、`raw += fund.return1y / 8`、美国宽基/底仓候选 +4 三处删除；其余惩罚/费率项原样保留。）

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/score.test.mjs`
Expected: PASS（4 项全过）

- [ ] **Step 5: Commit**

```bash
git add lib/eastmoney.mjs tests/score.test.mjs
git commit -m "fix: 评分公式去重复计权（收益段去重、删1年二次加分与品类偏好分）"
```

---

### Task 3: 百分位改同主题分组 + 同类排名字段

**Files:**
- Modify: `lib/eastmoney.mjs:78-99`（applyPercentileScores）、`lib/eastmoney.mjs:1048`（regionRankScore 改用 rawScore）
- Modify: `lib/agent/tools.mjs:150-151` 附近（卡片 payload 加 peer 字段）
- Modify: `frontend/src/components.jsx:1441` 附近与 `:2004-2007`（聊天卡片"观察分"改"同类排名"）
- Modify: `CLAUDE.md`（评分口径说明一行）
- Test: `tests/score.test.mjs`（追加用例）

**Interfaces:**
- Produces: `applyPercentileScores(funds)` 签名不变；每个 fund 新增 `peerRank`（同主题内第几名，1=最好）、`peerCount`（同主题总数）；`score` 变为**同主题内**百分位；`label` 在同主题不足 6 只时为 `"同类样本少"`
- Consumes: Task 2 的 `computeRawScore`

- [ ] **Step 1: 追加失败测试**

`tests/score.test.mjs` 末尾追加：

```js
import { applyPercentileScores } from "../lib/eastmoney.mjs";

function mk(theme, rawScore, code) {
  return { code, theme, rawScore };
}

test("百分位在同主题内计算，附带同类排名", () => {
  const funds = [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => mk("科技成长", i * 10, `A${i}`)),
    mk("债券收益", 5, "B1"),
    mk("债券收益", 99, "B2"),
  ];
  applyPercentileScores(funds);
  const topA = funds.find((f) => f.code === "A8");
  assert.equal(topA.score, 100);
  assert.equal(topA.label, "高关注");
  assert.equal(topA.peerRank, 1);
  assert.equal(topA.peerCount, 8);
  // 债券组只有 2 只：样本少，不给高关注标签
  const topB = funds.find((f) => f.code === "B2");
  assert.equal(topB.label, "同类样本少");
  assert.equal(topB.peerCount, 2);
  // 债券组第一名不再被科技组高分挤到低百分位（这是本次要修的核心问题）
  assert.equal(topB.peerRank, 1);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/score.test.mjs`
Expected: FAIL（peerRank undefined / label 不符）

- [ ] **Step 3: 重写 applyPercentileScores**

`lib/eastmoney.mjs:78-99` 替换为：

```js
export function applyPercentileScores(funds) {
  if (!funds.length) return funds;
  for (const f of funds) {
    if (!Number.isFinite(f.rawScore)) f.rawScore = computeRawScore(f);
  }
  const groups = new Map();
  for (const f of funds) {
    const key = f.theme || "综合配置";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.rawScore - b.rawScore);
    const total = sorted.length;
    let i = 0;
    while (i < total) {
      let j = i;
      while (j < total && sorted[j].rawScore === sorted[i].rawScore) j++;
      const avgRank = (i + j - 1) / 2;
      const percentile = total === 1 ? 50 : Math.round((avgRank / (total - 1)) * 100);
      const label = total < 6
        ? "同类样本少"
        : percentile >= 90 ? "高关注" : percentile >= 60 ? "可观察" : "谨慎看待";
      const rankFromTop = Math.max(1, Math.round(total - avgRank));
      for (let k = i; k < j; k++) {
        sorted[k].score = percentile;
        sorted[k].label = label;
        sorted[k].peerRank = rankFromTop;
        sorted[k].peerCount = total;
      }
      i = j;
    }
  }
  return funds;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/score.test.mjs`
Expected: PASS（含 Task 2 的 4 项共 5 项）

- [ ] **Step 5: 详情结构化分析的地区排名改用 rawScore**

`score` 现在是主题内相对值，跨主题聚合它没有意义。`lib/eastmoney.mjs:1048`：

```js
const regionRankScore = percentileRank(sameRegion, "score", fund.score);
```

改为：

```js
const regionRankScore = percentileRank(sameRegion, "rawScore", fund.rawScore);
```

- [ ] **Step 6: 聊天卡片透出同类排名**

`lib/agent/tools.mjs:150-151`（`score: fund.score,` / `scoreLabel: fund.label,` 处）追加两行：

```js
    peerRank: fund.peerRank ?? null,
    peerCount: fund.peerCount ?? null,
```

`frontend/src/components.jsx:1441`（`score: c.score ?? "--",`）后追加：

```js
    peerRank: c.peerRank ?? null,
    peerCount: c.peerCount ?? null,
```

`frontend/src/components.jsx:2004-2007` 的"观察分"格子替换为：

```jsx
        <div className="ai-fcard__cell">
          <span>{f.peerRank && f.peerCount ? "同类排名" : "观察分"}</span>
          <strong className="mono">{f.peerRank && f.peerCount ? `${f.peerRank}/${f.peerCount}` : f.score}</strong>
        </div>
```

- [ ] **Step 7: 更新 CLAUDE.md 评分口径说明**

`CLAUDE.md` 中 `classifyFund(name) 是纯字符串关键词规则…` 那一段末尾追加一句：

```
评分自 v1.7 起为**同主题内**百分位（`applyPercentileScores` 按 `theme` 分组，附 `peerRank`/`peerCount`；不足 6 只标"同类样本少"），且服务读库时实时重算，改公式重启即生效、无需重刷数据。
```

- [ ] **Step 8: 构建 + 冒烟验证**

Run: `npm run build && npm start`
1. 浏览器打开任一基金详情抽屉，确认结构化分析正常渲染（无报错、同类对比区数字合理）
2. 登录后打开聊天，问"筛选几只美股科技基金"，卡片"同类排名"显示 `N/M` 格式
3. 若配置了 .env，跑 `npm run agent:test` 确认聊天用例无回归（失败则修复后再提交）

- [ ] **Step 9: Commit**

```bash
git add lib/eastmoney.mjs lib/agent/tools.mjs frontend/src/components.jsx tests/score.test.mjs CLAUDE.md public/
git commit -m "feat: 评分改同主题内百分位，聊天卡片展示同类排名，小样本主题标注样本少"
```

---

### Task 4: 列表合并同基金多份额

**Files:**
- Modify: `server.mjs`（import + `loadOrRefresh` 三个 return 点，约 299-330 行）
- Modify: `frontend/src/components.jsx:342-348`（卡片 tags 下加份额备注）
- Modify: `frontend/src/compass.css`（`.fcard__alts` 样式）

**Interfaces:**
- Consumes: `lib/agent/shareClass.mjs` 已导出的 `mergeShareClassCards(cards)`（按归一化基金名分组，主份额出卡、其余进 `altShares: [{code, name, shareLabel, ...}]`）
- Produces: `/api/funds` 返回的 `funds` 为合并后列表（`total` 同步为合并后数量）；**内存快照 `rememberFundsSnapshot` 仍存全量**，详情同类对比与聊天 Agent 不受影响

**已知取舍（不在本任务解决）：** 用户若收藏的是被折叠的副份额（如 C 类），"只看自选"里该基金以主份额卡片形式不出现。主卡上会显示副份额备注，影响可接受；如后续反馈强烈再单独处理。

- [ ] **Step 1: server.mjs 引入并在三个 return 点合并**

`server.mjs` 顶部 import 区追加：

```js
import { mergeShareClassCards } from "./lib/agent/shareClass.mjs";
```

`loadOrRefresh` 内（约 299-330 行）三处 return 全部改为先合并再返回，**注意 `rememberFundsSnapshot(withAi)` 保持在合并之前、传全量**：

refresh 分支：

```js
    const withAi = await attachAiSummaries(snapshot.funds);
    rememberFundsSnapshot(withAi);
    const merged = mergeShareClassCards(withAi);
    const lastUpdated = await getLastUpdatedAt();
    const { fetchedAt, fetchedAtText } = formatDataUpdateDisplay(lastUpdated);
    return { ...snapshot, funds: merged, total: merged.length, fetchedAt, fetchedAtText };
```

DB 命中分支：

```js
    applyPercentileScores(funds);
    const [withAi, lastUpdated] = await Promise.all([attachAiSummaries(funds), getLastUpdatedAt()]);
    rememberFundsSnapshot(withAi);
    const merged = mergeShareClassCards(withAi);
    const { fetchedAt, fetchedAtText } = formatDataUpdateDisplay(lastUpdated);
    return {
      fetchedAt,
      fetchedAtText,
      total: merged.length,
      funds: merged,
    };
```

兜底 refresh 分支（约 321-330 行）：同 refresh 分支一样，在 `rememberFundsSnapshot(withAi)` 之后加 `const merged = mergeShareClassCards(withAi);`，return 里 `funds: merged, total: merged.length`。

- [ ] **Step 2: 卡片显示副份额备注**

`frontend/src/components.jsx` FundCard 的 `</div>`（`fcard__tags` 结束，348 行）之后插入：

```jsx
      {Array.isArray(fund.altShares) && fund.altShares.length > 0 && (
        <div className="fcard__alts">
          另有{fund.altShares.map((a) => ` ${a.shareLabel}(${a.code})`).join(" /")}
        </div>
      )}
```

（`normalizeFund` 用 `...f` 展开，`altShares` 自动透传，无需改 App.jsx。）

- [ ] **Step 3: 样式**

`frontend/src/compass.css` 中 `.fcard__tags` 相关规则附近追加：

```css
.fcard__alts {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-3, #8a8f98);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: 构建 + 验证**

Run: `npm run build && npm start`
1. 首页找一只有 A/C 类的基金（搜索"纳斯达克100"），确认同系列只出一张主卡，卡上出现"另有 人民币 C 份额(xxxxxx)"备注
2. 列表总数比合并前减少（对比 git stash 前后或看 `/api/funds` 的 `total`）
3. 打开该基金详情抽屉，同类对比正常（快照仍是全量）
4. 注意浏览器有 7 天列表缓存（`fundsCache.js`），验证时硬刷新或清 localStorage

- [ ] **Step 5: Commit**

```bash
git add server.mjs frontend/src/components.jsx frontend/src/compass.css public/
git commit -m "feat: 列表合并同基金多份额，主卡展示副份额备注"
```

---

### Task 5: AI 点评标注生成时间

**Files:**
- Modify: `frontend/src/components.jsx:447-448`（normalizeDetail 映射）、`:526-527`（loading 占位对象）、`:832-845`（AI 点评头部）
- Modify: `frontend/src/compass.css`（`.ai-summary__date` 样式）

**Interfaces:**
- Consumes: 详情接口已返回的 `aiSummaryAt` / `aiDetailAt`（`server.mjs:443-446`，ISO 字符串），无需改后端

- [ ] **Step 1: normalizeDetail 透传时间字段**

`frontend/src/components.jsx:447-448` 改为：

```js
    aiSummary: api.aiSummary || "暂无 AI 点评。",
    aiDetail: api.aiDetail || null,
    aiSummaryAt: api.aiSummaryAt || null,
    aiDetailAt: api.aiDetailAt || null,
```

`components.jsx:526-527` 的占位对象同步加：

```js
    aiSummary: "正在加载 AI 点评…",
    aiDetail: null,
    aiSummaryAt: null,
    aiDetailAt: null,
```

- [ ] **Step 2: 头部显示生成日期**

`components.jsx:836` `<span className="ai-summary__tag">AI 点评</span>` 之后插入：

```jsx
                    {(() => {
                      const at = d.aiDetailAt || d.aiSummaryAt;
                      return at ? <span className="ai-summary__date mono">生成于 {String(at).slice(0, 10)}</span> : null;
                    })()}
```

- [ ] **Step 3: 样式**

`frontend/src/compass.css` 中 `.ai-summary__tag` 附近追加：

```css
.ai-summary__date {
  font-size: 11px;
  color: var(--text-3, #8a8f98);
  margin-left: 8px;
}
```

- [ ] **Step 4: 构建 + 验证**

Run: `npm run build && npm start`
打开任一基金详情抽屉：AI 点评标签旁显示"生成于 YYYY-MM-DD"；没有点评的基金不显示该标注。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components.jsx frontend/src/compass.css public/
git commit -m "feat: 详情页 AI 点评标注生成时间"
```

---

## 整体收尾验证

- [ ] `node --test tests/` 全绿
- [ ] `npm run build && npm start` 手工过一遍：多选筛选、列表份额合并、详情抽屉、聊天卡片同类排名、AI 点评时间
- [ ] 配置了 .env 时 `npm run agent:test` 无回归
