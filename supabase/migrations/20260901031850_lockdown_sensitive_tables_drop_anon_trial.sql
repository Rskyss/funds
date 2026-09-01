-- 1.7.1 安全加固：敏感表对浏览器侧（anon / authenticated）彻底关门。
-- 这些 *_admin_all 策略对 service role 毫无作用（service role 本就绕过 RLS），
-- 唯一效果是把表对公网打开；服务端全部走 service role，删掉不影响任何功能。
-- 2026-09-01 实测：删前用前端公开的 publishable key 可读全部 user_profile / chat_logs / chat_sessions / fund_doc_chunks；删后全部 401。
drop policy if exists user_profile_admin_all on public.user_profile;
drop policy if exists chat_sessions_admin_all on public.chat_sessions;
drop policy if exists chat_logs_admin_all on public.chat_logs;
drop policy if exists fund_doc_chunks_admin_all on public.fund_doc_chunks;

-- 纵深防御：即使将来有人误加宽松策略，浏览器侧角色也没有表级权限。
revoke all on table public.user_profile from anon, authenticated;
revoke all on table public.chat_sessions from anon, authenticated;
revoke all on table public.chat_logs from anon, authenticated;
revoke all on table public.fund_doc_chunks from anon, authenticated;
revoke all on table public.events from anon, authenticated;
revoke all on table public.invite_codes from anon, authenticated;

-- 清理已下线的「匿名试用额度」残留（代码已无引用；advisor 警告匿名可调用 SECURITY DEFINER 函数）。
-- 表内 12 行历史数据已在执行前导出备份（本地，不入库）。
drop function if exists public.consume_anon_trial(text, integer);
drop table if exists public.anon_trial_usage;

-- 修复 advisor 警告：函数 search_path 可变。
alter function public.search_fund_doc_chunks(vector, integer, text[]) set search_path = public;
