// 静态配置（原型期的假基金/假行情 mock 已删除：v1.7.1 起页面数据全部来自 /api/*）

// 热门筛选标签。kind: "union" 主题类（多选时互相取并集）；"and" 条件类（与其余选择取交集）
const QUICK_CHIPS = [
  { id: "us-tech",   label: "美股科技",   kind: "union", region: "美国",  theme: "科技成长" },
  { id: "nasdaq100", label: "纳指100",    kind: "union", keyword: "纳指" },
  { id: "sp500",     label: "标普500",    kind: "union", keyword: "标普500" },
  { id: "hk-tech",   label: "港股科技",   kind: "union", region: "港股",  theme: "科技成长" },
  { id: "gold",      label: "黄金主题",   kind: "union", keyword: "黄金" },
  { id: "attack",    label: "进攻型",     kind: "and",   role: "进攻仓" },
  { id: "fivestar",  label: "晨星 5★",   kind: "and",   rating: 5 },
  { id: "buyable",   label: "可申购",     kind: "and",   status: "open" },
];

export { QUICK_CHIPS };
