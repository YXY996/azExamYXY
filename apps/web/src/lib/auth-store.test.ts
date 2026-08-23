import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authenticateUser, createAccessKey, getUserById, listAccessKeys, registerUser, registrationAvailable, redeemAccessKey, revokeAccessKey } from "./auth-store";

const filename = path.join(process.cwd(), "data", "private", `auth-test-${randomUUID()}.sqlite`);
describe("multi-user identity and user-bound access keys", () => {
  let adminId = "", userId = "", otherId = "", keyId = "", plaintext = "";
  beforeAll(() => { process.env.APP_AUTH_DATABASE_PATH = filename; });
  afterAll(() => { delete process.env.APP_AUTH_DATABASE_PATH; for (const suffix of ["", "-wal", "-shm"]) rmSync(`${filename}${suffix}`, { force: true }); });
  it("keeps registration open and makes only the first user admin", () => {
    expect(registrationAvailable()).toBe(true);
    const admin = registerUser("owner", "correct-password-123"); adminId = admin.id;
    const user = registerUser("learner", "another-password-123"); userId = user.id;
    otherId = registerUser("another", "another-password-456").id;
    expect(admin).toMatchObject({ role: "admin", access_tier: "full" });
    expect(user).toMatchObject({ role: "user", access_tier: "preview" });
    expect(authenticateUser("learner", "another-password-123")?.id).toBe(user.id);
    expect(authenticateUser("learner", "wrong-password")).toBeNull();
    expect(() => registerUser("learner", "duplicate-password-123")).toThrow("用户名已存在");
  });
  it("creates a high-entropy key without exposing it in listings", () => {
    const created = createAccessKey(adminId, userId); keyId = created.id; plaintext = created.key;
    expect(plaintext).toMatch(/^AZEX-[A-Za-z0-9_-]{32}$/);
    expect(listAccessKeys(adminId)[0]).not.toHaveProperty("key");
    expect(() => createAccessKey(userId, otherId)).toThrow("仅管理员");
  });
  it("binds, single-use redeems, and revokes a key", () => {
    expect(() => redeemAccessKey(otherId, plaintext)).toThrow("不属于当前用户");
    expect(redeemAccessKey(userId, plaintext).access_tier).toBe("full");
    expect(() => redeemAccessKey(userId, plaintext)).toThrow("已使用");
    expect(revokeAccessKey(adminId, keyId).access_tier).toBe("preview");
    expect(getUserById(userId)?.access_tier).toBe("preview");
  });
});
