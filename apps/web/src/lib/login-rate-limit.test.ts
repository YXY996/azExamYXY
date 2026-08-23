import { beforeEach, describe, expect, it } from "vitest";
import { clearLoginFailures, loginBlockSeconds, recordLoginFailure, resetLoginRateLimitsForTest } from "./login-rate-limit";

describe("login rate limiter", () => {
  beforeEach(resetLoginRateLimitsForTest);

  it("blocks an address after five failed attempts", () => {
    for (let count = 0; count < 4; count += 1) expect(recordLoginFailure("client", 1_000)).toBe(0);
    expect(recordLoginFailure("client", 1_000)).toBe(900);
    expect(loginBlockSeconds("client", 2_000)).toBe(899);
  });

  it("clears failures after successful authentication", () => {
    recordLoginFailure("client", 1_000);
    clearLoginFailures("client");
    expect(loginBlockSeconds("client", 1_000)).toBe(0);
  });
});
