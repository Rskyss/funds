import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error("缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY，请检查 .env 文件");
}

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const publicConfig = {
  url: SUPABASE_URL,
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || "",
};
