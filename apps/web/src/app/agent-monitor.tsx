"use client";

import { useEffect, useState } from "react";
import type { AgentMonitorSnapshot, AgentTask, AgentTaskStatus } from "@/lib/agent-monitor";

const labels: Record<AgentTaskStatus, string> = { running: "运行中", queued: "排队", completed: "已完成", blocked: "已阻塞", failed: "失败", stale: "状态过期", unknown: "未知" };

function TaskCard({ task }: { task: AgentTask }) {
  const progress = task.current && task.end ? Math.min(100, Math.max(0, (task.current / task.end) * 100)) : null;
  return <article className="agent-task-card">
    <div className="agent-task-head"><span className={`agent-dot ${task.status}`} /><div><strong>{task.title}</strong><small>{task.agent === "claude-code" ? "Claude Code" : task.agent === "codex" ? "Codex" : "本地 Worker"}{task.gateway ? ` · ${task.gateway}` : ""}</small></div><span className={`agent-status ${task.status}`}>{labels[task.status]}</span></div>
    {task.range && <p className="agent-range">当前范围 <strong>{task.range}</strong>{task.end ? ` / 目标 ${task.end}` : ""}</p>}
    {progress !== null && <div className="agent-progress"><i style={{ width: `${progress}%` }} /></div>}
    {task.message && <p className="agent-message">{task.message}</p>}
    <footer><span>{task.updated_at ? new Date(task.updated_at).toLocaleString("zh-CN") : "无更新时间"}</span><code>{task.source}</code></footer>
  </article>;
}

export default function AgentMonitor() {
  const [snapshot, setSnapshot] = useState<AgentMonitorSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/agent-monitor", { cache: "no-store" });
      if (!response.ok) throw new Error("无法读取本机任务状态");
      setSnapshot(await response.json());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "刷新失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const active = (snapshot?.totals.running ?? 0) + (snapshot?.totals.queued ?? 0);
  return <main className="agent-page">
    <section className="agent-hero"><div><p className="eyebrow">LOCAL AI CONTROL CENTER</p><h1>AI 工作台</h1><p>统一观察 Codex、Claude Code 与本地 Worker。刷新只读取本机状态文件，不调用模型、不消耗 token。</p></div><button className="primary-button" onClick={refresh} disabled={loading}>{loading ? "刷新中…" : "刷新最新状态"}</button></section>
    {error && <div className="agent-error">{error}</div>}
    <section className="agent-metrics"><article><span>活动任务</span><strong>{active}</strong></article><article><span>阻塞 / 失败</span><strong>{(snapshot?.totals.blocked ?? 0) + (snapshot?.totals.failed ?? 0)}</strong></article><article><span>已完成记录</span><strong>{snapshot?.totals.completed ?? 0}</strong></article><article><span>已发现项目</span><strong>{snapshot?.projects.length ?? 0}</strong></article></section>
    <div className="agent-refresh-note">最近刷新：{snapshot ? new Date(snapshot.generated_at).toLocaleString("zh-CN") : "尚未完成"}</div>
    <section className="agent-project-list">
      {snapshot?.projects.map((project) => <article className="agent-project" key={project.id}><header><div><p className="eyebrow">PROJECT</p><h2>{project.name}</h2></div><span>{project.tasks.length} 个状态源</span></header><div className="agent-task-grid">{project.tasks.map((task) => <TaskCard key={task.id} task={task} />)}</div></article>)}
      {!loading && snapshot?.projects.length === 0 && <div className="agent-empty"><strong>还没有发现标准任务状态</strong><p>项目写入 data/private 下的队列 state.json 后会自动出现。</p></div>}
    </section>
  </main>;
}
