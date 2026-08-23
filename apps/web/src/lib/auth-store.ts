import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { validateRegistration } from "./auth-domain";

function databasePath() {
  return process.env.APP_AUTH_DATABASE_PATH ?? path.join(process.cwd(), "data", "private", "az-exam-coach.sqlite");
}

function db() {
  const filename = databasePath();
  mkdirSync(path.dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL, created_at TEXT NOT NULL
    );`);
  return database;
}

export function registrationAvailable() {
  const database = db();
  try { return Number((database.prepare("SELECT COUNT(*) AS count FROM app_users").get() as { count: number }).count) === 0; }
  finally { database.close(); }
}

export function registerFirstUser(username: string, password: string) {
  const errors = validateRegistration(username, password);
  if (errors.length) throw new Error(errors.join("；"));
  const database = db();
  try {
    database.exec("BEGIN IMMEDIATE");
    if (Number((database.prepare("SELECT COUNT(*) AS count FROM app_users").get() as { count: number }).count) !== 0) {
      throw new Error("注册已关闭，请使用现有账号登录");
    }
    const salt = randomBytes(16).toString("hex");
    const hash = scryptSync(password, salt, 64).toString("hex");
    const id = randomUUID();
    database.prepare("INSERT INTO app_users (id, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, username, hash, salt, new Date().toISOString());
    database.exec("COMMIT");
    return { id, username };
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* transaction may not have started */ }
    throw error;
  } finally { database.close(); }
}

export function authenticateUser(username: string, password: string) {
  const database = db();
  try {
    const row = database.prepare("SELECT id, username, password_hash, password_salt FROM app_users WHERE username = ?")
      .get(username) as { id: string; username: string; password_hash: string; password_salt: string } | undefined;
    const expected = row ? Buffer.from(row.password_hash, "hex") : Buffer.alloc(64);
    const actual = scryptSync(password, row?.password_salt ?? "missing-user-salt", 64);
    return row && expected.length === actual.length && timingSafeEqual(expected, actual) ? { id: row.id, username: row.username } : null;
  } finally { database.close(); }
}
