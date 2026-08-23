"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [registrationAvailable, setRegistrationAvailable] = useState(true);

  useEffect(() => {
    if (mode === "register") void fetch("/api/auth/status", { cache: "no-store" }).then((response) => response.json())
      .then((result) => setRegistrationAvailable(Boolean(result.registration_available)));
  }, [mode]);

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
    <p className="eyebrow">{registering ? "首次设置" : "欢迎回来"}</p>
    <h1>{registering ? "创建管理员账号" : "登录题库"}</h1>
    <p>{registering ? "只允许创建一个账号。创建后注册入口自动关闭。" : "登录后才能访问题库、PDF 证据和练习记录。"}</p>
    {registering && !registrationAvailable ? <div className="auth-message">注册已经关闭，请返回登录。</div> : <form onSubmit={submit}>
      <label>用户名<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required minLength={3} maxLength={32} /></label>
      <label>密码<input type="password" autoComplete={registering ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} required minLength={10} maxLength={128} /></label>
      {message && <div className="auth-message">{message}</div>}
      <button className="primary-button" disabled={busy}>{busy ? "处理中…" : registering ? "创建账号并进入" : "登录"}</button>
    </form>}
    <a href={registering ? "/login" : "/register"}>{registering ? "返回登录" : "首次使用？创建账号"}</a>
  </section></main>;
}
