import { describe, expect, test } from "vitest";
import type { StoredArtifact, StoredAttempt } from "../src/db/store.js";
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

describe("audience path redaction", () => {
  test("strips local paths in public audience", () => {
    const publicAttempt = forAudience.attempt(sampleStoredAttempt(), "public");
    expect(publicAttempt).not.toHaveProperty("worktree_path");
    expect(publicAttempt).not.toHaveProperty("log_path");
    expect(publicAttempt).not.toHaveProperty("result_path");
    expect(publicAttempt.attempt_id).toBe("att_1");
  });

  test("preserves local paths in internal audience", () => {
    const internalAttempt = forAudience.attempt(sampleStoredAttempt(), "internal");
    expect(internalAttempt.worktree_path).toBe("/tmp/worktree");
    expect(internalAttempt.log_path).toBe("/tmp/task.log");
    expect(internalAttempt.result_path).toBe("/tmp/result.json");
  });
});

const sampleStoredArtifact = (): StoredArtifact => ({
  schema_version: "1",
  artifact_id: "art_1",
  scope: { session_id: "sess_1", task_id: "task_1" },
  type: "log",
  mime_type: "text/plain",
  summary: "Test log",
  created_at: "2026-01-01T00:00:00.000Z",
  resource_uri: "any-subagents://test/art_1",
  path: "/tmp/artifact.log"
});

describe("audience artifact path redaction", () => {
  test("strips local path in public audience", () => {
    const publicArtifact = forAudience.artifact(sampleStoredArtifact(), "public");
    expect(publicArtifact).not.toHaveProperty("path");
    expect(publicArtifact.artifact_id).toBe("art_1");
  });

  test("preserves local path in internal audience", () => {
    const internalArtifact = forAudience.artifact(sampleStoredArtifact(), "internal");
    expect(internalArtifact.path).toBe("/tmp/artifact.log");
  });
});
