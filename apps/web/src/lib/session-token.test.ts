import { describe, expect, it } from "vitest";
import { createSessionToken, readSessionToken, verifySessionToken } from "./session-token";

describe("signed session token", () => {
  it("accepts an untampered token and rejects changes", async () => {
    const secret = "a-test-secret-that-is-longer-than-thirty-two-characters";
    const token = await createSessionToken("user-1", secret);
    expect((await readSessionToken(token, secret))?.sub).toBe("user-1");
    expect(await verifySessionToken(token, secret)).toBe(true);
    expect(await verifySessionToken(`${token}x`, secret)).toBe(false);
    expect(await verifySessionToken(token, `${secret}x`)).toBe(false);
  });
});
