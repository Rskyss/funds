import React, { useState, useEffect } from "react";
import { signIn, signUp } from "./auth.js";

export default function AuthModal({ open, mode, onClose, onSwitch, onSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setError(""); setBusy(false); }
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const isLogin = mode === "login";

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (isLogin) {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password, invite.trim());
      }
      onSuccess?.();
    } catch (err) {
      setError(err.message || (isLogin ? "登录失败" : "注册失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-modal" role="dialog" aria-modal="true">
      <div className="auth-modal__backdrop" onClick={onClose} />
      <div className="auth-modal__card">
        <button className="auth-modal__close" onClick={onClose} aria-label="关闭">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        <h2 className="auth-modal__title">{isLogin ? "登录" : "注册"}</h2>
        <p className="auth-modal__hint">
          {isLogin
            ? "登录后即可使用 AI 投顾、收藏和基金对比。"
            : "注册需要邀请码，邮箱不会发送验证邮件。"}
        </p>
        <form className="auth-modal__form" onSubmit={submit}>
          <label className="auth-modal__field">
            <span>邮箱</span>
            <input
              type="email" autoComplete="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="auth-modal__field">
            <span>密码</span>
            <input
              type="password" autoComplete={isLogin ? "current-password" : "new-password"}
              minLength={6} required
              value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
            />
          </label>
          {!isLogin && (
            <label className="auth-modal__field">
              <span>邀请码</span>
              <input
                type="text" autoComplete="off" required
                value={invite} onChange={(e) => setInvite(e.target.value)}
                placeholder="请输入邀请码"
              />
            </label>
          )}
          {error && <p className="auth-modal__error">{error}</p>}
          <button className="btn btn--primary auth-modal__submit" type="submit" disabled={busy}>
            {busy ? "处理中…" : isLogin ? "登录" : "注册并登录"}
          </button>
        </form>
        <div className="auth-modal__switch">
          <span>{isLogin ? "还没有账号？" : "已有账号？"}</span>
          <button type="button" onClick={() => onSwitch(isLogin ? "register" : "login")}>
            {isLogin ? "注册一个" : "直接登录"}
          </button>
        </div>
      </div>
    </div>
  );
}
