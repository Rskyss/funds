import React, { useState, useEffect } from "react";
import { authedFetch } from "./auth.js";

export default function AiSettingsModal({ open, onClose, onSaved }) {
  const [apiKey, setApiKey] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [reviewModel, setReviewModel] = useState("");
  const [mask, setMask] = useState(null);
  const [configured, setConfigured] = useState(false);
  const [validated, setValidated] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(""); setBusy(false); setApiKey(""); setValidated(false);
    authedFetch("/api/profile").then((r) => r.json()).then((d) => {
      const p = d?.profile || {};
      setMask(p.aiKeyMask || null);
      setChatModel(p.aiChatModel || "");
      setReviewModel(p.aiReviewModel || "");
      setConfigured(!!p.aiConfigured);
      if (p.aiConfigured) setValidated(true); // 已配置过：直接展开两个模型框
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function validate() {
    setError(""); setBusy(true);
    try {
      const r = await authedFetch("/api/profile/ai/validate", { method: "POST", body: JSON.stringify({ aiApiKey: apiKey.trim() }) });
      const d = await r.json();
      if (!r.ok || !d.ok) throw new Error(d.error || "验证失败");
      setValidated(true);
    } catch (err) {
      setError(err.message || "验证失败");
    } finally { setBusy(false); }
  }

  async function save(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const payload = { aiChatModel: chatModel.trim(), aiReviewModel: reviewModel.trim() };
      if (apiKey.trim()) payload.aiApiKey = apiKey.trim();
      const r = await authedFetch("/api/profile", { method: "POST", body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存失败");
      onSaved?.(true);
      onClose();
    } catch (err) {
      setError(err.message || "保存失败");
    } finally { setBusy(false); }
  }

  async function clear() {
    setError(""); setBusy(true);
    try {
      const r = await authedFetch("/api/profile", { method: "POST", body: JSON.stringify({ clearAiKey: true }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "清除失败");
      onSaved?.(false);
      onClose();
    } catch (err) {
      setError(err.message || "清除失败");
    } finally { setBusy(false); }
  }

  return (
    <div className="auth-modal" role="dialog" aria-modal="true">
      <div className="auth-modal__backdrop" onClick={onClose} />
      <div className="auth-modal__card">
        <button className="auth-modal__close" onClick={onClose} aria-label="关闭">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        <h2 className="auth-modal__title">模型设置</h2>
        <p className="auth-modal__hint">填你自己的阿里云百炼 API Key 与模型名。Key 加密存储、不回显。AI 投问与"用我的模型重新生成点评"都用你自己的 Key。</p>
        <form className="auth-modal__form" onSubmit={save}>
          <label className="auth-modal__field">
            <span>百炼 API Key{configured && mask ? `（已保存：${mask}，留空=不修改）` : ""}</span>
            <input type="password" autoComplete="off" value={apiKey}
              onChange={(e) => { const v = e.target.value; setApiKey(v); setValidated(v.trim() ? false : configured); }}
              placeholder={configured ? "留空则沿用已保存的 Key" : "sk-..."} />
          </label>
          {!validated && (
            <button type="button" className="btn btn--primary" onClick={validate} disabled={busy || !apiKey.trim()}>
              {busy ? "验证中…" : "验证 Key"}
            </button>
          )}
          {validated && (
            <>
              <label className="auth-modal__field">
                <span>短/长评模型</span>
                <input type="text" value={reviewModel} onChange={(e) => setReviewModel(e.target.value)} placeholder="qwen-plus" required />
              </label>
              <label className="auth-modal__field">
                <span>投问模型</span>
                <input type="text" value={chatModel} onChange={(e) => setChatModel(e.target.value)} placeholder="qwen-plus" required />
              </label>
              <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? "保存中…" : "保存"}</button>
            </>
          )}
          {error && <p className="auth-modal__error">{error}</p>}
        </form>
        {configured && (
          <div className="auth-modal__switch">
            <button type="button" onClick={clear} disabled={busy}>清除我的配置</button>
          </div>
        )}
      </div>
    </div>
  );
}
