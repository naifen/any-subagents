import { describe, expect, test, afterEach } from "vitest";
import { Store } from "../src/db/store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Session, TaskEnvelope } from "../src/schemas/index.js";

let store: Store;
let tempDir: string;

afterEach(async () => {
  store?.close();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

const makeStore = async (): Promise<Store> => {
  tempDir = await mkdtemp(path.join(tmpdir(), "store-test-"));
  store = new Store(path.join(tempDir, "test.db"));
  return store;
};

const fakeSession = (): Session => ({
  schema_version: "1",
  session_id: "sess_test",
  repo: "/tmp/repo",
  base_ref: "HEAD",
  status: "open",
  brief: { goal: "test", constraints: [], decisions: [], accepted_findings: [], rejected_paths: [], open_questions: [] },
  brief_revision: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  metadata: {}
});

const fakeEnvelope = (): TaskEnvelope => ({
  schema_version: "1",
  task_id: "task_test",
  session_id: "sess_test",
  group_id: "grp_test",
  mode: "research",
  goal: "Test goal",
  adapter: "fake",
  profile: "default",
  success_criteria: ["passes"],
  metadata: {}
});

describe("Store", () => {
  test("updateTaskStatus increments attempt_count when new attempt ID provided", async () => {
    const s = await makeStore();
    s.insertSession(fakeSession());
    s.insertGroup({
      group_id: "grp_test",
      session_id: "sess_test",
      title: "Test",
      status: "queued",
      expected_brief_revision: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    s.insertTask({
      task_id: "task_test",
      session_id: "sess_test",
      group_id: "grp_test",
      status: "queued",
      mode: "research",
      goal: "test",
      adapter: "fake",
      profile: "default",
      envelope: fakeEnvelope(),
      attempt_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    // First update with new attempt
    s.updateTaskStatus("task_test", "running", "att_1");
    let task = s.getTask("task_test");
    expect(task?.status).toBe("running");
    expect(task?.attempt_count).toBe(1);
    expect(task?.latest_attempt_id).toBe("att_1");

    // Second update with same attempt (no increment)
    s.updateTaskStatus("task_test", "completed", "att_1");
    task = s.getTask("task_test");
    expect(task?.status).toBe("completed");
    expect(task?.attempt_count).toBe(1); // no increment

    // Third update with new attempt
    s.updateTaskStatus("task_test", "running", "att_2");
    task = s.getTask("task_test");
    expect(task?.status).toBe("running");
    expect(task?.attempt_count).toBe(2);
    expect(task?.latest_attempt_id).toBe("att_2");

    // Update without attempt ID (status change only)
    s.updateTaskStatus("task_test", "cancelled");
    task = s.getTask("task_test");
    expect(task?.status).toBe("cancelled");
    expect(task?.attempt_count).toBe(2); // no increment
    expect(task?.latest_attempt_id).toBe("att_2"); // preserved
  });

  test("updateSessionBrief rejects stale revision", async () => {
    const s = await makeStore();
    const session = fakeSession();
    s.insertSession(session);

    const updated = s.updateSessionBrief("sess_test", { ...session.brief, goal: "updated" }, 0);
    expect(updated.brief_revision).toBe(1);

    expect(() => s.updateSessionBrief("sess_test", { ...session.brief, goal: "stale" }, 0)).toThrow(/revision conflict/i);
  });

  test("insertArtifact and listArtifacts round-trip", async () => {
    const s = await makeStore();
    s.insertSession(fakeSession());
    s.insertGroup({
      group_id: "grp_test",
      session_id: "sess_test",
      title: "Test",
      status: "queued",
      expected_brief_revision: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    s.insertArtifact({
      schema_version: "1",
      artifact_id: "art_1",
      scope: { session_id: "sess_test", group_id: "grp_test", task_id: "task_test", attempt_id: "att_1" },
      type: "log",
      mime_type: "text/plain",
      summary: "Test log",
      created_at: new Date().toISOString(),
      resource_uri: "any-subagents://test/art_1",
      metadata: { key: "value" }
    });

    const listed = s.listArtifacts({ session_id: "sess_test" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.artifact_id).toBe("art_1");
    expect(listed[0]?.metadata).toEqual({ key: "value" });
  });

  test("appendEvent and getArtifactByResourceUri work correctly", async () => {
    const s = await makeStore();
    s.insertSession(fakeSession());

    s.appendEvent({
      type: "session.created",
      session_id: "sess_test",
      severity: "info",
      message: "Test event"
    });

    // Verify no crash — events are append-only with no read API beyond the control plane
    // This test just verifies appendEvent doesn't throw

    s.insertArtifact({
      schema_version: "1",
      artifact_id: "art_2",
      scope: { session_id: "sess_test" },
      type: "diff",
      mime_type: "text/x-diff",
      summary: "Test diff",
      created_at: new Date().toISOString(),
      resource_uri: "any-subagents://test/art_2",
      metadata: {}
    });

    const found = s.getArtifactByResourceUri("any-subagents://test/art_2");
    expect(found?.artifact_id).toBe("art_2");

    const byId = s.getArtifactById("art_2");
    expect(byId?.artifact_id).toBe("art_2");

    const notFound = s.getArtifactByResourceUri("any-subagents://test/nope");
    expect(notFound).toBeUndefined();
    expect(s.getArtifactById("art_missing")).toBeUndefined();
  });
});
