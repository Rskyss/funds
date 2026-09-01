import { createClient } from "@supabase/supabase-js";
import { createRetryingFetch } from "./retryFetch.mjs";

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error("缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY，请检查 .env 文件");
}

// Supabase 网关偶发 401 "JWT issued at future"（其内部时钟偏差）：重试一次即可，见 lib/retryFetch.mjs
const dbFetch = createRetryingFetch(globalThis.fetch, {
  onRetry: ({ reason, method, url }) => {
    let path = url;
    try { path = new URL(url).pathname; } catch {}
    console.warn(`[db] 瞬时错误，重试一次：${reason} ${method} ${path}`);
  },
});

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: dbFetch },
});

export const publicConfig = {
  url: SUPABASE_URL,
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || "",
};
