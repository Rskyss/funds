/** 同基金多份额：合并展示用（聊天卡片方案 B） */

const SHARE_STRIP_RE =
  /(人民币|美元|欧元|港币|日元)(现汇|现钞)?[A-C]?$|\(QDII\)|混合|股票型|股票|指数|ETF|联接|发起/gi;

/** 归一化基金名，用于判断是否同一产品不同份额 */
export function fundFamilyKey(name) {
  if (!name) return "";
  return String(name)
    .replace(SHARE_STRIP_RE, "")
    .replace(/[（(][^）)]*[)）]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** 分数越高越适合作为列表主卡（默认推人民币 A） */
export function shareClassRank(name) {
  const n = String(name || "");
  if (/美元.*现汇|现汇.*美元/i.test(n)) return 5;
  if (/美元|现钞|现汇|欧元/i.test(n) && !/人民币/.test(n)) return 12;
  if (/人民币[^A-C]*A\b|人民币A/i.test(n)) return 100;
  if (/人民币[^A-C]*C\b|人民币C/i.test(n)) return 80;
  if (/人民币/.test(n)) return 70;
  if (/\bA\b|\(A\)|[^A-Z]A$/i.test(n)) return 60;
  if (/\bC\b|\(C\)|[^A-Z]C$/i.test(n)) return 50;
  return 40;
}

function isRetailHardToBuy(card) {
  const n = card.name || "";
  if (/美元|现汇|现钞|欧元/i.test(n) && !/人民币/.test(n)) return true;
  if (card.purchaseStatus === "暂停" || card.purchaseStatus === "封闭") return true;
  return false;
}

function altShareLabel(name) {
  const n = String(name || "");
  if (/美元.*现汇|现汇.*美元/i.test(n)) return "美元现汇份额";
  if (/美元/.test(n) && !/人民币/.test(n)) return "美元份额";
  if (/人民币.*C|人民币C/i.test(n)) return "人民币 C 份额";
  if (/人民币/.test(n)) return "其他人民币份额";
  return "其他份额";
}

/**
 * 将同系列产品折叠为主卡 + altShares（方案 B：仅主卡出列表，备注在卡片内）
 * @param {Array<object>} cards
 */
export function mergeShareClassCards(cards) {
  if (!Array.isArray(cards) || cards.length < 2) return cards || [];

  const groups = new Map();
  const order = [];

  for (const card of cards) {
    const key = fundFamilyKey(card.name) || card.code;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(card);
  }

  const out = [];
  for (const key of order) {
    const list = groups.get(key);
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const sorted = [...list].sort((a, b) => shareClassRank(b.name) - shareClassRank(a.name));
    const [primary, ...rest] = sorted;
    out.push({
      ...primary,
      altShares: rest.map((alt) => ({
        code: alt.code,
        name: alt.name,
        purchaseStatus: alt.purchaseStatus || null,
        purchaseLimitYuan: alt.purchaseLimitYuan ?? null,
        retailHard: isRetailHardToBuy(alt),
        shareLabel: altShareLabel(alt.name),
      })),
    });
  }
  return out;
}
