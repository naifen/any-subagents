import { afterEach, describe, expect, test } from "vitest";
import { finalizeAttempt, type FinalizeAttemptInput } from "../src/core/lifecycle.js";
import { Store, type StoredAttempt } from "../src/db/store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Session, TaskEnvelope } from "../src/schemas/index.js";

let store: Store;
let tempDir: string;

const cleanup = async () => {
  store?.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
};

afterEach(cleanup);

const makeStore = async (): Promise<Store> => {
  tempDir = await mkdtemp(path.join(tmpdir(), "lifecycle-test-"));
  store = new Store(path.join(tempDir, "test.db"));
  return store;
};

const seedSession = (s: Store) => {
  s.insertSession({
    schema_version: "1",
    session_id: "sess_1",
    repo: "/tmp/repo",
    base_ref: "HEAD",
    status: "open",
    brief: { goal: "test", constraints: [], decisions: [], accepted_findings: [], rejected_paths: [], open_questions: [] },
    brief_revision: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: {}
  });
  s.insertGroup({
    group_id: "grp_1",
    session_id: "sess_1",
    title: "Test",
    status: "running",
    expected_brief_revision: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
};

const seedTask = (s: Store, taskId = "task_1") => {
  const envelope: TaskEnvelope = {
    schema_version: "1",
    task_id: taskId,
    session_id: "sess_1",
    group_id: "grp_1",
    mode: "research",
    goal: "Test goal",
    adapter: "fake",
    profile: "default",
    success_criteria: ["passes"],
    metadata: {}
  };
  s.insertTask({
    task_id: taskId,
    session_id: "sess_1",
    group_id: "grp_1",
    status: "running",
    mode: "research",
    goal: "test",
    adapter: "fake",
    profile: "default",
    envelope,
    attempt_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  const attempt: StoredAttempt = {
    attempt_id: `att_${taskId}`,
    task_id: taskId,
    attempt_number: 1,
    status: "running",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: new Date().toISOString()
  };
  s.insertAttempt(attempt);
  s.updateTaskStatus(taskId, "running", attempt.attempt_id);
  return attempt;
};

describe("finalizeAttempt", () => {
  test("transitions attempt, task, and group status atomically", async () => {
    const s = await makeStore();
    seedSession(s);
    seedTask(s);

    finalizeAttempt(s, {
      attemptId: "att_task_1",
      taskId: "task_1",
      groupId: "grp_1",
      status: "completed"
    });

    const attempt = s.getAttempt("att_task_1");
    expect(attempt?.status).toBe("completed");
    expect(attempt?.finished_at).toBeDefined();

    const task = s.getTask("task_1");
    expect(task?.status).toBe("completed");

    const group = s.getGroup("grp_1");
    expect(group?.status).toBe("completed");
  });

  test("sets error message when provided", async () => {
    const s = await makeStore();
    seedSession(s);
    seedTask(s);

    finalizeAttempt(s, {
      attemptId: "att_task_1",
      taskId: "task_1",
      groupId: "grp_1",
      status: "failed",
      error: "Something broke"
    });

    const attempt = s.getAttempt("att_task_1");
    expect(attempt?.status).toBe("failed");
    expect(attempt?.error).toBe("Something broke");

    const task = s.getTask("task_1");
    expect(task?.status).toBe("failed");

    const group = s.getGroup("grp_1");
    expect(group?.status).toBe("failed");
  });

  test("derives mixed group status from heterogeneous task states", async () => {
    const s = await makeStore();
    seedSession(s);
    seedTask(s, "task_1");
    seedTask(s, "task_2");

    // Complete one task, leave the other running
    finalizeAttempt(s, {
      attemptId: "att_task_1",
      taskId: "task_1",
      groupId: "grp_1",
      status: "completed"
    });

    // Group should be running (task_2 is still running)
    const group = s.getGroup("grp_1");
    expect(group?.status).toBe("running");
  });

  test("handles missing attempt gracefully", async () => {
    const s = await makeStore();
    seedSession(s);
    seedTask(s);

    // Should not throw even with a nonexistent attempt
    finalizeAttempt(s, {
      attemptId: "att_nonexistent",
      taskId: "task_1",
      groupId: "grp_1",
      status: "cancelled"
    });

    // Task status should still be updated
    const task = s.getTask("task_1");
    expect(task?.status).toBe("cancelled");
  });
});
