import { afterEach, describe, expect, test } from "vitest";
import { createTestControlPlane } from "../src/test-support/control-plane.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";
import { createTempGitRepo } from "../src/test-support/git.js";
import { Store } from "../src/db/store.js";

const planes: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(planes.splice(0).map((plane) => plane.close()));
});

describe("restart recovery", () => {
  test("marks running attempts interrupted and re-enqueues queued tasks on boot", async () => {
    const runtime = await createTestRuntimePaths();
    const repo = await createTempGitRepo();

    const seed = new Store(runtime.dbPath);
    seed.insertSession({
      schema_version: "1",
      session_id: "sess_restart",
      repo,
      base_ref: "HEAD",
      status: "open",
      brief: { goal: "restart", constraints: [], decisions: [], accepted_findings: [], rejected_paths: [], open_questions: [] },
      brief_revision: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {}
    });
    seed.insertGroup({
      group_id: "grp_restart",
      session_id: "sess_restart",
      title: "Restart",
      status: "running",
      expected_brief_revision: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    seed.insertTask({
      task_id: "task_running",
      session_id: "sess_restart",
      group_id: "grp_restart",
      status: "running",
      mode: "research",
      goal: "was running",
      adapter: "fake",
      profile: "default",
      envelope: {
        schema_version: "1",
        task_id: "task_running",
        session_id: "sess_restart",
        group_id: "grp_restart",
        mode: "research",
        goal: "was running",
        adapter: "fake",
        profile: "default",
        success_criteria: ["x"],
        metadata: {}
      },
      attempt_count: 1,
      latest_attempt_id: "att_running",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    seed.insertAttempt({
      attempt_id: "att_running",
      task_id: "task_running",
      attempt_number: 1,
      status: "running",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    seed.insertTask({
      task_id: "task_queued",
      session_id: "sess_restart",
      group_id: "grp_restart",
      status: "queued",
      mode: "research",
      goal: "still queued",
      adapter: "fake",
      profile: "default",
      envelope: {
        schema_version: "1",
        task_id: "task_queued",
        session_id: "sess_restart",
        group_id: "grp_restart",
        mode: "research",
        goal: "still queued",
        adapter: "fake",
        profile: "default",
        success_criteria: ["x"],
        metadata: {}
      },
      attempt_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    seed.close();

    const plane = createTestControlPlane(runtime, { globalConcurrency: 1 });
    planes.push(plane);

    await plane.waitForTaskGroup("grp_restart", 10_000);

    const running = (await plane.getTaskResult({ task_id: "task_running" })).attempt;
    expect(running.status).toBe("interrupted");

    const events = plane.listEvents({ session_id: "sess_restart", type: "attempt.interrupted" });
    expect(events.events).toHaveLength(1);

    const queued = await plane.queryTasks({ session_id: "sess_restart" });
    const queuedTask = queued.tasks.find((task) => task.task_id === "task_queued");
    expect(queuedTask?.status).toBe("completed");
  });
});
