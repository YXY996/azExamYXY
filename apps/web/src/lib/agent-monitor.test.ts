import { describe, expect, it } from "vitest";
import { normalizeTaskStatus } from "./agent-monitor";

describe("normalizeTaskStatus", () => {
  it("normalizes completion aliases", () => {
    expect(normalizeTaskStatus("validated")).toBe("completed");
    expect(normalizeTaskStatus("succeeded")).toBe("completed");
  });
  it("marks old running records as stale", () => {
    expect(normalizeTaskStatus("running", "2026-01-01T00:00:00Z", new Date("2026-01-01T02:00:00Z").getTime())).toBe("stale");
  });
  it("preserves recent running records", () => {
    expect(normalizeTaskStatus("running", "2026-01-01T01:30:00Z", new Date("2026-01-01T02:00:00Z").getTime())).toBe("running");
  });
  it("normalizes blocked work records", () => {
    expect(normalizeTaskStatus("blocked")).toBe("blocked");
  });
});
