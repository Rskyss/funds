import { supabaseAdmin } from "./supabase.mjs";

export async function verifyToken(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  return { userId: data.user.id, email: data.user.email };
}
