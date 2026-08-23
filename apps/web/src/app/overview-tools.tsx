"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { ImportJob, PracticeFilters, StudySummary } from "@/lib/types";

const statusText: Record<ImportJob["status"], string> = {
  queued: "等待后台处理",
  validating: "正在检查 PDF",
  extracting: "正在提取候选题",
  rendering: "正在生成来源页图",
  committing: "正在写入题库",
  review_ready: "候选题已生成",
  failed: "导入失败",
};

export default function OverviewTools({ onPractice, onWrongPractice }: {
  onPractice: (examCode?: "AZ-104" | "AZ-305", knowledgePoints?: string[]) => void;
  onWrongPractice: () => void;
}) {
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [summary, setSummary] = useState<StudySummary | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [examCode, setExamCode] = useState<"AZ-104" | "AZ-305">("AZ-104");
  const [maxQuestions, setMaxQuestions] = useState(50);
  const [confirmed, setConfirmed] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [filters, setFilters] = useState<PracticeFilters>({ exams: [] });
  const [practiceExam, setPracticeExam] = useState<"AZ-104" | "AZ-305">("AZ-104");
  const [selectedPoints, setSelectedPoints] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [jobResponse, summaryResponse, filterResponse] = await Promise.all([
        fetch("/api/imports", { cache: "no-store" }),
        fetch("/api/study-summary", { cache: "no-store" }),
        fetch("/api/practice/filters", { cache: "no-store" }),
      ]);
      if (jobResponse.ok) setJobs((await jobResponse.json()).jobs as ImportJob[]);
      if (summaryResponse.ok) setSummary(await summaryResponse.json() as StudySummary);
      if (filterResponse.ok) setFilters(await filterResponse.json() as PracticeFilters);
    } catch {
      setMessage("暂时无法获取最新状态，已保留上次结果");
    }
  }, []);

  useEffect(() => {
    const initial = window.requestAnimationFrame(() => void refresh());
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { window.cancelAnimationFrame(initial); window.clearInterval(timer); };
  }, [refresh]);

  const activeJob = jobs[0];
  const practicePoints = filters.exams.find((exam) => exam.exam_code === practiceExam)?.knowledge_points ?? [];
  const hasRunningJob = jobs.some((job) => !["review_ready", "failed"].includes(job.status));
  const recentSessions = summary?.recent_sessions ?? [];
  const formatTime = (value: string) => new Date(value).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const formatDuration = (durationMs: number) => `${Math.floor(durationMs / 60000)}分 ${Math.round((durationMs % 60000) / 1000)}秒`;

  const upload = () => {
    if (!file) return setMessage("请选择 PDF 文件");
    if (file.size > 100 * 1024 * 1024) return setMessage("PDF 不能超过 100 MiB");
    if (!confirmed) return setMessage("请先确认文件仅用于个人学习");
    setMessage("");
    setUploadProgress(0);
    const request = new XMLHttpRequest();
    request.open("POST", `/api/imports?exam_code=${examCode}&max_questions=${maxQuestions}`);
    request.setRequestHeader("Content-Type", "application/pdf");
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      setUploadProgress(null);
      const result = JSON.parse(request.responseText || "{}");
      if (request.status >= 200 && request.status < 300) {
        setMessage(result.duplicate ? "这份文件已经导入，已打开原任务" : "上传完成，后台解析已经开始");
        void refresh();
      } else setMessage(result.error ?? "上传失败，请重试");
    };
    request.onerror = () => { setUploadProgress(null); setMessage("上传中断，请重新选择文件"); };
    request.send(file);
  };

  const retry = async (jobId: string) => {
    const response = await fetch(`/api/imports/${jobId}/retry`, { method: "POST" });
    const result = await response.json();
    setMessage(response.ok ? "任务已重新排队" : result.error ?? "无法重试任务");
    await refresh();
  };

  const jobProgress = useMemo(() => {
    if (!activeJob?.progress_total || activeJob.progress_current == null) return null;
    return `${activeJob.progress_current} / ${activeJob.progress_total}`;
  }, [activeJob]);

  return (
    <>
      <section className="overview-tool-grid">
        <article className="upload-card">
          <div className="section-heading"><div><p className="eyebrow">私人导入</p><h2>导入新的题目 PDF</h2></div><span className="status-pill warning">最大 100 MiB</span></div>
          <p className="tool-copy">文件只保存在本机私有目录。系统提取候选题，不会猜测正确答案。</p>
          <div className="upload-fields">
            <label className="file-picker"><span>{file ? file.name : "选择 PDF"}</span><input type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
            <label>考试类型<select value={examCode} onChange={(event) => setExamCode(event.target.value as "AZ-104" | "AZ-305")}><option>AZ-104</option><option>AZ-305</option></select></label>
            <label>导入范围<select value={maxQuestions} onChange={(event) => setMaxQuestions(Number(event.target.value))}><option value={50}>先试运行 50 题</option><option value={1000}>整本题库</option></select></label>
          </div>
          <label className="confirm-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />我确认此文件仅用于个人学习</label>
          <button className="primary-button" disabled={uploadProgress !== null || hasRunningJob} onClick={upload}>{uploadProgress === null ? "开始导入" : `正在上传 · ${uploadProgress}%`}</button>
          {message && <p className="inline-message">{message}</p>}
        </article>

        <article className="task-card">
          <div className="section-heading"><div><p className="eyebrow">当前任务</p><h2>{activeJob ? activeJob.filename : "还没有网页导入任务"}</h2></div>{activeJob && <span className={`status-pill ${activeJob.status === "review_ready" ? "success" : activeJob.status === "failed" ? "danger" : "warning"}`}>{statusText[activeJob.status]}</span>}</div>
          {activeJob ? <>
            <p className="tool-copy">{activeJob.exam_code} · {activeJob.page_count ? `${activeJob.page_count} 页` : "正在读取页数"}</p>
            {jobProgress && <div className="task-progress"><i style={{ width: `${Math.min(100, (activeJob.progress_current! / activeJob.progress_total!) * 100)}%` }} /><span>{jobProgress}</span></div>}
            {activeJob.candidate_count != null && <strong className="task-count">{activeJob.candidate_count} 道候选题</strong>}
            {activeJob.error_summary && <p className="task-error">{activeJob.error_summary}</p>}
            <div className="task-actions">
              {activeJob.status === "review_ready" && <button className="primary-button" onClick={() => window.location.reload()}>打开新题库</button>}
              {activeJob.status === "failed" && <button className="secondary-button" onClick={() => retry(activeJob.job_id)}>重试任务</button>}
              {!['review_ready', 'failed'].includes(activeJob.status) && <small>页面可以关闭，后台处理会继续。</small>}
            </div>
          </> : <p className="task-empty">上传后会在这里显示真实处理阶段；没有可靠分母的阶段不会显示假百分比。</p>}
        </article>
      </section>

      <section className="study-summary-grid">
        <article><p className="eyebrow">20 题一组</p><h2>{summary?.active_session ? "继续本组练习" : "开始随机练习"}</h2><p>{summary?.active_session ? `已完成 ${summary.active_session.answered} / ${summary.active_session.total} · 正确率 ${summary.active_session.accuracy}% · ${formatDuration(summary.active_session.duration_ms)}` : "每组从题库随机抽取 20 题"}</p><button className="secondary-button" onClick={() => onPractice()}>{summary?.active_session ? "继续本组" : "随机开始 20 题"}</button></article>
        <article><p className="eyebrow">错题本</p><strong className="wrong-count">{summary?.wrong_question_count ?? 0}</strong><p>{summary?.wrong_question_count ? "包含答错和手动标记的题目" : "答错或手动标记后会出现在这里"}</p><button className="secondary-button" disabled={!summary?.wrong_question_count} onClick={onWrongPractice}>练习错题</button></article>
        <article className="history-card"><div className="section-heading"><h2>最近练习</h2><small>最近 3 次</small></div>{recentSessions.length ? recentSessions.map((session) => <div className="history-row" key={session.session_id}><span><strong>{session.status === "active" ? "进行中" : session.mode === "wrong_book" ? "错题练习" : "随机练习"}</strong><small>{formatTime(session.started_at)} · {formatDuration(session.duration_ms)}</small></span><span>{session.answered}/{session.total} · 正确率 {session.accuracy}%</span></div>) : <p className="task-empty">还没有练习记录</p>}</article>
      </section>

      <section className="knowledge-practice-card">
        <div className="section-heading"><div><p className="eyebrow">按知识点练习</p><h2>选择考试和薄弱知识点</h2></div><span className="status-pill success">随机最多 20 题</span></div>
        <div className="knowledge-controls">
          <label>考试类型<select value={practiceExam} onChange={(event) => { setPracticeExam(event.target.value as "AZ-104" | "AZ-305"); setSelectedPoints([]); }}>
            {filters.exams.map((exam) => <option key={exam.exam_code} value={exam.exam_code}>{exam.exam_code} · {exam.total} 题</option>)}
          </select></label>
          <button className="secondary-button" onClick={() => setSelectedPoints([])}>清除选择</button>
          <button className="primary-button" disabled={!filters.exams.length} onClick={() => onPractice(practiceExam, selectedPoints)}>{selectedPoints.length ? `练习已选 ${selectedPoints.length} 个知识点` : `练习全部 ${practiceExam}`}</button>
        </div>
        <div className="knowledge-point-grid">
          {practicePoints.map((point) => <label className={selectedPoints.includes(point.name) ? "knowledge-chip selected" : "knowledge-chip"} key={point.name}>
            <input type="checkbox" checked={selectedPoints.includes(point.name)} onChange={() => setSelectedPoints((items) => items.includes(point.name) ? items.filter((item) => item !== point.name) : [...items, point.name])} />
            <span>{point.name}</span><small>{point.count} 题</small>
          </label>)}
        </div>
      </section>
    </>
  );
}
