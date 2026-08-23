"use client";

import { useCallback, useEffect, useState } from "react";

export type WorkspaceUser = {
  id: string;
  username: string;
  role: "admin" | "user";
  access_tier: "preview" | "full";
};

type ManagedKey = {
  id: string;
  user_id: string;
  key_prefix: string;
  status: "pending" | "redeemed" | "revoked";
  created_at: string;
};

export function AccessPanel({ user, onUpgraded }: { user: WorkspaceUser; onUpgraded: () => void }) {
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  if (user.role === "admin" || user.access_tier === "full") return null;

  const redeem = async () => {
    if (!key.trim()) return setMessage("请输入管理员发给你的专属 Key");
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/access/redeem", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: key.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "兑换失败");
      setMessage("已解锁完整题库，正在刷新…");
      onUpgraded();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "兑换失败，请检查 Key");
    } finally { setBusy(false); }
  };

  return <section className="access-card">
    <div><p className="eyebrow">50 题体验账号</p><h2>解锁完整题库</h2><p>你的体验题目固定保留，练习记录和错题本只属于当前账号。专属 Key 只能由这个账号兑换一次。</p></div>
    <div className="key-redeem"><input aria-label="专属访问 Key" value={key} onChange={(event) => setKey(event.target.value)} placeholder="输入管理员发放的 Key" /><button className="primary-button" disabled={busy} onClick={redeem}>{busy ? "验证中…" : "兑换 Key"}</button>{message && <small>{message}</small>}</div>
  </section>;
}

export function AdminAccessPanel() {
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [keys, setKeys] = useState<ManagedKey[]>([]);
  const [issuedKey, setIssuedKey] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const [userResponse, keyResponse] = await Promise.all([
      fetch("/api/admin/users", { cache: "no-store" }), fetch("/api/admin/access-keys", { cache: "no-store" }),
    ]);
    const [userResult, keyResult] = await Promise.all([userResponse.json(), keyResponse.json()]);
    if (!userResponse.ok || !keyResponse.ok) return setMessage(userResult.error ?? keyResult.error ?? "无法读取用户权限");
    setUsers(userResult.users ?? []); setKeys(keyResult.keys ?? []);
  }, []);
  useEffect(() => { const frame = requestAnimationFrame(() => void refresh()); return () => cancelAnimationFrame(frame); }, [refresh]);

  const createKey = async (userId: string) => {
    setIssuedKey(""); setMessage("");
    const response = await fetch("/api/admin/access-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId }) });
    const result = await response.json();
    if (!response.ok) return setMessage(result.error ?? "Key 创建失败");
    setIssuedKey(result.access_key?.key ?? "");
    setMessage("Key 只会完整显示这一次，请安全发送给对应用户。");
    await refresh();
  };
  const revoke = async (keyId: string) => {
    const response = await fetch(`/api/admin/access-keys/${keyId}/revoke`, { method: "POST" });
    const result = await response.json();
    setMessage(response.ok ? "权限已撤销，该用户恢复为 50 题体验。" : result.error ?? "撤销失败");
    if (response.ok) await refresh();
  };

  return <section className="admin-access-card">
    <div className="section-heading"><div><p className="eyebrow">管理员权限</p><h2>用户与专属 Key</h2></div><span className="status-pill success">仅管理员可见</span></div>
    <p className="tool-copy">为指定用户生成一次性专属 Key。它不能转给其他账号；撤销后，该用户只能继续使用固定的 50 道体验题。</p>
    {issuedKey && <div className="issued-key"><strong>新 Key（仅显示一次）</strong><code>{issuedKey}</code><button className="secondary-button" onClick={() => void navigator.clipboard.writeText(issuedKey)}>复制</button></div>}
    {message && <p className="inline-message">{message}</p>}
    <div className="user-access-list">
      {users.map((item) => {
        const latestKey = keys.find((key) => key.user_id === item.id && key.status !== "revoked");
        const full = item.role === "admin" || item.access_tier === "full";
        return <div className="user-access-row" key={item.id}><span><strong>{item.username}</strong><small>{item.role === "admin" ? "管理员 · 完整权限" : full ? "已解锁完整题库" : "固定 50 题体验"}{latestKey ? ` · ${latestKey.key_prefix}… (${latestKey.status})` : ""}</small></span><div>{item.role !== "admin" && !full && <button className="primary-button" onClick={() => createKey(item.id)}>生成专属 Key</button>}{item.role !== "admin" && latestKey && <button className="secondary-button" onClick={() => revoke(latestKey.id)}>撤销</button>}</div></div>;
      })}
      {!users.length && <p className="task-empty">暂时没有其他注册用户</p>}
    </div>
  </section>;
}
