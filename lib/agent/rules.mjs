// 读取 rules/ 目录下的能力卡片 md，作为 AI 投顾各环节的指令。
// 卡片是人类可编辑的策略层；机器格式契约（JSON schema、排版约束）仍在 prompts.mjs 内保留。
// 改卡片后需重启服务生效（与 .env 一致的约定）；reloadCards() 供将来热加载用。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "rules");
const cache = new Map();

export function card(name) {
  if (cache.has(name)) return cache.get(name);
  let text = "";
  try {
    text = readFileSync(join(RULES_DIR, `${name}.md`), "utf8").trim();
  } catch (err) {
    console.warn(`[rules] 读取卡片失败 ${name}: ${err.message}`);
  }
  cache.set(name, text);
  return text;
}

export function cards(...names) {
  return names
    .map(card)
    .filter(Boolean)
    .join("\n\n---\n\n");
}

export function reloadCards() {
  cache.clear();
}

// 解析 suggestions.md：通用问题按 H3 分组（供随机抽取），指定基金问题为有序列表（含占位符）。
// 解析逻辑放服务端，话术内容仍只在 rules/suggestions.md 里维护。
export function suggestionTemplates() {
  const text = card("suggestions");
  const lines = text.split("\n");
  const genericGroups = [];
  const fund = [];
  let mode = null; // "generic" | "fund"
  let currentGroup = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("## ")) {
      if (line.includes("通用推荐")) mode = "generic";
      else if (line.includes("指定基金")) mode = "fund";
      else mode = null;
      currentGroup = null;
      continue;
    }
    if (mode === "generic" && line.startsWith("### ")) {
      currentGroup = [];
      genericGroups.push(currentGroup);
      continue;
    }
    if (line.startsWith("- ")) {
      const item = line.slice(2).trim();
      if (!item) continue;
      if (mode === "generic" && currentGroup) currentGroup.push(item);
      else if (mode === "fund") fund.push(item);
    }
  }
  return { genericGroups: genericGroups.filter((g) => g.length), fund };
}
