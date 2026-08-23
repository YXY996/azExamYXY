"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage("");
    const response = await fetch(`/api/auth/${mode}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
    });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) return setMessage(result.error ?? "操作失败");
    router.replace("/"); router.refresh();
  };

  const registering = mode === "register";
  return <main className="auth-page"><section className="auth-card">
    <div className="auth-brand"><span>AZ</span><div><strong>Exam Coach</strong><small>私人备考工作台</small></div></div>
    <p className="eyebrow">{registering ? "创建学习账号" : "欢迎回来"}</p>
    <h1>{registering ? "注册 50 题体验" : "登录题库"}</h1>
    <p>{registering ? "注册后会固定分配 50 道体验题。完整题库需要登录后兑换管理员发放的专属 Key。" : "登录后访问自己的练习记录、错题本和已授权题目。"}</p>
    <form onSubmit={submit}>
      <label>用户名<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={32} /></label>
      <label>密码<input type="password" autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} maxLength={128} /></label>
      {message && <div className="auth-message">{message}</div>}
      <button className="primary-button" disabled={busy}>{busy ? "处理中…" : registering ? "注册并开始体验" : "登录"}</button>
    </form>
    <a href={registering ? "/login" : "/register"}>{registering ? "已有账号？返回登录" : "没有账号？注册 50 题体验"}</a>
  </section></main>;
}
