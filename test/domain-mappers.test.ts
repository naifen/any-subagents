import { describe, expect, test } from "vitest";
import { taskAttemptFromStored, taskAttemptToStored } from "../src/domain/mappers.js";
import type { StoredAttempt } from "../src/db/store-types.js";
import { forAudience } from "../src/core/audience.js";

const sampleStoredAttempt = (): StoredAttempt => ({
  attempt_id: "att_1",
  task_id: "task_1",
  attempt_number: 1,
  status: "completed",
  worktree_path: "/tmp/worktree",
  log_path: "/tmp/task.log",
  result_path: "/tmp/result.json",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:01.000Z",
  started_at: "2026-01-01T00:00:00.000Z",
  finished_at: "2026-01-01T00:00:01.000Z"
});

describe("domain attempt mappers", () => {
  test("round-trips stored attempts through the domain shape", () => {
    const stored = sampleStoredAttempt();
    expect(taskAttemptToStored(taskAttemptFromStored(stored))).toEqual(stored);
  });

  test("strips local paths in public audience via domain mapping", () => {
    const publicAttempt = forAudience.attempt(sampleStoredAttempt(), "public");
    expect(publicAttempt).not.toHaveProperty("worktree_path");
    expect(publicAttempt).not.toHaveProperty("log_path");
    expect(publicAttempt).not.toHaveProperty("result_path");
    expect(publicAttempt.attempt_id).toBe("att_1");
  });
});
