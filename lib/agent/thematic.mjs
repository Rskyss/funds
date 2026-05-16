/** 用户口语 → 结构化筛选 + RAG 查询增强（不是静态 rules 库） */
const THEME_HINTS = [
  { re: /存储|储存|内存|闪存|dram|nand|memory|storage/i, theme: ["半导体"], ragBoost: "半导体 存储 芯片 美股" },
  { re: /半导体|芯片|晶圆|代工/i, theme: ["半导体"], ragBoost: "半导体 芯片" },
  { re: /人工智能|ai\b|算力|云计算|数据中心/i, theme: ["科技成长"], ragBoost: "人工智能 科技 云计算" },
  { re: /纳斯达克|纳指|美股科技/i, theme: ["科技成长"], region: ["美国"], ragBoost: "纳斯达克 科技" },
  { re: /标普\s*500|宽基|美股大盘/i, theme: ["美国宽基"], region: ["美国"] },
  { re: /港股|恒生|香港科技/i, region: ["港股"], ragBoost: "港股 科技" },
  { re: /黄金|贵金属/i, theme: ["商品资源"], ragBoost: "黄金 QDII" },
  { re: /医药|医疗|生物/i, theme: ["医疗健康"], ragBoost: "医药 医疗" },
  { re: /债|美元债|固收/i, theme: ["债券收益"], ragBoost: "债券 收益" },
];

export function detectThematicHints(message) {
  if (!message || typeof message !== "string") return null;
  const text = message.trim();
  if (!text) return null;
  for (const hint of THEME_HINTS) {
    if (hint.re.test(text)) {
      return {
        theme: hint.theme || [],
        region: hint.region || [],
        ragQuery: `${text} ${hint.ragBoost || ""}`.trim(),
      };
    }
  }
  if (/找|推荐|筛|哪些|几只|列表/.test(text) && /股|板块|行业|主题/.test(text)) {
    return { theme: [], region: [], ragQuery: text };
  }
  return null;
}

export function mergeFilterWithHints(filter, hints) {
  const base = filter || {};
  if (!hints) return base;
  const uniq = (a, b) => Array.from(new Set([...(a || []), ...(b || [])]));
  return {
    ...base,
    theme: hints.theme?.length ? uniq(base.theme, hints.theme) : base.theme,
    region: hints.region?.length ? uniq(base.region, hints.region) : base.region,
  };
}
