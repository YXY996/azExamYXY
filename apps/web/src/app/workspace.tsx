"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { CandidateBundle, CandidateQuestion } from "@/lib/questions";
import { makeManualProvenance, type EditableReview } from "@/lib/review-domain";
import type { PracticeSession } from "@/lib/types";
import OverviewTools from "./overview-tools";
import AgentMonitor from "./agent-monitor";
import { AccessPanel, AdminAccessPanel, type WorkspaceUser } from "./access-management";

type View = "overview" | "review" | "practice" | "agents";
const typeLabels: Record<CandidateQuestion["type"], string> = {
  single_choice: "单选",
  multiple_choice: "多选",
  true_false: "判断",
  image_interaction: "图片交互",
  unknown: "图片 / 未知",
};
const flagLabels: Record<string, string> = {
  answer_missing: "答案缺失",
  unsupported_or_image_question: "需要图片交互或人工改写",
  cross_page_merge: "跨页题",
  page_text_empty: "页面只有图片",
  options_missing: "未识别到文本选项",
};

function editableOf(question: CandidateQuestion): EditableReview {
  return {
    type: question.type,
    stem: question.stem,
    options: question.options,
    correct_option_ids: question.correct_option_ids,
    answer_confidence: question.answer_confidence,
    answer_provenance: question.answer_provenance,
    explanation: question.explanation,
  };
}

