import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const sourceFiles = process.argv.slice(2);
if (!sourceFiles.length) {
  throw new Error("Usage: node scripts/import-markdown-question-banks.mjs <bank.md> [bank2.md]");
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function stableUuid(value) {
  const hex = sha256(value).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function parseBank(filename) {
  const text = readFileSync(filename, "utf8");
  const lines = text.split(/\r?\n/);
  const starts = lines.map((line, index) => /^##\s+(AZ(?:104|305)(?:-V2)?-\d+)｜/.test(line) ? index : -1).filter((index) => index >= 0);
  const questions = starts.map((start, questionIndex) => {
    const end = starts[questionIndex + 1] ?? lines.length;
    const heading = lines[start].replace(/^##\s+/, "");
    const parts = heading.split("｜").map((part) => part.trim());
    const sourceQuestionNo = parts[0];
    const examCode = sourceQuestionNo.startsWith("AZ104") ? "AZ-104" : "AZ-305";
    const difficultyPart = parts.find((part) => part.startsWith("难度："));
    const difficulty = difficultyPart?.slice(3).trim() || "medium";
    const block = lines.slice(start + 1, end);
    const optionIndexes = block.map((line, index) => /^- [A-D]\.\s+/.test(line) ? index : -1).filter((index) => index >= 0);
    const firstOption = optionIndexes[0];
    const stem = block.slice(0, firstOption).map((line) => line.trim()).filter(Boolean).join("\n");
    const options = optionIndexes.map((index) => {
      const match = block[index].match(/^- ([A-D])\.\s+(.+)$/);
      return { label: match[1], text: match[2].trim() };
    });
    const answerLine = block.find((line) => /^\*\*(?:正确)?答案：/.test(line));
    const answer = answerLine?.match(/^\*\*(?:正确)?答案：\s*([A-D])/)?.[1];
    const explanation = block.find((line) => line.startsWith("**解析：**"))?.replace("**解析：**", "").trim();
    const tagLine = block.find((line) => /^\*\*(?:知识点标签|标签)：\*\*/.test(line)) ?? "";
    const tags = [...tagLine.matchAll(/`([^`]+)`/g)].map((match) => match[1].trim())
      .filter((tag) => tag && tag !== "AZ104" && tag !== "AZ305");
    const headingPoints = parts.slice(1).filter((part) => !part.startsWith("难度："));
    const knowledgePoints = [...new Set([...headingPoints, ...tags])];
    if (!stem || options.length !== 4 || !answer || !explanation || !knowledgePoints.length) {
      throw new Error(`${path.basename(filename)} ${sourceQuestionNo}: incomplete question structure`);
    }
    if (!options.some((option) => option.label === answer)) {
      throw new Error(`${path.basename(filename)} ${sourceQuestionNo}: answer ${answer} is not an option`);
    }
    return { sourceQuestionNo, examCode, difficulty, stem, options, answer, explanation, knowledgePoints };
  });
  if (questions.length !== 300) throw new Error(`${path.basename(filename)}: expected 300 questions, found ${questions.length}`);
  if (new Set(questions.map((question) => question.sourceQuestionNo)).size !== questions.length) {
    throw new Error(`${path.basename(filename)}: duplicate question identifiers`);
  }
  return { filename, text, sha: sha256(text), questions };
}

const banks = sourceFiles.map(parseBank);
const allIds = banks.flatMap((bank) => bank.questions.map((question) => question.sourceQuestionNo));
if (new Set(allIds).size !== allIds.length) throw new Error("Question identifiers overlap between Markdown banks");

const projectRoot = path.resolve(import.meta.dirname, "..");
const privateDir = path.join(projectRoot, "apps", "web", "data", "private");
const databasePath = path.join(privateDir, "az-exam-coach.sqlite");
mkdirSync(path.join(privateDir, "backups"), { recursive: true });
const backupPath = path.join(privateDir, "backups", `before-markdown-import-${new Date().toISOString().replace(/[:.]/g, "-")}.sqlite`);

const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;");
db.exec(`CREATE TABLE IF NOT EXISTS question_taxonomy (
  question_id TEXT PRIMARY KEY, exam_code TEXT NOT NULL, difficulty TEXT,
  FOREIGN KEY(question_id) REFERENCES questions(id));
CREATE TABLE IF NOT EXISTS question_knowledge_points (
  question_id TEXT NOT NULL, knowledge_point TEXT NOT NULL,
  PRIMARY KEY(question_id, knowledge_point), FOREIGN KEY(question_id) REFERENCES questions(id));`);
db.exec("PRAGMA wal_checkpoint(FULL)");
copyFileSync(databasePath, backupPath);

const timestamp = new Date().toISOString();
const topicNumbers = new Map();
let nextTopic = 100;
let inserted = 0;
db.exec("BEGIN IMMEDIATE");
try {
  for (const bank of banks) {
    const documentId = stableUuid(`markdown-document:${bank.sha}`);
    db.prepare(`INSERT OR IGNORE INTO source_documents
      (id, owner_id, sha256, filename, exam_code, page_count, created_at)
      VALUES (?, ?, ?, ?, 'AZ-104/AZ-305', ?, ?)`)
      .run(documentId, OWNER_ID, bank.sha, path.basename(bank.filename), bank.questions.length, timestamp);
    for (const [index, parsed] of bank.questions.entries()) {
      const questionId = stableUuid(`markdown-question:${bank.sha}:${parsed.sourceQuestionNo}`);
      const exists = db.prepare("SELECT 1 AS found FROM questions WHERE id = ?").get(questionId);
      const primaryPoint = parsed.knowledgePoints[0];
      const topicKey = `${parsed.examCode}:${primaryPoint}`;
      if (!topicNumbers.has(topicKey)) topicNumbers.set(topicKey, nextTopic++);
      const options = parsed.options.map((option) => ({
        id: stableUuid(`${questionId}:option:${option.label}`), label: option.label,
        raw: option.text, display: option.text, confidence: 1, reviewed: true,
      }));
      const correctOptionIds = options.filter((option) => option.label === parsed.answer).map((option) => option.id);
      const fullQuestion = {
        schema_version: "1.0.0", question_id: questionId, bank_id: documentId,
        exam_code: parsed.examCode, source_document_id: documentId,
        source_question_no: parsed.sourceQuestionNo, type: "single_choice", status: "approved",
        stem: { raw: parsed.stem, display: parsed.stem, confidence: 1, reviewed: true },
        options, correct_option_ids: correctOptionIds, answer_confidence: 1,
        answer_provenance: { kind: "source_document", reference: `${path.basename(bank.filename)}#${parsed.sourceQuestionNo}`, confirmed_at: timestamp, confirmed_by: "markdown-import" },
        explanation: { raw: parsed.explanation, display: parsed.explanation, confidence: 1, reviewed: true },
        source_spans: [{ page: index + 1, bbox: [], extractor: "markdown", text: parsed.stem, confidence: 1 }],
        quality: { overall_confidence: 1, flags: [] }, content_version: 1,
        topic: topicNumbers.get(topicKey), knowledge_points: parsed.knowledgePoints,
        difficulty: parsed.difficulty, source_pages: [index + 1],
      };
      db.prepare(`INSERT OR IGNORE INTO questions
        (id, owner_id, source_document_id, topic, source_question_no, source_start_page, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(questionId, OWNER_ID, documentId, fullQuestion.topic, parsed.sourceQuestionNo, index + 1, timestamp);
      db.prepare(`INSERT OR IGNORE INTO question_drafts
        (question_id, content_json, lock_version, updated_at) VALUES (?, ?, 1, ?)`)
        .run(questionId, JSON.stringify(fullQuestion), timestamp);
      const revisionId = stableUuid(`${questionId}:revision:1`);
      const revisionContent = { ...fullQuestion, correct_option_ids: [], answer_provenance: null };
      db.prepare(`INSERT OR IGNORE INTO question_revisions
        (id, question_id, version_no, content_json, created_at, created_by) VALUES (?, ?, 1, ?, ?, ?)`)
        .run(revisionId, questionId, JSON.stringify(revisionContent), timestamp, OWNER_ID);
      db.prepare(`INSERT OR IGNORE INTO answer_keys
        (id, question_revision_id, option_ids_json, provenance_kind, provenance_reference, entered_by, entered_at)
        VALUES (?, ?, ?, 'source_document', ?, ?, ?)`)
        .run(stableUuid(`${revisionId}:answer`), revisionId, JSON.stringify(correctOptionIds), `${path.basename(bank.filename)}#${parsed.sourceQuestionNo}`, OWNER_ID, timestamp);
      db.prepare("UPDATE questions SET current_revision_id = ? WHERE id = ?").run(revisionId, questionId);
      db.prepare(`INSERT INTO question_taxonomy (question_id, exam_code, difficulty) VALUES (?, ?, ?)
        ON CONFLICT(question_id) DO UPDATE SET exam_code = excluded.exam_code, difficulty = excluded.difficulty`)
        .run(questionId, parsed.examCode, parsed.difficulty);
      const insertPoint = db.prepare("INSERT OR IGNORE INTO question_knowledge_points (question_id, knowledge_point) VALUES (?, ?)");
      for (const point of parsed.knowledgePoints) insertPoint.run(questionId, point);
      if (!exists) inserted += 1;
    }
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}

console.log(JSON.stringify({ validated: allIds.length, inserted, backup: backupPath }));
