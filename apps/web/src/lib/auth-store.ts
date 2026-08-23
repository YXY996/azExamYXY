import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateRegistration } from "./auth-domain";

export type UserRole = "admin" | "user";
export type AccessTier = "full" | "preview";
export type AppUser = { id: string; username: string; role: UserRole; access_tier: AccessTier; created_at: string };
type UserRow = AppUser & { password_hash: string; password_salt: string };
type KeyStatus = "pending" | "redeemed" | "revoked";

function databasePath() { return process.env.APP_AUTH_DATABASE_PATH ?? path.join(process.cwd(), "data", "private", "az-exam-coach.sqlite"); }
function hasColumn(database: DatabaseSync, table: string, column: string) {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column);
}
function hasTable(database: DatabaseSync, table: string) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}
function db() {
  const filename = databasePath(); mkdirSync(path.dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS app_users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL);`);
  if (!hasColumn(database, "app_users", "role")) database.exec("ALTER TABLE app_users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  if (!hasColumn(database, "app_users", "access_tier")) database.exec("ALTER TABLE app_users ADD COLUMN access_tier TEXT NOT NULL DEFAULT 'preview'");
  database.exec(`CREATE TABLE IF NOT EXISTS access_keys (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','redeemed','revoked')),
    created_by TEXT NOT NULL REFERENCES app_users(id), created_at TEXT NOT NULL,
    redeemed_at TEXT, revoked_at TEXT);
    CREATE INDEX IF NOT EXISTS access_keys_user_idx ON access_keys(user_id, created_at DESC);`);
  const first = database.prepare("SELECT id FROM app_users ORDER BY created_at, rowid LIMIT 1").get() as { id: string } | undefined;
  if (first) {
    database.prepare("UPDATE app_users SET role='admin', access_tier='full' WHERE id=?").run(first.id);
    // Preserve the original single-user history when owner-aware access is enabled.
    if (hasTable(database, "practice_sessions")) database.prepare("UPDATE practice_sessions SET owner_id=? WHERE owner_id='00000000-0000-0000-0000-000000000001'").run(first.id);
    if (hasTable(database, "wrong_book_items")) database.prepare("UPDATE wrong_book_items SET owner_id=? WHERE owner_id='00000000-0000-0000-0000-000000000001'").run(first.id);
  }
  return database;
}

function publicUser(row: Pick<UserRow, "id" | "username" | "role" | "access_tier" | "created_at">): AppUser {
  return { id: row.id, username: row.username, role: row.role, access_tier: row.access_tier, created_at: row.created_at };
}

export function registrationAvailable() { return true; }
export function registerUser(username: string, password: string) {
  const errors = validateRegistration(username, password); if (errors.length) throw new Error(errors.join("；"));
  const database = db();
  try {
    database.exec("BEGIN IMMEDIATE");
    const first = Number((database.prepare("SELECT COUNT(*) count FROM app_users").get() as { count: number }).count) === 0;
    const salt = randomBytes(16).toString("hex"), hash = scryptSync(password, salt, 64).toString("hex");
    const user: AppUser = { id: randomUUID(), username, role: first ? "admin" : "user", access_tier: first ? "full" : "preview", created_at: new Date().toISOString() };
    database.prepare("INSERT INTO app_users(id,username,password_hash,password_salt,created_at,role,access_tier) VALUES(?,?,?,?,?,?,?)")
      .run(user.id, user.username, hash, salt, user.created_at, user.role, user.access_tier);
    database.exec("COMMIT"); return user;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { }
    if (error instanceof Error && /UNIQUE constraint failed: app_users\.username/.test(error.message)) throw new Error("用户名已存在");
    throw error;
  } finally { database.close(); }
}
export const registerFirstUser = registerUser;

export function authenticateUser(username: string, password: string) {
  const database = db();
  try {
    const row = database.prepare("SELECT * FROM app_users WHERE username=?").get(username) as UserRow | undefined;
    const expected = row ? Buffer.from(row.password_hash, "hex") : Buffer.alloc(64);
    const actual = scryptSync(password, row?.password_salt ?? "missing-user-salt", 64);
    return row && expected.length === actual.length && timingSafeEqual(expected, actual) ? publicUser(row) : null;
  } finally { database.close(); }
}
export function getUserById(id: string) {
  const database = db(); try { const row = database.prepare("SELECT id,username,role,access_tier,created_at FROM app_users WHERE id=?").get(id) as UserRow | undefined; return row ? publicUser(row) : null; } finally { database.close(); }
}
export function listUsers() {
  const database = db(); try { return (database.prepare("SELECT id,username,role,access_tier,created_at FROM app_users ORDER BY created_at").all() as UserRow[]).map(publicUser); } finally { database.close(); }
}
function keyHash(key: string) { return createHash("sha256").update(key).digest("hex"); }

export function createAccessKey(adminId: string, userId: string) {
  const database = db();
  try {
    database.exec("BEGIN IMMEDIATE");
    const admin = database.prepare("SELECT role FROM app_users WHERE id=?").get(adminId) as { role: UserRole } | undefined;
    if (admin?.role !== "admin") throw new Error("仅管理员可以创建访问 Key");
    const target = database.prepare("SELECT role FROM app_users WHERE id=?").get(userId) as { role: UserRole } | undefined;
    if (!target) throw new Error("目标用户不存在"); if (target.role === "admin") throw new Error("管理员无需访问 Key");
    const now = new Date().toISOString();
    database.prepare("UPDATE access_keys SET status='revoked',revoked_at=? WHERE user_id=? AND status='pending'").run(now, userId);
    const key = `AZEX-${randomBytes(24).toString("base64url")}`, id = randomUUID(), prefix = key.slice(0, 13);
    database.prepare("INSERT INTO access_keys(id,user_id,key_hash,key_prefix,status,created_by,created_at) VALUES(?,?,?,?,'pending',?,?)")
      .run(id, userId, keyHash(key), prefix, adminId, now);
    database.exec("COMMIT"); return { id, user_id: userId, key, key_prefix: prefix, status: "pending" as const, created_at: now };
  } catch (error) { try { database.exec("ROLLBACK"); } catch { } throw error; } finally { database.close(); }
}
export function listAccessKeys(adminId: string) {
  const database = db(); try {
    const admin = database.prepare("SELECT role FROM app_users WHERE id=?").get(adminId) as { role: UserRole } | undefined;
    if (admin?.role !== "admin") throw new Error("仅管理员可以查看访问 Key");
    return database.prepare(`SELECT k.id,k.user_id,u.username,k.key_prefix,k.status,k.created_at,k.redeemed_at,k.revoked_at FROM access_keys k JOIN app_users u ON u.id=k.user_id ORDER BY k.created_at DESC`).all() as Array<{id:string;user_id:string;username:string;key_prefix:string;status:KeyStatus;created_at:string;redeemed_at:string|null;revoked_at:string|null}>;
  } finally { database.close(); }
}
export function redeemAccessKey(userId: string, rawKey: string) {
  const key = rawKey.trim(); if (!/^AZEX-[A-Za-z0-9_-]{32}$/.test(key)) throw new Error("访问 Key 格式不正确");
  const database = db();
  try {
    database.exec("BEGIN IMMEDIATE");
    const row = database.prepare("SELECT id,user_id,status FROM access_keys WHERE key_hash=?").get(keyHash(key)) as {id:string;user_id:string;status:KeyStatus}|undefined;
    if (!row || row.user_id !== userId) throw new Error("此访问 Key 不属于当前用户");
    if (row.status !== "pending") throw new Error(row.status === "redeemed" ? "访问 Key 已使用" : "访问 Key 已撤销");
    database.prepare("UPDATE access_keys SET status='redeemed',redeemed_at=? WHERE id=?").run(new Date().toISOString(), row.id);
    database.prepare("UPDATE app_users SET access_tier='full' WHERE id=? AND role<>'admin'").run(userId);
    database.exec("COMMIT");
  } catch (error) { try { database.exec("ROLLBACK"); } catch { } throw error; } finally { database.close(); }
  return getUserById(userId)!;
}
export function revokeAccessKey(adminId: string, keyId: string) {
  const database = db(); let targetId = "";
  try {
    database.exec("BEGIN IMMEDIATE");
    const admin = database.prepare("SELECT role FROM app_users WHERE id=?").get(adminId) as {role:UserRole}|undefined;
    if (admin?.role !== "admin") throw new Error("仅管理员可以撤销访问 Key");
    const row = database.prepare("SELECT user_id,status FROM access_keys WHERE id=?").get(keyId) as {user_id:string;status:KeyStatus}|undefined;
    if (!row) throw new Error("访问 Key 不存在"); targetId = row.user_id;
    if (row.status !== "revoked") {
      database.prepare("UPDATE access_keys SET status='revoked',revoked_at=? WHERE id=?").run(new Date().toISOString(), keyId);
      if (row.status === "redeemed") database.prepare("UPDATE app_users SET access_tier='preview' WHERE id=? AND role<>'admin'").run(row.user_id);
    }
    database.exec("COMMIT");
  } catch (error) { try { database.exec("ROLLBACK"); } catch { } throw error; } finally { database.close(); }
  return getUserById(targetId)!;
}
