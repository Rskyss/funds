const EMBEDDING_BASE_URL = (process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/+$/, "");
const EMBEDDING_ENDPOINT = `${EMBEDDING_BASE_URL}/embeddings`;
const DEFAULT_MODEL = process.env.DASHSCOPE_EMBEDDING_MODEL || "text-embedding-v3";
const DEFAULT_DIM = Number(process.env.DASHSCOPE_EMBEDDING_DIM || 1024);

export async function embedTexts(texts, { model = DEFAULT_MODEL, dimensions = DEFAULT_DIM } = {}) {
  if (!Array.isArray(texts)) texts = [texts];
  const inputs = texts.map((t) => String(t || "").slice(0, 1800).trim()).filter(Boolean);
  if (!inputs.length) return [];
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY 未配置");
  const res = await fetch(EMBEDDING_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: inputs, dimensions, encoding_format: "float" }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Embedding ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  const vectors = (data?.data || []).map((d) => d.embedding);
  if (vectors.length !== inputs.length) throw new Error(`embedding 返回数量不一致: ${vectors.length} vs ${inputs.length}`);
  return vectors;
}

export async function embedText(text, opts) {
  const arr = await embedTexts([text], opts);
  return arr[0] || null;
}
