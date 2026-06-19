import { describe, expect, test } from "vitest";
import { countTaskStatuses, deriveGroupStatus } from "../src/domain/status.js";

describe("countTaskStatuses", () => {
  test("counts every runtime status in one pass", () => {
    expect(
      countTaskStatuses([
        "queued",
        "running",
        "completed",
        "blocked",
        "failed",
        "cancelled",
        "timed_out",
        "interrupted",
        "failed_contract",
        "completed_with_failed_verification"
      ])
    ).toEqual({
      queued: 1,
      running: 1,
      completed: 1,
      blocked: 1,
      cancelled: 1,
      failed: 5
    });
  });
});

describe("deriveGroupStatus", () => {
  test("derives failed when every task is blocked", () => {
    expect(deriveGroupStatus(["blocked", "blocked"])).toBe("failed");
  });

  test("derives mixed for heterogeneous terminal states", () => {
    expect(deriveGroupStatus(["completed", "blocked"])).toBe("mixed");
  });
});
