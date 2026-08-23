import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { authenticateUser, registerFirstUser, registrationAvailable } from "./auth-store";

const filename = path.join(process.cwd(), "data", "private", `auth-test-${randomUUID()}.sqlite`);

describe("single-user identity store", () => {
  beforeAll(() => { process.env.APP_AUTH_DATABASE_PATH = filename; });
  afterAll(() => {
    delete process.env.APP_AUTH_DATABASE_PATH;
    for (const suffix of ["", "-wal", "-shm"]) rmSync(`${filename}${suffix}`, { force: true });
  });

  it("registers only the first user and verifies a salted password", () => {
    expect(registrationAvailable()).toBe(true);
    const user = registerFirstUser("learner", "correct-password-123");
    expect(user.username).toBe("learner");
    expect(registrationAvailable()).toBe(false);
    expect(authenticateUser("learner", "correct-password-123")?.id).toBe(user.id);
    expect(authenticateUser("learner", "wrong-password")).toBeNull();
    expect(() => registerFirstUser("second", "another-password-123")).toThrow("注册已关闭");
  });
});
