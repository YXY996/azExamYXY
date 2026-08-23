import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync,
  renameSync, statSync, writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const jobId = process.argv[2];
if (!/^[0-9a-f-]{36}$/i.test(jobId ?? "")) process.exit(2);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(projectRoot, "apps", "web");
const privateRoot = path.join(webRoot, "data", "private");
const databasePath = path.join(privateRoot, "az-exam-coach.sqlite");
const userProfile = process.env.USERPROFILE ?? "";
const python = path.join(userProfile, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
const pdftoppm = path.join(userProfile, ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "native", "poppler", "Library", "bin", "pdftoppm.exe");
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");

const utcNow = () => new Date().toISOString();
// Each long-running stage refreshes the lease before it starts. Thirty minutes
// covers the current extraction/render timeouts without leaving a crashed job
// unavailable for hours.
const leaseUntil = () => new Date(Date.now() + 30 * 60 * 1000).toISOString();

function fail(message) {
  db.prepare(`UPDATE import_jobs SET status='failed', stage='failed', error_summary=?,
    lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=? AND lease_owner=?`)
    .run(String(message).slice(0, 300), utcNow(), jobId, runnerId);
}

function stage(status, current = null, total = null) {
  db.prepare(`UPDATE import_jobs SET status=?, stage=?, progress_current=?, progress_total=?,
    lease_expires_at=?, updated_at=? WHERE id=? AND lease_owner=?`)
    .run(status, status, current, total, leaseUntil(), utcNow(), jobId, runnerId);
}

const runnerId = randomUUID();
db.exec("BEGIN IMMEDIATE");
let job;
try {
  job = db.prepare("SELECT * FROM import_jobs WHERE id=?").get(jobId);
  if (!job || ["review_ready", "failed"].includes(String(job.status))) {
    db.exec("ROLLBACK");
    db.close();
    process.exit(0);
  }
  const leaseActive = job.lease_expires_at && String(job.lease_expires_at) > utcNow();
  if (job.lease_owner && leaseActive) {
    db.exec("ROLLBACK");
    db.close();
    process.exit(0);
  }
  if (Number(job.attempt_count) >= Number(job.max_attempts)) {
    db.prepare("UPDATE import_jobs SET status='failed', stage='failed', error_summary='已达到最大重试次数', updated_at=? WHERE id=?")
      .run(utcNow(), jobId);
    db.exec("COMMIT");
    db.close();
    process.exit(1);
  }
  db.prepare(`UPDATE import_jobs SET status='validating', stage='validating',
    attempt_count=attempt_count+1, lease_owner=?, lease_expires_at=?, error_summary=NULL, updated_at=? WHERE id=?`)
    .run(runnerId, leaseUntil(), utcNow(), jobId);
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

try {
  if (!existsSync(python) || !existsSync(pdftoppm)) throw new Error("本机 PDF 运行环境不可用");
  const sourcePath = String(job.source_path);
  const sourceSize = statSync(sourcePath).size;
  if (sourceSize < 5 || sourceSize > 100 * 1024 * 1024) throw new Error("PDF 文件大小不符合限制");
  const sourceHandle = openSync(sourcePath, "r");
  const sourceHeader = Buffer.alloc(Math.min(1024, sourceSize));
  readSync(sourceHandle, sourceHeader, 0, sourceHeader.length, 0);
  closeSync(sourceHandle);
  if (!sourceHeader.includes(Buffer.from("%PDF-"))) throw new Error("文件不是有效 PDF");

  const stagingRoot = path.join(privateRoot, "staging", jobId);
  const outputPath = path.join(stagingRoot, "candidates.json");
  const stagingPages = path.join(stagingRoot, "pages");
  mkdirSync(stagingPages, { recursive: true });

  stage("extracting");
  const pythonResult = spawnSync(python, [
    "-m", "az_exam_importer.cli", sourcePath,
    "--output", outputPath,
    "--max-questions", String(job.max_questions),
    "--exam-code", String(job.exam_code),
    "--schema", path.join(projectRoot, "contracts", "question-candidate.schema.json"),
  ], {
    cwd: projectRoot, shell: false, windowsHide: true, timeout: 5 * 60 * 1000,
    maxBuffer: 1024 * 1024,
    env: {
      SystemRoot: process.env.SystemRoot, USERPROFILE: userProfile,
      TEMP: process.env.TEMP, TMP: process.env.TMP,
      PYTHONPATH: path.join(projectRoot, "worker", "src"),
    },
  });
  if (pythonResult.status !== 0 || !existsSync(outputPath)) throw new Error("题目提取失败或超时");

  const bundle = JSON.parse(readFileSync(outputPath, "utf8"));
  if (bundle.document?.sha256?.toLowerCase() !== String(job.sha256).toLowerCase()) throw new Error("解析结果与上传文件指纹不一致");
  if (!Array.isArray(bundle.candidates) || bundle.candidates.length < 1) throw new Error("没有识别到候选题");
  const pageCount = Number(bundle.document.page_count);
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 2000) throw new Error("PDF 页数超出限制");
  const sourcePages = bundle.candidates.flatMap((candidate) => candidate.source_pages ?? []);
  if (sourcePages.some((page) => !Number.isInteger(page) || page < 1 || page > pageCount)) throw new Error("候选题来源页越界");
  const lastPage = Math.max(...sourcePages);

  stage("rendering", 0, lastPage);
  const renderResult = spawnSync(pdftoppm, [
    "-f", "1", "-l", String(lastPage), "-r", "96", "-png", sourcePath, path.join(stagingPages, "page"),
  ], { cwd: stagingRoot, shell: false, windowsHide: true, timeout: 15 * 60 * 1000, maxBuffer: 1024 * 1024 });
  if (renderResult.status !== 0) throw new Error("PDF 页面渲染失败或超时");
  for (const filename of readdirSync(stagingPages)) {
    const match = /^page-(\d+)\.png$/i.exec(filename);
    if (!match) continue;
    const normalized = `page-${String(Number(match[1])).padStart(4, "0")}.png`;
    if (filename !== normalized) renameSync(path.join(stagingPages, filename), path.join(stagingPages, normalized));
  }
  for (let page = 1; page <= lastPage; page += 1) {
    const imagePath = path.join(stagingPages, `page-${String(page).padStart(4, "0")}.png`);
    if (!existsSync(imagePath) || statSync(imagePath).size < 8
      || !readFileSync(imagePath).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error(`页面 ${page} 渲染结果无效`);
    }
  }

  stage("committing", lastPage, lastPage);
  const documentId = String(bundle.document.document_id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(documentId)) {
    throw new Error("解析结果中的文档 ID 无效");
  }
  const documentRoot = path.join(privateRoot, "documents", documentId);
  const finalPages = path.join(documentRoot, "pages");
  mkdirSync(documentRoot, { recursive: true });
  if (!existsSync(finalPages)) {
    renameSync(stagingPages, finalPages);
  } else {
    // A later full import of the same document may extend an earlier sample.
    // Promote every missing or changed page idempotently before publishing the job.
    mkdirSync(finalPages, { recursive: true });
    for (let page = 1; page <= lastPage; page += 1) {
      const filename = `page-${String(page).padStart(4, "0")}.png`;
      const sourceImage = path.join(stagingPages, filename);
      const finalImage = path.join(finalPages, filename);
      if (!existsSync(finalImage) || statSync(finalImage).size !== statSync(sourceImage).size) {
        copyFileSync(sourceImage, finalImage);
      }
    }
  }
  for (let page = 1; page <= lastPage; page += 1) {
    const finalImage = path.join(finalPages, `page-${String(page).padStart(4, "0")}.png`);
    if (!existsSync(finalImage) || statSync(finalImage).size < 8
      || !readFileSync(finalImage).subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error(`最终页面 ${page} 晋升失败`);
    }
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT OR IGNORE INTO source_documents
      (id, owner_id, sha256, filename, exam_code, page_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(documentId, "00000000-0000-0000-0000-000000000001", bundle.document.sha256,
        bundle.document.filename, bundle.document.exam_code, pageCount, utcNow());
    const insertQuestion = db.prepare(`INSERT OR IGNORE INTO questions
      (id, owner_id, source_document_id, topic, source_question_no, source_start_page, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const insertDraft = db.prepare(`INSERT OR IGNORE INTO question_drafts
      (question_id, content_json, lock_version, updated_at) VALUES (?, ?, 1, ?)`);
    for (const question of bundle.candidates) {
      insertQuestion.run(question.question_id, "00000000-0000-0000-0000-000000000001",
        documentId, question.topic, question.source_question_no, question.source_pages[0], utcNow());
      insertDraft.run(question.question_id, JSON.stringify(question), utcNow());
    }
    db.prepare(`UPDATE import_jobs SET document_id=?, candidate_count=?, page_count=?,
      progress_current=?, progress_total=?, updated_at=? WHERE id=? AND lease_owner=?`)
      .run(documentId, bundle.candidates.length, pageCount, lastPage, lastPage, utcNow(), jobId, runnerId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const pointerPath = path.join(privateRoot, "active-import.json");
  const pointerTemp = path.join(privateRoot, `.active-import.${jobId}.tmp`);
  writeFileSync(pointerTemp, JSON.stringify({ candidate_path: outputPath, document_id: documentId }), { encoding: "utf8", flag: "wx" });
  renameSync(pointerTemp, pointerPath);
  db.prepare(`UPDATE import_jobs SET status='review_ready', stage='review_ready', completed_at=?,
    lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=? AND lease_owner=?`)
    .run(utcNow(), utcNow(), jobId, runnerId);
} catch (error) {
  fail(error instanceof Error ? error.message : "导入失败");
  process.exitCode = 1;
} finally {
  db.close();
}
