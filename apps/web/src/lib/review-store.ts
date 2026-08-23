import "server-only";

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { applyEditableReview, validatePublishable, type EditableReview } from "./review-domain";
import type { CandidateBundle, CandidateQuestion, ImportJob, PracticeFilters, PracticeItem, PracticeSession, StudySummary } from "./types";

const OWNER_ID = "00000000-0000-0000-0000-000000000001";

type SqliteRow = Record<string, unknown>;
type StoreGlobal = typeof globalThis & { __azExamDb?: DatabaseSync };

export class StoreError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

function now() {
  return new Date().toISOString();
}

function getDb() {
  const shared = globalThis as StoreGlobal;
  const privateDir = path.join(process.cwd(), "data", "private");
  mkdirSync(privateDir, { recursive: true });
  const db = shared.__azExamDb ?? new DatabaseSync(path.join(privateDir, "az-exam-coach.sqlite"));
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS source_documents (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL, exam_code TEXT NOT NULL, page_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source_document_id TEXT NOT NULL,
      topic INTEGER NOT NULL, source_question_no TEXT NOT NULL, source_start_page INTEGER NOT NULL,
      current_revision_id TEXT, created_at TEXT NOT NULL, archived_at TEXT,
      UNIQUE(source_document_id, source_start_page),
      FOREIGN KEY(source_document_id) REFERENCES source_documents(id)
    );
    CREATE TABLE IF NOT EXISTS question_drafts (
      question_id TEXT PRIMARY KEY, content_json TEXT NOT NULL, lock_version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL, FOREIGN KEY(question_id) REFERENCES questions(id)
    );
    CREATE TABLE IF NOT EXISTS question_revisions (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL, version_no INTEGER NOT NULL,
      content_json TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL,
      UNIQUE(question_id, version_no), FOREIGN KEY(question_id) REFERENCES questions(id)
    );
    CREATE TABLE IF NOT EXISTS answer_keys (
      id TEXT PRIMARY KEY, question_revision_id TEXT NOT NULL UNIQUE,
      option_ids_json TEXT NOT NULL, provenance_kind TEXT NOT NULL, provenance_reference TEXT NOT NULL,
      entered_by TEXT NOT NULL, entered_at TEXT NOT NULL,
      FOREIGN KEY(question_revision_id) REFERENCES question_revisions(id)
    );
    CREATE TABLE IF NOT EXISTS review_events (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL, revision_id TEXT, action TEXT NOT NULL,
      reviewer_id TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL,
      FOREIGN KEY(question_id) REFERENCES questions(id)
    );
    CREATE TABLE IF NOT EXISTS practice_sessions (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, exam_code TEXT NOT NULL,
      status TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'random', started_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS practice_items (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
      question_revision_id TEXT NOT NULL, answer_key_id TEXT NOT NULL,
      UNIQUE(session_id, ordinal),
      FOREIGN KEY(session_id) REFERENCES practice_sessions(id),
      FOREIGN KEY(question_revision_id) REFERENCES question_revisions(id),
      FOREIGN KEY(answer_key_id) REFERENCES answer_keys(id)
    );
    CREATE TABLE IF NOT EXISTS answer_events (
      id TEXT PRIMARY KEY, session_item_id TEXT NOT NULL UNIQUE,
      selected_option_ids_json TEXT NOT NULL, is_correct INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0, answered_at TEXT NOT NULL, received_at TEXT NOT NULL,
      FOREIGN KEY(session_item_id) REFERENCES practice_items(id)
    );
    CREATE TABLE IF NOT EXISTS wrong_book_items (
      owner_id TEXT NOT NULL, question_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(owner_id, question_id), FOREIGN KEY(question_id) REFERENCES questions(id)
    );
    CREATE TABLE IF NOT EXISTS user_question_entitlements (
      user_id TEXT NOT NULL, question_id TEXT NOT NULL, granted_at TEXT NOT NULL,
      PRIMARY KEY(user_id, question_id), FOREIGN KEY(question_id) REFERENCES questions(id)
    );
    CREATE TABLE IF NOT EXISTS question_taxonomy (
      question_id TEXT PRIMARY KEY, exam_code TEXT NOT NULL, difficulty TEXT,
      FOREIGN KEY(question_id) REFERENCES questions(id)
    );
    CREATE TABLE IF NOT EXISTS question_knowledge_points (
      question_id TEXT NOT NULL, knowledge_point TEXT NOT NULL,
      PRIMARY KEY(question_id, knowledge_point), FOREIGN KEY(question_id) REFERENCES questions(id)
    );
    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, sha256 TEXT NOT NULL,
      filename TEXT NOT NULL, exam_code TEXT NOT NULL, max_questions INTEGER NOT NULL,
      pipeline_version TEXT NOT NULL, source_path TEXT NOT NULL,
      status TEXT NOT NULL, stage TEXT NOT NULL,
      progress_current INTEGER, progress_total INTEGER,
      candidate_count INTEGER, page_count INTEGER, document_id TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
      lease_owner TEXT, lease_expires_at TEXT, error_summary TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT,
      UNIQUE(owner_id, sha256, exam_code, max_questions, pipeline_version)
    );
    CREATE INDEX IF NOT EXISTS import_jobs_status_idx
      ON import_jobs(status, lease_expires_at, created_at);
  `);
  const answerColumns = db.prepare("PRAGMA table_info(answer_events)").all() as SqliteRow[];
  if (!answerColumns.some((column) => String(column.name) === "duration_ms")) {
    db.exec("ALTER TABLE answer_events ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0");
  }
  const sessionColumns = db.prepare("PRAGMA table_info(practice_sessions)").all() as SqliteRow[];
  if (!sessionColumns.some((column) => String(column.name) === "mode")) {
    db.exec("ALTER TABLE practice_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'random'");
  }
  if (!sessionColumns.some((column) => String(column.name) === "filter_json")) {
    db.exec("ALTER TABLE practice_sessions ADD COLUMN filter_json TEXT NOT NULL DEFAULT '[]'");
  }
  shared.__azExamDb = db;
  return db;
}

function transaction<T>(work: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function ensurePreviewEntitlements(ownerId: string) {
  const existing = getDb().prepare(`SELECT COUNT(*) AS count FROM user_question_entitlements uqe
    JOIN questions q ON q.id = uqe.question_id
    WHERE uqe.user_id = ? AND q.current_revision_id IS NOT NULL`).get(ownerId) as SqliteRow;
  if (Number(existing.count) >= 50) return;
  transaction((db) => {
    const insert = db.prepare(`INSERT OR IGNORE INTO user_question_entitlements
      (user_id, question_id, granted_at) VALUES (?, ?, ?)`);
    for (const examCode of ["AZ-104", "AZ-305"]) {
      const current = db.prepare(`SELECT COUNT(*) AS count
        FROM user_question_entitlements uqe
        JOIN questions q ON q.id = uqe.question_id
        JOIN source_documents sd ON sd.id = q.source_document_id
        LEFT JOIN question_taxonomy qt ON qt.question_id = q.id
        WHERE uqe.user_id = ? AND q.current_revision_id IS NOT NULL
          AND COALESCE(qt.exam_code, sd.exam_code) = ?`)
        .get(ownerId, examCode) as SqliteRow;
      const needed = Math.max(0, 25 - Number(current.count));
      if (!needed) continue;
      const rows = db.prepare(`SELECT q.id FROM questions q
        JOIN source_documents sd ON sd.id = q.source_document_id
        LEFT JOIN question_taxonomy qt ON qt.question_id = q.id
        LEFT JOIN user_question_entitlements uqe
          ON uqe.question_id = q.id AND uqe.user_id = ?
        WHERE q.current_revision_id IS NOT NULL AND uqe.question_id IS NULL
          AND COALESCE(qt.exam_code, sd.exam_code) = ?
        ORDER BY random() LIMIT ?`).all(ownerId, examCode, needed) as SqliteRow[];
      for (const row of rows) insert.run(ownerId, String(row.id), now());
    }
    const total = db.prepare(`SELECT COUNT(*) AS count FROM user_question_entitlements uqe
      JOIN questions q ON q.id = uqe.question_id
      WHERE uqe.user_id = ? AND q.current_revision_id IS NOT NULL`)
      .get(ownerId) as SqliteRow;
    const remaining = Math.max(0, 50 - Number(total.count));
    if (remaining) {
      const rows = db.prepare(`SELECT q.id FROM questions q
        LEFT JOIN user_question_entitlements uqe
          ON uqe.question_id = q.id AND uqe.user_id = ?
        WHERE q.current_revision_id IS NOT NULL AND uqe.question_id IS NULL
        ORDER BY random() LIMIT ?`).all(ownerId, remaining) as SqliteRow[];
      for (const row of rows) insert.run(ownerId, String(row.id), now());
    }
  });
}

function seedBundle(bundle: CandidateBundle) {
  if (!bundle.document.document_id || bundle.candidates.length === 0) return;
  const documentId = bundle.document.document_id;
  transaction((db) => {
    db.prepare(`INSERT OR IGNORE INTO source_documents
      (id, owner_id, sha256, filename, exam_code, page_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(documentId, OWNER_ID, bundle.document.sha256 ?? documentId, bundle.document.filename,
        bundle.document.exam_code, bundle.document.page_count, now());
    const insertQuestion = db.prepare(`INSERT OR IGNORE INTO questions
      (id, owner_id, source_document_id, topic, source_question_no, source_start_page, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertDraft = db.prepare(`INSERT OR IGNORE INTO question_drafts
      (question_id, content_json, lock_version, updated_at) VALUES (?, ?, 1, ?)`);
    for (const question of bundle.candidates) {
      insertQuestion.run(question.question_id, OWNER_ID, question.source_document_id, question.topic,
        question.source_question_no, question.source_pages[0], now());
      insertDraft.run(question.question_id, JSON.stringify(question), now());
    }
  });
}

export function hydrateCandidateBundle(bundle: CandidateBundle): CandidateBundle {
  seedBundle(bundle);
  if (bundle.candidates.length === 0) return bundle;
  const rows = getDb().prepare("SELECT question_id, content_json, lock_version FROM question_drafts").all() as SqliteRow[];
  const drafts = new Map(rows.map((row) => [String(row.question_id), row]));
  const reviewVersions: Record<string, number> = {};
  const candidates = bundle.candidates.map((source) => {
    const row = drafts.get(source.question_id);
    if (!row) return source;
    reviewVersions[source.question_id] = Number(row.lock_version);
    return JSON.parse(String(row.content_json)) as CandidateQuestion;
  });
  return { ...bundle, candidates, review_versions: reviewVersions };
}

function getDraft(db: DatabaseSync, questionId: string) {
  const row = db.prepare("SELECT content_json, lock_version FROM question_drafts WHERE question_id = ?").get(questionId) as SqliteRow | undefined;
  if (!row) throw new StoreError("Question not found", 404);
  return { question: JSON.parse(String(row.content_json)) as CandidateQuestion, lockVersion: Number(row.lock_version) };
}

function assertVersion(actual: number, expected: number) {
  if (!Number.isInteger(expected) || actual !== expected) {
    throw new StoreError("题目已在其他页面更新，请重新载入", 409);
  }
}

export function saveDraft(questionId: string, editable: EditableReview, expectedLockVersion: number) {
  return transaction((db) => {
    const current = getDraft(db, questionId);
    assertVersion(current.lockVersion, expectedLockVersion);
    const question = applyEditableReview(current.question, editable);
    const nextVersion = current.lockVersion + 1;
    db.prepare("UPDATE question_drafts SET content_json = ?, lock_version = ?, updated_at = ? WHERE question_id = ?")
      .run(JSON.stringify(question), nextVersion, now(), questionId);
    db.prepare(`INSERT INTO review_events
      (id, question_id, action, reviewer_id, created_at) VALUES (?, ?, 'saved', ?, ?)`)
      .run(randomUUID(), questionId, OWNER_ID, now());
    return { question, lock_version: nextVersion };
  });
}

export function approveDraft(questionId: string, editable: EditableReview, expectedLockVersion: number) {
  return transaction((db) => {
    const current = getDraft(db, questionId);
    assertVersion(current.lockVersion, expectedLockVersion);
    let question = applyEditableReview(current.question, editable);
    question = {
      ...question,
      stem: { ...question.stem, reviewed: true },
      options: question.options.map((option) => ({ ...option, reviewed: true })),
      explanation: question.explanation ? { ...question.explanation, reviewed: true } : null,
    };
    const errors = validatePublishable(question);
    if (errors.length) throw new StoreError(errors.join("；"), 422);
    const provenance = question.answer_provenance;
    if (!provenance) throw new StoreError("必须填写可追溯的答案来源", 422);

    question = {
      ...question,
      status: "approved",
      answer_confidence: 1,
      quality: { ...question.quality, flags: question.quality.flags.filter((flag) => flag !== "answer_missing") },
      content_version: question.content_version + 1,
    };
    const revisionId = randomUUID();
    const answerKeyId = randomUUID();
    const versionRow = db.prepare("SELECT COALESCE(MAX(version_no), 0) AS version_no FROM question_revisions WHERE question_id = ?")
      .get(questionId) as SqliteRow;
    const versionNo = Number(versionRow.version_no) + 1;
    const revisionContent = { ...question, correct_option_ids: [], answer_provenance: null };
    db.prepare(`INSERT INTO question_revisions
      (id, question_id, version_no, content_json, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(revisionId, questionId, versionNo, JSON.stringify(revisionContent), now(), OWNER_ID);
    db.prepare(`INSERT INTO answer_keys
      (id, question_revision_id, option_ids_json, provenance_kind, provenance_reference, entered_by, entered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(answerKeyId, revisionId, JSON.stringify(question.correct_option_ids), provenance.kind,
        provenance.reference, OWNER_ID, now());
    db.prepare("UPDATE questions SET current_revision_id = ? WHERE id = ?").run(revisionId, questionId);
    const nextVersion = current.lockVersion + 1;
    db.prepare("UPDATE question_drafts SET content_json = ?, lock_version = ?, updated_at = ? WHERE question_id = ?")
      .run(JSON.stringify(question), nextVersion, now(), questionId);
    db.prepare(`INSERT INTO review_events
      (id, question_id, revision_id, action, reviewer_id, created_at) VALUES (?, ?, ?, 'approved', ?, ?)`)
      .run(randomUUID(), questionId, revisionId, OWNER_ID, now());
    return { question, lock_version: nextVersion, revision_id: revisionId };
  });
}

function practiceSessionFromDb(ownerId: string, fullAccess: boolean, sessionId: string): PracticeSession {
  const db = getDb();
  const session = db.prepare("SELECT * FROM practice_sessions WHERE id = ? AND owner_id = ?").get(sessionId, ownerId) as SqliteRow | undefined;
  if (!session) throw new StoreError("Practice session not found", 404);
  if (!fullAccess) {
    const inaccessible = db.prepare(`SELECT 1 AS found FROM practice_items pi
      JOIN question_revisions qr ON qr.id = pi.question_revision_id
      LEFT JOIN user_question_entitlements uqe
        ON uqe.question_id = qr.question_id AND uqe.user_id = ?
      WHERE pi.session_id = ? AND uqe.question_id IS NULL LIMIT 1`).get(ownerId, sessionId);
    if (inaccessible) throw new StoreError("当前权限无法访问这个练习组，请开始新的练习", 403);
  }
  const rows = db.prepare(`SELECT pi.id AS item_id, pi.ordinal, pi.question_revision_id,
      qr.content_json, ae.selected_option_ids_json, ae.is_correct, ae.duration_ms, ak.option_ids_json,
      CASE WHEN wbi.question_id IS NULL THEN 0 ELSE 1 END AS is_marked
    FROM practice_items pi
    JOIN question_revisions qr ON qr.id = pi.question_revision_id
    JOIN answer_keys ak ON ak.id = pi.answer_key_id
    LEFT JOIN answer_events ae ON ae.session_item_id = pi.id
    LEFT JOIN wrong_book_items wbi ON wbi.question_id = qr.question_id AND wbi.owner_id = ?
    WHERE pi.session_id = ? ORDER BY pi.ordinal`).all(ownerId, sessionId) as SqliteRow[];
  
  let correct = 0;
  const items: PracticeItem[] = rows.map((row) => {
    const full = JSON.parse(String(row.content_json)) as CandidateQuestion;
    const result = row.selected_option_ids_json == null ? null : {
      is_correct: Boolean(row.is_correct),
      selected_option_ids: JSON.parse(String(row.selected_option_ids_json)) as string[],
      correct_option_ids: JSON.parse(String(row.option_ids_json)) as string[],
    };
    if (result?.is_correct) correct += 1;
    return {
      item_id: String(row.item_id), ordinal: Number(row.ordinal),
      question_revision_id: String(row.question_revision_id),
      question: {
        question_id: full.question_id, source_document_id: full.source_document_id,
        source_question_no: full.source_question_no, source_pages: full.source_pages,
        type: full.type, stem: full.stem, options: full.options,
        explanation: result || full.type === "image_interaction" ? full.explanation : null,
        topic: full.topic, exam_code: full.exam_code,
        knowledge_points: full.knowledge_points, difficulty: full.difficulty,
      },
      result, is_marked: Boolean(row.is_marked),
    };
  });
  const answered = items.filter((item) => item.result).length;
  const durationMs = rows.reduce((sum, row) => sum + Number(row.duration_ms ?? 0), 0);
  return {
    session_id: String(session.id), status: String(session.status) as "active" | "completed",
    started_at: String(session.started_at), completed_at: session.completed_at ? String(session.completed_at) : null,
    mode: String(session.mode ?? "random") as "random" | "wrong_book",
    exam_code: String(session.exam_code) as "AZ-104" | "AZ-305",
    knowledge_points: JSON.parse(String(session.filter_json ?? "[]")) as string[],
    items, summary: { answered, correct, total: items.length, accuracy: answered ? Math.round((correct / answered) * 100) : 0, duration_ms: durationMs },
  };
}

export function startOrResumePractice(ownerId: string, fullAccess: boolean, examCode = "AZ-104", fresh = false, mode: "random" | "wrong_book" = "random", knowledgePoints: string[] = []) {
  if (!fullAccess) ensurePreviewEntitlements(ownerId);
  const normalizedPoints = [...new Set(knowledgePoints.map((point) => point.trim()).filter(Boolean))].sort();
  if (normalizedPoints.length > 20 || normalizedPoints.some((point) => point.length > 80)) {
    throw new StoreError("知识点筛选条件无效", 400);
  }
  const filterJson = JSON.stringify(normalizedPoints);
  const sessionId = transaction((tx) => {
    if (fresh) {
      tx.prepare("UPDATE practice_sessions SET status = 'completed', completed_at = ? WHERE owner_id = ? AND exam_code = ? AND mode = ? AND status = 'active'")
        .run(now(), ownerId, examCode, mode);
    }
    const accessibleActiveFilter = fullAccess ? "" : `AND NOT EXISTS (
      SELECT 1 FROM practice_items pi
      JOIN question_revisions qr ON qr.id = pi.question_revision_id
      LEFT JOIN user_question_entitlements uqe
        ON uqe.question_id = qr.question_id AND uqe.user_id = ?
      WHERE pi.session_id = ps.id AND uqe.question_id IS NULL
    )`;
    const active = tx.prepare(`SELECT ps.id FROM practice_sessions ps
      WHERE ps.owner_id = ? AND ps.exam_code = ? AND ps.status = 'active'
        AND ps.mode = ? AND ps.filter_json = ? ${accessibleActiveFilter}
      ORDER BY ps.started_at DESC LIMIT 1`)
      .get(ownerId, examCode, mode, filterJson, ...(!fullAccess ? [ownerId] : [])) as SqliteRow | undefined;
    if (active) {
      const activeId = String(active.id);
      return activeId;
    }
    const sourceFilter = mode === "wrong_book" ? `AND q.id IN (
      SELECT question_id FROM wrong_book_items WHERE owner_id = ?
      UNION
      SELECT qr2.question_id FROM answer_events ae2
      JOIN practice_items pi2 ON pi2.id = ae2.session_item_id
      JOIN question_revisions qr2 ON qr2.id = pi2.question_revision_id
      JOIN practice_sessions ps2 ON ps2.id = pi2.session_id
      WHERE ae2.is_correct = 0 AND ps2.owner_id = ?
    )` : "";
    const entitlementFilter = fullAccess ? "" : `AND EXISTS (
      SELECT 1 FROM user_question_entitlements uqe
      WHERE uqe.user_id = ? AND uqe.question_id = q.id
    )`;
    const pointFilter = normalizedPoints.length ? `AND EXISTS (
      SELECT 1 FROM question_knowledge_points qkp
      WHERE qkp.question_id = q.id AND qkp.knowledge_point IN (${normalizedPoints.map(() => "?").join(",")})
    )` : "";
    const approved = tx.prepare(`SELECT q.current_revision_id, ak.id AS answer_key_id
      FROM questions q JOIN answer_keys ak ON ak.question_revision_id = q.current_revision_id
      JOIN source_documents sd ON sd.id = q.source_document_id
      LEFT JOIN question_taxonomy qt ON qt.question_id = q.id
      WHERE q.owner_id = ? AND q.current_revision_id IS NOT NULL
      AND COALESCE(qt.exam_code, sd.exam_code) = ? ${pointFilter} ${entitlementFilter} ${sourceFilter}
      ORDER BY random() LIMIT 20`).all(...[
        OWNER_ID, examCode, ...normalizedPoints,
        ...(!fullAccess ? [ownerId] : []),
        ...(mode === "wrong_book" ? [ownerId, ownerId] : []),
      ]) as SqliteRow[];
    if (!approved.length) throw new StoreError(mode === "wrong_book" ? "错题本还是空的" : "还没有已批准题目", 409);
    const id = randomUUID();
    tx.prepare("INSERT INTO practice_sessions (id, owner_id, exam_code, status, mode, filter_json, started_at) VALUES (?, ?, ?, 'active', ?, ?, ?)")
      .run(id, ownerId, examCode, mode, filterJson, now());
    const insert = tx.prepare("INSERT INTO practice_items (id, session_id, ordinal, question_revision_id, answer_key_id) VALUES (?, ?, ?, ?, ?)");
    approved.forEach((row, index) => insert.run(
      randomUUID(), id, index + 1, String(row.current_revision_id), String(row.answer_key_id),
    ));
    return id;
  });
  return practiceSessionFromDb(ownerId, fullAccess, sessionId);
}

export function getPracticeFilters(ownerId: string, fullAccess: boolean): PracticeFilters {
  if (!fullAccess) ensurePreviewEntitlements(ownerId);
  const entitlementFilter = fullAccess ? "" : `AND EXISTS (
    SELECT 1 FROM user_question_entitlements uqe
    WHERE uqe.user_id = ? AND uqe.question_id = q.id
  )`;
  const entitlementParams = fullAccess ? [] : [ownerId];
  const rows = getDb().prepare(`SELECT exam_code, knowledge_point, COUNT(*) AS count FROM (
      SELECT COALESCE(qt.exam_code, sd.exam_code) AS exam_code,
        COALESCE(qkp.knowledge_point, 'Topic ' || q.topic) AS knowledge_point, q.id
      FROM questions q
      JOIN source_documents sd ON sd.id = q.source_document_id
      LEFT JOIN question_taxonomy qt ON qt.question_id = q.id
      LEFT JOIN question_knowledge_points qkp ON qkp.question_id = q.id
      WHERE q.owner_id = ? AND q.current_revision_id IS NOT NULL ${entitlementFilter}
    ) GROUP BY exam_code, knowledge_point ORDER BY exam_code, knowledge_point`).all(OWNER_ID, ...entitlementParams) as SqliteRow[];
  const exams = (["AZ-104", "AZ-305"] as const).map((examCode) => {
    const points = rows.filter((row) => String(row.exam_code) === examCode)
      .map((row) => ({ name: String(row.knowledge_point), count: Number(row.count) }));
    const totalRow = getDb().prepare(`SELECT COUNT(*) AS count FROM questions q
      JOIN source_documents sd ON sd.id = q.source_document_id
      LEFT JOIN question_taxonomy qt ON qt.question_id = q.id
      WHERE q.owner_id = ? AND q.current_revision_id IS NOT NULL
      AND COALESCE(qt.exam_code, sd.exam_code) = ? ${entitlementFilter}`).get(OWNER_ID, examCode, ...entitlementParams) as SqliteRow;
    return { exam_code: examCode, total: Number(totalRow.count), knowledge_points: points };
  }).filter((exam) => exam.total > 0);
  return { exams };
}

export function submitPracticeAnswer(ownerId: string, fullAccess: boolean, sessionId: string, itemId: string, eventId: string, selectedOptionIds: string[], durationMs = 0) {
  transaction((db) => {
    const entitlementJoin = fullAccess ? "" : `JOIN user_question_entitlements uqe
      ON uqe.question_id = qr.question_id AND uqe.user_id = ?`;
    const row = db.prepare(`SELECT pi.id, qr.content_json, ak.option_ids_json
      FROM practice_items pi JOIN question_revisions qr ON qr.id = pi.question_revision_id
      JOIN answer_keys ak ON ak.id = pi.answer_key_id
      JOIN practice_sessions ps ON ps.id = pi.session_id
      ${entitlementJoin}
      WHERE pi.id = ? AND pi.session_id = ? AND ps.owner_id = ?`)
      .get(...(!fullAccess ? [ownerId] : []), itemId, sessionId, ownerId) as SqliteRow | undefined;
    if (!row) throw new StoreError("Practice item not found", 404);
    const prior = db.prepare("SELECT id FROM answer_events WHERE session_item_id = ?").get(itemId) as SqliteRow | undefined;
    if (prior) return;
    const question = JSON.parse(String(row.content_json)) as CandidateQuestion;
    const allowed = new Set(question.options.map((option) => option.id));
    if (!selectedOptionIds.length || selectedOptionIds.some((id) => !allowed.has(id))) {
      throw new StoreError("答案包含无效选项", 422);
    }
    const correct = JSON.parse(String(row.option_ids_json)) as string[];
    const normalized = (items: string[]) => [...items].sort().join("|");
    db.prepare(`INSERT INTO answer_events
      (id, session_item_id, selected_option_ids_json, is_correct, duration_ms, answered_at, received_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(eventId, itemId, JSON.stringify(selectedOptionIds), normalized(selectedOptionIds) === normalized(correct) ? 1 : 0,
        Math.max(0, Math.min(3_600_000, Math.round(durationMs))), now(), now());
    const remaining = db.prepare(`SELECT COUNT(*) AS count FROM practice_items pi
      LEFT JOIN answer_events ae ON ae.session_item_id = pi.id
      WHERE pi.session_id = ? AND ae.id IS NULL`).get(sessionId) as SqliteRow;
    if (Number(remaining.count) === 0) {
      db.prepare("UPDATE practice_sessions SET status = 'completed', completed_at = ? WHERE id = ?").run(now(), sessionId);
    }
  });
  return practiceSessionFromDb(ownerId, fullAccess, sessionId);
}

export function setWrongBookMark(ownerId: string, fullAccess: boolean, sessionId: string, itemId: string, marked: boolean) {
  transaction((db) => {
    const entitlementJoin = fullAccess ? "" : `JOIN user_question_entitlements uqe
      ON uqe.question_id = qr.question_id AND uqe.user_id = ?`;
    const row = db.prepare(`SELECT qr.question_id FROM practice_items pi
      JOIN question_revisions qr ON qr.id = pi.question_revision_id
      JOIN practice_sessions ps ON ps.id = pi.session_id
      ${entitlementJoin}
      WHERE pi.id = ? AND pi.session_id = ? AND ps.owner_id = ?`)
      .get(...(!fullAccess ? [ownerId] : []), itemId, sessionId, ownerId) as SqliteRow | undefined;
    if (!row) throw new StoreError("Practice item not found", 404);
    if (marked) db.prepare("INSERT OR IGNORE INTO wrong_book_items (owner_id, question_id, created_at) VALUES (?, ?, ?)")
      .run(ownerId, String(row.question_id), now());
    else db.prepare("DELETE FROM wrong_book_items WHERE owner_id = ? AND question_id = ?")
      .run(ownerId, String(row.question_id));
  });
  return practiceSessionFromDb(ownerId, fullAccess, sessionId);
}

export function getPracticeSession(ownerId: string, fullAccess: boolean, sessionId: string) {
  return practiceSessionFromDb(ownerId, fullAccess, sessionId);
}

function importJobFromRow(row: SqliteRow): ImportJob {
  return {
    job_id: String(row.id), filename: String(row.filename),
    exam_code: String(row.exam_code) as "AZ-104" | "AZ-305",
    status: String(row.status) as ImportJob["status"], stage: String(row.stage),
    progress_current: row.progress_current == null ? null : Number(row.progress_current),
    progress_total: row.progress_total == null ? null : Number(row.progress_total),
    candidate_count: row.candidate_count == null ? null : Number(row.candidate_count),
    page_count: row.page_count == null ? null : Number(row.page_count),
    error_summary: row.error_summary == null ? null : String(row.error_summary),
    created_at: String(row.created_at), updated_at: String(row.updated_at),
  };
}

export function findImportJob(sha256: string, examCode: string, maxQuestions: number) {
  const row = getDb().prepare(`SELECT * FROM import_jobs
    WHERE owner_id = ? AND sha256 = ? AND exam_code = ? AND max_questions = ? AND pipeline_version = '0.2.0'`)
    .get(OWNER_ID, sha256, examCode, maxQuestions) as SqliteRow | undefined;
  return row ? importJobFromRow(row) : null;
}

export function createImportJob(input: {
  id: string; sha256: string; filename: string; examCode: "AZ-104" | "AZ-305";
  maxQuestions: number; sourcePath: string;
}) {
  const existing = findImportJob(input.sha256, input.examCode, input.maxQuestions);
  if (existing) return { job: existing, duplicate: true };
  try {
    getDb().prepare(`INSERT INTO import_jobs
      (id, owner_id, sha256, filename, exam_code, max_questions, pipeline_version,
       source_path, status, stage, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '0.2.0', ?, 'queued', 'queued', ?, ?)`)
      .run(input.id, OWNER_ID, input.sha256, input.filename, input.examCode,
        input.maxQuestions, input.sourcePath, now(), now());
  } catch {
    const raced = findImportJob(input.sha256, input.examCode, input.maxQuestions);
    if (raced) return { job: raced, duplicate: true };
    throw new StoreError("无法创建导入任务", 500);
  }
  return { job: getImportJob(input.id), duplicate: false };
}

export function getImportJob(jobId: string) {
  const row = getDb().prepare("SELECT * FROM import_jobs WHERE id = ? AND owner_id = ?")
    .get(jobId, OWNER_ID) as SqliteRow | undefined;
  if (!row) throw new StoreError("Import job not found", 404);
  return importJobFromRow(row);
}

export function listImportJobs() {
  const rows = getDb().prepare("SELECT * FROM import_jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT 10")
    .all(OWNER_ID) as SqliteRow[];
  return rows.map(importJobFromRow);
}

export function retryImportJob(jobId: string) {
  const result = getDb().prepare(`UPDATE import_jobs SET status = 'queued', stage = 'queued',
      error_summary = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
    WHERE id = ? AND owner_id = ? AND status = 'failed' AND attempt_count < max_attempts`)
    .run(now(), jobId, OWNER_ID);
  if (result.changes !== 1) throw new StoreError("任务当前不能重试", 409);
  return getImportJob(jobId);
}

export function documentExists(documentId: string) {
  return Boolean(getDb().prepare("SELECT 1 AS found FROM source_documents WHERE id = ? AND owner_id = ?")
    .get(documentId, OWNER_ID));
}

export function canAccessQuestion(ownerId: string, fullAccess: boolean, questionId: string) {
  if (!fullAccess) ensurePreviewEntitlements(ownerId);
  const entitlementJoin = fullAccess ? "" : `JOIN user_question_entitlements uqe
    ON uqe.question_id = q.id AND uqe.user_id = ?`;
  const params = fullAccess ? [questionId] : [ownerId, questionId];
  return Boolean(getDb().prepare(`SELECT 1 AS found FROM questions q
    ${entitlementJoin}
    WHERE q.id = ? AND q.current_revision_id IS NOT NULL LIMIT 1`).get(...params));
}

export function canAccessDocumentPage(ownerId: string, fullAccess: boolean, documentId: string, page: number) {
  if (!Number.isInteger(page) || page < 1) return false;
  if (fullAccess) {
    return Boolean(getDb().prepare(`SELECT 1 AS found FROM source_documents
      WHERE id = ? AND ? <= page_count LIMIT 1`).get(documentId, page));
  }
  ensurePreviewEntitlements(ownerId);
  return Boolean(getDb().prepare(`SELECT 1 AS found
    FROM user_question_entitlements uqe
    JOIN questions q ON q.id = uqe.question_id
    JOIN question_revisions qr ON qr.id = q.current_revision_id
    JOIN json_each(qr.content_json, '$.source_pages') source_page
    WHERE uqe.user_id = ? AND q.source_document_id = ?
      AND CAST(source_page.value AS INTEGER) = ? LIMIT 1`).get(ownerId, documentId, page));
}

export function getStudySummary(ownerId: string): StudySummary {
  const db = getDb();
  const sessions = db.prepare(`SELECT ps.id, ps.status, ps.mode, ps.started_at, ps.completed_at,
      COUNT(pi.id) AS total, COUNT(ae.id) AS answered,
      COALESCE(SUM(CASE WHEN ae.is_correct = 1 THEN 1 ELSE 0 END), 0) AS correct,
      COALESCE(SUM(ae.duration_ms), 0) AS duration_ms
    FROM practice_sessions ps
    LEFT JOIN practice_items pi ON pi.session_id = ps.id
    LEFT JOIN answer_events ae ON ae.session_item_id = pi.id
    WHERE ps.owner_id = ? GROUP BY ps.id ORDER BY ps.started_at DESC LIMIT 3`).all(ownerId) as SqliteRow[];
  const mapped = sessions.map((row) => ({
    session_id: String(row.id), status: String(row.status) as "active" | "completed",
    answered: Number(row.answered), correct: Number(row.correct), total: Number(row.total),
    accuracy: Number(row.answered) ? Math.round((Number(row.correct) / Number(row.answered)) * 100) : 0,
    duration_ms: Number(row.duration_ms), mode: String(row.mode ?? "random") as "random" | "wrong_book",
    started_at: String(row.started_at), completed_at: row.completed_at ? String(row.completed_at) : null,
  }));
  const wrong = db.prepare(`SELECT COUNT(*) AS count FROM (
    SELECT question_id FROM wrong_book_items WHERE owner_id = ?
    UNION
    SELECT qr.question_id FROM answer_events ae JOIN practice_items pi ON pi.id = ae.session_item_id
    JOIN question_revisions qr ON qr.id = pi.question_revision_id
    JOIN practice_sessions ps ON ps.id = pi.session_id
    WHERE ae.is_correct = 0 AND ps.owner_id = ?
  )`).get(ownerId, ownerId) as SqliteRow;
  const active = mapped.find((session) => session.status === "active" && session.mode === "random")
    ?? mapped.find((session) => session.status === "active") ?? null;
  return { active_session: active, wrong_question_count: Number(wrong.count), recent_sessions: mapped };
}

export function getHealthStatus() {
  const db = getDb();
  const result = db.prepare("SELECT 1 AS healthy").get() as SqliteRow;
  return { status: Number(result.healthy) === 1 ? "healthy" : "unhealthy", database: "ok" };
}
