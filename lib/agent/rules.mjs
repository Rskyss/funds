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
