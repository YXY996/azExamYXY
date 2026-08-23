import { describe, expect, it } from "vitest";
import { validateRegistration } from "./auth-domain";

describe("registration validation", () => {
  it("accepts a valid local identity", () => expect(validateRegistration("learner_1", "long-password-123")).toEqual([]));
  it("rejects unsafe usernames", () => expect(validateRegistration("a/b", "long-password-123")).not.toEqual([]));
  it("rejects short passwords", () => expect(validateRegistration("learner", "short")).not.toEqual([]));
});