export default function Workspace({ bundle, currentUser }: { bundle: CandidateBundle; currentUser?: WorkspaceUser }) {
  const user = currentUser ?? { id: "legacy", username: "管理员", role: "admin" as const, access_tier: "full" as const };
  const isAdmin = user.role === "admin";
  const hasFullAccess = isAdmin || user.access_tier === "full";
  const router = useRouter();
  const [view, setView] = useState<View>("overview");
  const [questions, setQuestions] = useState(bundle.candidates);
  const [lockVersions, setLockVersions] = useState(bundle.review_versions);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sourcePageIndex, setSourcePageIndex] = useState(0);
  const [saveMessage, setSaveMessage] = useState("已从本机数据库载入");
  const [saving, setSaving] = useState(false);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceSelection, setPracticeSelection] = useState<string[]>([]);
  const [practiceSession, setPracticeSession] = useState<PracticeSession | null>(null);
  const [practiceError, setPracticeError] = useState("");
  const [practiceAnswerRevealed, setPracticeAnswerRevealed] = useState(false);
  const [questionStartedAt, setQuestionStartedAt] = useState(() => Date.now());

  const updateQuestion = (nextQuestion: CandidateQuestion) => {
    setQuestions((items) => items.map((question, index) => index === currentIndex ? nextQuestion : question));
    setSaveMessage("有未保存修改");
  };

  const replaceQuestion = (nextQuestion: CandidateQuestion, lockVersion: number) => {
    setQuestions((items) => items.map((question) => question.question_id === nextQuestion.question_id ? nextQuestion : question));
    setLockVersions((versions) => ({ ...versions, [nextQuestion.question_id]: lockVersion }));
  };

  const current = questions[currentIndex];
  const approved = useMemo(() => questions.filter((question) => question.status === "approved"), [questions]);
  const unknown = questions.filter((question) => question.type === "unknown").length;
  const crossPage = questions.filter((question) => question.quality.flags.includes("cross_page_merge")).length;
  const lastSamplePage = Math.max(0, ...questions.flatMap((question) => question.source_pages));

  const selectCorrectAnswer = (optionId: string) => {
    if (!current) return;
    const selected = current.type === "multiple_choice"
      ? current.correct_option_ids.includes(optionId)
        ? current.correct_option_ids.filter((id) => id !== optionId)
        : [...current.correct_option_ids, optionId]
      : [optionId];
    updateQuestion({ ...current, correct_option_ids: selected, status: "needs_review" });
  };

  const saveCurrent = async () => {
    if (!current || saving) return false;
    setSaving(true);
    setSaveMessage("正在保存…");
    try {
      const response = await fetch(`/api/review/questions/${current.question_id}/draft`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editable: editableOf(current), expected_lock_version: lockVersions[current.question_id] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      replaceQuestion(result.question, result.lock_version);
      setSaveMessage(`已同步 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
      return true;
    } catch (error) {
      setSaveMessage(`保存失败 · ${error instanceof Error ? error.message : "请重试"}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const approveCurrent = async () => {
    if (!current) return;
    setSaving(true);
    setSaveMessage("批准中…");
    try {
      const response = await fetch(`/api/review/questions/${current.question_id}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editable: editableOf(current), expected_lock_version: lockVersions[current.question_id] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "批准失败");
      replaceQuestion(result.question, result.lock_version);
      setSaveMessage("已批准并创建不可变版本");
      if (currentIndex < questions.length - 1) {
        setCurrentIndex(currentIndex + 1);
        setSourcePageIndex(0);
      }
    } catch (error) {
      setSaveMessage(`无法批准 · ${error instanceof Error ? error.message : "请重试"}`);
    } finally {
      setSaving(false);
    }
  };

  const openPractice = async (fresh = false, mode: "random" | "wrong_book" = "random", examCode?: "AZ-104" | "AZ-305", knowledgePoints: string[] = []) => {
    setPracticeError("");
    setSaveMessage("正在恢复练习…");
    try {
      const response = await fetch("/api/practice/sessions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exam_code: examCode ?? bundle.document.exam_code, fresh, mode, knowledge_points: knowledgePoints }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法开始练习");
      const session = result as PracticeSession;
      const nextIndex = Math.min(session.items.findIndex((item) => !item.result), session.items.length - 1);
      const safeIndex = Math.max(0, nextIndex);
      setPracticeSession(session);
      setPracticeIndex(safeIndex);
      setPracticeSelection(session.items[safeIndex]?.result?.selected_option_ids ?? []);
      setPracticeAnswerRevealed(Boolean(session.items[safeIndex]?.result));
      setQuestionStartedAt(Date.now());
      setView("practice");
      setSaveMessage("练习进度已从服务端恢复");
    } catch (error) {
      setPracticeSession(null);
      setPracticeError(error instanceof Error ? error.message : "无法开始练习");
      setView("practice");
    }
  };

  const practiceItem = practiceSession?.items[practiceIndex];
  const practiceQuestion = practiceItem?.question;
  const practiceResult = practiceItem?.result;
  const practiceIsCorrect = practiceResult?.is_correct ?? false;
  const togglePracticeAnswer = (optionId: string) => {
    if (!practiceQuestion || practiceResult) return;
    if (practiceQuestion.type === "multiple_choice") {
      setPracticeSelection((items) => items.includes(optionId) ? items.filter((id) => id !== optionId) : [...items, optionId]);
    } else setPracticeSelection([optionId]);
  };
  const submitPracticeAnswer = async () => {
    if (!practiceSession || !practiceItem || !practiceSelection.length) return;
    const response = await fetch(`/api/practice/sessions/${practiceSession.session_id}/answers`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_id: crypto.randomUUID(), item_id: practiceItem.item_id,
        selected_option_ids: practiceSelection, duration_ms: Date.now() - questionStartedAt,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      setPracticeError(result.error ?? "提交失败，请重试");
      return;
    }
    setPracticeSession(result as PracticeSession);
  };
  const nextPracticeQuestion = () => {
    if (!practiceSession) return;
    const next = Math.min(practiceIndex + 1, practiceSession.items.length - 1);
    setPracticeIndex(next);
    setPracticeSelection(practiceSession.items[next]?.result?.selected_option_ids ?? []);
    setPracticeAnswerRevealed(Boolean(practiceSession.items[next]?.result));
    setQuestionStartedAt(Date.now());
  };
  const toggleWrongBookMark = async () => {
    if (!practiceSession || !practiceItem) return;
    const response = await fetch(`/api/practice/sessions/${practiceSession.session_id}/mark`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_id: practiceItem.item_id, marked: !practiceItem.is_marked }),
    });
    const result = await response.json();
    if (response.ok) setPracticeSession(result as PracticeSession);
    else setPracticeError(result.error ?? "无法更新错题本");
  };
  const formatDuration = (durationMs: number) => {
    const seconds = Math.round(durationMs / 1000);
    return `${Math.floor(seconds / 60)}分 ${seconds % 60}秒`;
  };
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("overview")}>
          <span className="brand-mark">AZ</span>
          <span><strong>Exam Coach</strong><small>私人备考工作台</small></span>
        </button>
        <nav aria-label="主导航">
          <button className={view === "overview" ? "active" : ""} onClick={() => setView("overview")}>概览</button>
          {isAdmin && <button className={view === "review" ? "active" : ""} onClick={() => setView("review")}>校对</button>}
          <button className={view === "practice" ? "active" : ""} onClick={() => openPractice()}>练习</button>
          {isAdmin && <button className={view === "agents" ? "active" : ""} onClick={() => setView("agents")}>AI 工作台</button>}
        </nav>
        <div className="account-actions"><div className="private-chip"><span /> {user.username} · {isAdmin ? "管理员" : hasFullAccess ? "完整题库" : "50 题体验"}</div><button onClick={logout}>退出</button></div>
      </header>

      {view === "overview" && (
        <main className="overview-page">
          <section className="hero-panel">
            <div>
              <p className="eyebrow">{hasFullAccess ? "完整题库与答案已接入" : "固定 50 题体验"}</p>
              <h1>{hasFullAccess ? "1210 道 AZ-104 / AZ-305 题目，电脑和手机都能练。" : "先用 50 道固定体验题，练习记录会一直保留。"}</h1>
              <p className="hero-copy">{hasFullAccess ? "题库包含 610 道 PDF 题和 600 道原创模拟题；可按考试与知识点随机练习。" : "注册后仍可查看和练习分配给你的 50 道题；获得管理员发放的专属 Key 后可解锁全部题目。"}</p>
              <div className="hero-actions">
                {isAdmin && <button className="primary-button" onClick={() => setView("review")}>开始校对</button>}
                <button className="secondary-button" onClick={() => openPractice()}>继续练习</button>
                <button className="secondary-button" onClick={() => openPractice(true)}>随机开始 20 题</button>
              </div>
            </div>
            {isAdmin && <div className="document-card">
              <div className="document-icon">PDF</div>
              <div><strong>{bundle.document.filename}</strong><p>{bundle.document.exam_code} · {bundle.document.page_count} 页 · 文本与图片混合</p></div>
              <span className="status-pill success">答案已导入</span>
            </div>}
          </section>

          {isAdmin && <section className="metric-grid" aria-label="导入统计">
            <article><span>PDF 题库</span><strong>{questions.length}</strong><small>覆盖至第 {lastSamplePage} 页</small></article>
            <article><span>待处理</span><strong>{questions.length - approved.length}</strong><small>未发布题目</small></article>
            <article><span>跨页题</span><strong>{crossPage}</strong><small>已自动合并来源页</small></article>
            <article><span>未结构化题</span><strong>{unknown}</strong><small>图片题已转为自评</small></article>
          </section>}

          <AccessPanel user={user} onUpgraded={() => router.refresh()} />
          {isAdmin && <AdminAccessPanel />}
          <OverviewTools isAdmin={isAdmin} onPractice={(examCode, points) => openPractice(true, "random", examCode, points)} onWrongPractice={() => openPractice(true, "wrong_book")} />

          {isAdmin && <section className="pipeline-card">
            <div className="section-heading"><div><p className="eyebrow">导入任务</p><h2>解析进度</h2></div><span className="status-pill success">首批候选已生成</span></div>
            <div className="pipeline">
              {["文件检查", "文本提取", "题目切分", "规则校验", "人工校对", "发布练习"].map((step, index) => (
                <div className={index < 4 ? "pipeline-step done" : "pipeline-step"} key={step}><span>{index < 4 ? "✓" : index + 1}</span><strong>{step}</strong></div>
              ))}
            </div>
            <div className="notice-card"><span>✓</span><div><strong>答案来自带讨论版 PDF</strong><p>系统按 PDF 标记直接导入，未进行额外正确性核对；图片交互题保留答案页供你自行对照。</p></div></div>
          </section>}
        </main>
      )}

      {isAdmin && view === "review" && current && (
        <main className="review-page">
          <div className="review-toolbar">
            <div><p className="eyebrow">{bundle.document.exam_code} · Topic {current.topic}</p><h1>{current.source_question_no}</h1></div>
            <div className="review-progress"><span>{currentIndex + 1} / {questions.length}</span><div><i style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }} /></div></div>
            <span className="save-message">{saveMessage}</span>
          </div>

          <div className="review-grid">
            <aside className="question-queue" aria-label="候选题列表">
              <div className="queue-summary"><strong>{approved.length}</strong> 已批准 <span>·</span> {questions.length - approved.length} 待处理</div>
              {questions.map((question, index) => (
                <button key={question.question_id} className={index === currentIndex ? "queue-item active" : "queue-item"} onClick={() => { setCurrentIndex(index); setSourcePageIndex(0); }}>
                  <span className={`queue-state ${question.status}`} />
                  <span><strong>{question.source_question_no}</strong><small>{typeLabels[question.type]} · 第 {question.source_pages.join("-")} 页</small></span>
                </button>
              ))}
            </aside>

            <section className="source-panel">
              <div className="panel-heading">
                <div><p className="eyebrow">来源证据</p><h2>PDF 第 {current.source_pages[sourcePageIndex]} 页</h2></div>
                <div className="page-switcher"><button disabled={sourcePageIndex === 0} onClick={() => setSourcePageIndex((i) => i - 1)}>←</button><span>{sourcePageIndex + 1}/{current.source_pages.length}</span><button disabled={sourcePageIndex === current.source_pages.length - 1} onClick={() => setSourcePageIndex((i) => i + 1)}>→</button></div>
              </div>
              <div className="pdf-canvas">
                <Image src={`/api/documents/${current.source_document_id}/pages/${current.source_pages[sourcePageIndex]}`} alt={`PDF 第 ${current.source_pages[sourcePageIndex]} 页`} fill sizes="(max-width: 900px) 100vw, 44vw" loading="eager" unoptimized />
              </div>
            </section>

            <section className="editor-panel">
              <div className="panel-heading"><div><p className="eyebrow">结构化结果</p><h2>{typeLabels[current.type]}</h2></div><span className={`status-pill ${current.status === "approved" ? "success" : "warning"}`}>{current.status === "approved" ? "已批准" : "待校对"}</span></div>
              <label className="field-label" htmlFor="stem">题干</label>
              <textarea id="stem" className="stem-editor" value={current.stem.display} onChange={(event) => updateQuestion({ ...current, stem: { ...current.stem, display: event.target.value }, status: "needs_review" })} />

              <div className="field-label row-label"><span>选项与正确答案</span><small>{current.type === "multiple_choice" ? "请选择至少两项" : "请选择一项"}</small></div>
              <div className="option-editor-list">
                {current.options.length === 0 && <div className="empty-options">未识别到文本选项。请先保留为图片题，后续人工改写。</div>}
                {current.options.map((option) => (
                  <div className="option-editor" key={option.id}>
                    <button aria-label={`设 ${option.label} 为正确答案`} className={current.correct_option_ids.includes(option.id) ? "answer-toggle selected" : "answer-toggle"} onClick={() => selectCorrectAnswer(option.id)}>{option.label}</button>
                    <textarea value={option.display} onChange={(event) => updateQuestion({ ...current, status: "needs_review", options: current.options.map((item) => item.id === option.id ? { ...item, display: event.target.value } : item) })} />
                  </div>
                ))}
              </div>

              <label className="field-label" htmlFor="answer-source">答案来源（批准必填）</label>
              <input
                id="answer-source"
                className="source-input"
                placeholder="例如：个人答案 PDF 第 12 页 / Microsoft Learn 验证"
                value={current.answer_provenance?.reference ?? ""}
                onChange={(event) => updateQuestion({
                  ...current,
                  answer_provenance: event.target.value ? makeManualProvenance(event.target.value) : null,
                  status: "needs_review",
                })}
              />

              <label className="field-label" htmlFor="answer-explanation">答案解析（批准必填）</label>
              <textarea
                id="answer-explanation"
                className="stem-editor"
                placeholder="说明为什么该选项正确，并指出其他选项不适用的关键原因。"
                value={current.explanation?.display ?? ""}
                onChange={(event) => updateQuestion({
                  ...current,
                  explanation: event.target.value ? {
                    raw: event.target.value,
                    display: event.target.value,
                    confidence: current.explanation?.confidence ?? 0,
                    reviewed: false,
                  } : null,
                  status: "needs_review",
                })}
              />

              <div className="quality-block"><strong>需要处理</strong><div className="flag-list">{current.quality.flags.map((flag) => <span key={flag}>{flagLabels[flag] ?? flag}</span>)}</div></div>
              <div className="editor-actions">
                <button className="secondary-button" disabled={saving} onClick={saveCurrent}>保存草稿</button>
                <button className="primary-button" disabled={saving} onClick={approveCurrent}>批准并下一题</button>
              </div>
            </section>
          </div>
        </main>
      )}

      {isAdmin && view === "agents" && <AgentMonitor />}

      {view === "practice" && (
        <main className="practice-page">
          {practiceQuestion && practiceSession && practiceItem ? (
            <section className="practice-card">
              <div className="practice-header"><button onClick={() => setView("overview")}>← 退出</button><div><strong>第 {practiceIndex + 1} / {practiceSession.items.length} 题</strong><span>{practiceSession.mode === "wrong_book" ? "错题本" : "随机 20 题"} · 正确率 {practiceSession.summary.accuracy}% · {formatDuration(practiceSession.summary.duration_ms)}</span></div><button className={practiceItem.is_marked ? "mark-button marked" : "mark-button"} onClick={toggleWrongBookMark}>{practiceItem.is_marked ? "★ 已标记" : "☆ 标记错题"}</button></div>
              <div className="mobile-progress"><i style={{ width: `${((practiceIndex + 1) / practiceSession.items.length) * 100}%` }} /></div>
              <p className="practice-topic">{practiceQuestion.exam_code} · {practiceQuestion.knowledge_points?.join(" · ") || `Topic ${practiceQuestion.topic}`}{practiceQuestion.difficulty ? ` · ${practiceQuestion.difficulty}` : ""}</p>
              <h1>{practiceQuestion.stem.display}</h1>
              {practiceQuestion.type === "image_interaction" && (
                <div className="practice-source-pages">
                  <strong>题目原页</strong>
                  {practiceQuestion.source_pages.map((page) => <img key={page} src={`/api/documents/${practiceQuestion.source_document_id}/pages/${page}`} alt={`题目来源第 ${page} 页`} />)}
                </div>
              )}
              {practiceQuestion.type === "image_interaction" && !practiceAnswerRevealed && !practiceResult && (
                <button className="secondary-button reveal-answer" onClick={() => setPracticeAnswerRevealed(true)}>显示 PDF 标记答案</button>
              )}
              {practiceQuestion.type === "image_interaction" && (practiceAnswerRevealed || practiceResult) && practiceQuestion.explanation?.answer_image_url && (
                <div className="practice-answer-image"><strong>带讨论版 PDF 标记答案</strong><img src={practiceQuestion.explanation.answer_image_url} alt="PDF 标记答案" /></div>
              )}
              <div className="practice-options">
                {(practiceQuestion.type !== "image_interaction" || practiceAnswerRevealed || practiceResult ? practiceQuestion.options : []).map((option) => {
                  const selected = practiceSelection.includes(option.id);
                  const isCorrect = Boolean(practiceResult?.correct_option_ids.includes(option.id));
                  const isWrong = Boolean(practiceResult && selected && !isCorrect);
                  return <button key={option.id} className={`${selected ? "selected" : ""} ${isCorrect ? "correct" : ""} ${isWrong ? "wrong" : ""}`} onClick={() => togglePracticeAnswer(option.id)}><span>{option.label}</span><p>{option.display}</p>{practiceResult && isCorrect && <b>✓</b>}</button>;
                })}
              </div>
              {practiceResult && <div className={practiceIsCorrect ? "answer-result correct" : "answer-result wrong"}><strong>{practiceQuestion.type === "image_interaction" ? (practiceIsCorrect ? "已记录为答对" : "已加入复习") : (practiceIsCorrect ? "回答正确" : "这次没有答对")}</strong><p>{practiceQuestion.explanation?.display ?? "该题暂未提供答案解析。"}</p></div>}
              {practiceError && <div className="answer-result wrong"><strong>同步失败</strong><p>{practiceError}</p></div>}
              <div className="practice-actions">{!practiceResult ? <button className="primary-button" disabled={practiceSelection.length === 0} onClick={submitPracticeAnswer}>{practiceQuestion.type === "image_interaction" ? "记录自评" : "确认答案"}</button> : <button className="primary-button" disabled={practiceIndex >= practiceSession.items.length - 1} onClick={nextPracticeQuestion}>{practiceIndex >= practiceSession.items.length - 1 ? `本组完成 · ${practiceSession.summary.accuracy}% · ${formatDuration(practiceSession.summary.duration_ms)}` : "下一题"}</button>}</div>
            </section>
          ) : (
            <section className="practice-empty"><div className="empty-icon">✓</div><p className="eyebrow">练习门禁正常工作</p><h1>还没有可练习的题目</h1><p>{practiceError || (isAdmin ? "请先在校对工作台批准题目。" : "当前筛选条件下没有可用的体验题，请返回概览重新选择。")}</p>{isAdmin && <button className="primary-button" onClick={() => setView("review")}>去校对第一题</button>}</section>
          )}
        </main>
      )}
    </div>
  );
}
