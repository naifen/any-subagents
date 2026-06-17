import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createControlPlane } from "../src/core/control-plane.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";
import { createTempGitRepo } from "../src/test-support/git.js";


const planes: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(planes.splice(0).map((plane) => plane.close()));
});

describe("control plane fake adapter", () => {
  test("runs a fake write task end-to-end and exposes compact evidence", async () => {
    const repo = await createTempGitRepo();
    const runtime = await createTestRuntimePaths();
    const plane = createControlPlane({ paths: runtime, maxConcurrency: 2 });
    planes.push(plane);

    const session = await plane.createSession({
      repo,
      base_ref: "HEAD",
      brief: { goal: "Exercise fake adapter end-to-end." }
    });

    const group = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Implementation",
      expected_brief_revision: session.brief_revision,
      tasks: [
        {
          mode: "write",
          goal: "Create a deterministic output file.",
          adapter: "fake",
          profile: "default",
          scope: { paths: ["src/output.txt"] },
          success_criteria: ["src/output.txt exists with deterministic content."],
          metadata: {
            fake_change_file: "src/output.txt",
            fake_change_content: "created by fake adapter\n"
          }
        }
      ]
    });

    const terminal = await plane.waitForTaskGroup(group.group_id, 5_000);
    expect(terminal.status).toBe("completed");

    const tasks = await plane.queryTasks({ session_id: session.session_id });
    expect(tasks.tasks).toHaveLength(1);
    expect(tasks.tasks[0]?.status).toBe("completed");

    const result = await plane.getTaskResult({ task_id: tasks.tasks[0]!.task_id });
    expect(result.result?.status).toBe("completed");
    expect(result.result?.changes?.[0]?.path).toBe("src/output.txt");
    expect(result.attempt.status).toBe("completed");
    const resultSchema = await readFile(path.join(result.attempt.worktree_path!, ".any-subagents", "result.schema.json"), "utf8");
    expect(resultSchema).toContain("task_id");

    const logs = await plane.getTaskLogs({ task_id: tasks.tasks[0]!.task_id });
    expect(logs.preview).toContain("fake adapter completed");

    const artifacts = await plane.listArtifacts({ task_id: tasks.tasks[0]!.task_id });
    expect(artifacts.artifacts.map((artifact) => artifact.type).sort()).toEqual(["diff", "log"]);
    expect(artifacts.artifacts.every((artifact) => artifact.resource_uri?.startsWith("any-subagents://") === true)).toBe(true);

    const digest = await plane.getSessionDigest({ session_id: session.session_id });
    expect(digest.summary).toMatchObject({
      total: 1,
      completed: 1,
      failed: 0,
      running: 0
    });
  });

  test("marks malformed result files as failed_contract and preserves evidence", async () => {
    const repo = await createTempGitRepo();
    const runtime = await createTestRuntimePaths();
    const plane = createControlPlane({ paths: runtime, maxConcurrency: 1 });
    planes.push(plane);

    const session = await plane.createSession({
      repo,
      base_ref: "HEAD",
      brief: { goal: "Exercise failed-contract handling." }
    });
    const group = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Contract validation",
      expected_brief_revision: session.brief_revision,
      tasks: [
        {
          mode: "research",
          goal: "Write malformed result JSON.",
          adapter: "fake",
          profile: "default",
          success_criteria: ["Malformed output is rejected."],
          metadata: { fake_result: "malformed" }
        }
      ]
    });

    const terminal = await plane.waitForTaskGroup(group.group_id, 5_000);
    expect(terminal.status).toBe("failed");

    const tasks = await plane.queryTasks({ session_id: session.session_id });
    const result = await plane.getTaskResult({ task_id: tasks.tasks[0]!.task_id });
    expect(result.attempt.status).toBe("failed_contract");
    expect(result.attempt.error).toContain("JSON");

    const logs = await plane.getTaskLogs({ task_id: tasks.tasks[0]!.task_id });
    expect(logs.preview).toContain("fake adapter wrote malformed result");

    const artifacts = await plane.listArtifacts({ task_id: tasks.tasks[0]!.task_id });
    expect(artifacts.artifacts.map((artifact) => artifact.type)).toEqual(["log"]);
  });

  test("marks tasks as timed_out when the adapter exceeds the task timeout", async () => {
    const repo = await createTempGitRepo();
    const runtime = await createTestRuntimePaths();
    const plane = createControlPlane({ paths: runtime, maxConcurrency: 1 });
    planes.push(plane);

    const session = await plane.createSession({
      repo,
      base_ref: "HEAD",
      brief: { goal: "Exercise timeout handling." }
    });
    const group = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Timeout",
      expected_brief_revision: session.brief_revision,
      tasks: [
        {
          mode: "verify",
          goal: "Sleep past the configured timeout.",
          adapter: "fake",
          profile: "default",
          success_criteria: ["The runtime reports a timeout."],
          timeout_ms: 50,
          metadata: { fake_delay_ms: 1_000 }
        }
      ]
    });

    const terminal = await plane.waitForTaskGroup(group.group_id, 5_000);
    expect(terminal.status).toBe("failed");

    const tasks = await plane.queryTasks({ session_id: session.session_id });
    const result = await plane.getTaskResult({ task_id: tasks.tasks[0]!.task_id });
    expect(result.attempt.status).toBe("timed_out");
    expect(result.attempt.error).toBe("Task timed out");
  });

  test("cancels running tasks idempotently", async () => {
    const repo = await createTempGitRepo();
    const runtime = await createTestRuntimePaths();
    const plane = createControlPlane({ paths: runtime, maxConcurrency: 1 });
    planes.push(plane);

    const session = await plane.createSession({
      repo,
      base_ref: "HEAD",
      brief: { goal: "Exercise cancellation." }
    });
    await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Cancellation",
      expected_brief_revision: session.brief_revision,
      tasks: [
        {
          mode: "verify",
          goal: "Run long enough to be cancelled.",
          adapter: "fake",
          profile: "default",
          success_criteria: ["The runtime reports cancellation."],
          metadata: { fake_delay_ms: 5_000 }
        }
      ]
    });

    const runningTask = await waitForFirstTaskStatus(plane, session.session_id, "running");
    expect(await plane.cancelTasks({ task_ids: [runningTask.task_id] })).toEqual({ cancelled_task_ids: [runningTask.task_id] });
    expect(await plane.cancelTasks({ task_ids: [runningTask.task_id] })).toEqual({ cancelled_task_ids: [] });

    await waitForFirstTaskStatus(plane, session.session_id, "cancelled");
    const result = await plane.getTaskResult({ task_id: runningTask.task_id });
    expect(result.attempt.status).toBe("cancelled");
    expect(result.attempt.error).toBe("Task cancelled");
  });

  test("queues 100 fake tasks with bounded concurrency", { timeout: 60_000 }, async () => {
    const repo = await createTempGitRepo();
    const runtime = await createTestRuntimePaths();
    const plane = createControlPlane({ paths: runtime, maxConcurrency: 4 });
    planes.push(plane);

    const session = await plane.createSession({
      repo,
      base_ref: "HEAD",
      brief: { goal: "Exercise fake adapter queue stress." }
    });
    const group = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Stress",
      expected_brief_revision: session.brief_revision,
      tasks: Array.from({ length: 100 }, (_, index) => ({
        mode: "research" as const,
        goal: `Complete fake task ${index}.`,
        adapter: "fake",
        profile: "default",
        success_criteria: ["The fake adapter completes."],
        metadata: { fake_delay_ms: 10 }
      }))
    });

    const active = await waitForDigest(
      plane,
      session.session_id,
      (summary) => summary.running > 0 && summary.queued > 0
    );
    expect(active.running).toBeLessThanOrEqual(4);

    const terminal = await plane.waitForTaskGroup(group.group_id, 60_000);
    expect(terminal.status).toBe("completed");

    const digest = await plane.getSessionDigest({ session_id: session.session_id });
    expect(digest.summary).toMatchObject({
      total: 100,
      completed: 100,
      failed: 0,
      running: 0,
      queued: 0
    });
  });

  test("group with completed + cancelled tasks resolves to mixed status", async () => {
    const repo = await createTempGitRepo();
    const runtime = await createTestRuntimePaths();
    const plane = createControlPlane({ paths: runtime, maxConcurrency: 1 });
    planes.push(plane);

    const session = await plane.createSession({
      repo,
      base_ref: "HEAD",
      brief: { goal: "Exercise mixed group status." }
    });
    const group = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Mixed group",
      expected_brief_revision: session.brief_revision,
      tasks: [
        {
          mode: "research",
          goal: "Complete quickly.",
          adapter: "fake",
          profile: "default",
          success_criteria: ["Completes."]
        },
        {
          mode: "research",
          goal: "Wait to be cancelled.",
          adapter: "fake",
          profile: "default",
          success_criteria: ["Gets cancelled."],
          metadata: { fake_delay_ms: 5_000 }
        }
      ]
    });

    const running = await waitForFirstTaskStatus(plane, session.session_id, "running");
    // Wait until the first task completes and only the slow one remains
    await waitForDigest(plane, session.session_id, (s) => s.completed > 0 && s.running > 0);
    await plane.cancelTasks({ task_ids: [running.task_id] });
    // Wait for the slow task to actually be cancelled
    const tasks = await plane.queryTasks({ group_id: group.group_id });
    const slowTask = tasks.tasks.find((t) => t.task_id !== running.task_id);
    await plane.cancelTasks({ task_ids: [slowTask!.task_id] });

    const terminal = await plane.waitForTaskGroup(group.group_id, 5_000);
    // A group with some completed + some cancelled tasks should resolve to "mixed"
    expect(terminal.status).toBe("mixed");
  });
});

async function waitForFirstTaskStatus(
  plane: { queryTasks: (filter: { session_id: string }) => Promise<{ tasks: Array<{ task_id: string; status: string }> }> },
  sessionId: string,
  status: string
): Promise<{ task_id: string; status: string }> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const tasks = await plane.queryTasks({ session_id: sessionId });
    const task = tasks.tasks[0];
    if (task?.status === status) {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for first task to reach ${status}`);
}

async function waitForDigest(
  plane: {
    getSessionDigest: (input: { session_id: string }) => Promise<{
      summary: { queued: number; running: number; completed: number; failed: number; total: number };
    }>;
  },
  sessionId: string,
  predicate: (summary: { queued: number; running: number; completed: number; failed: number; total: number }) => boolean
): Promise<{ queued: number; running: number; completed: number; failed: number; total: number }> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const digest = await plane.getSessionDigest({ session_id: sessionId });
    if (predicate(digest.summary)) {
      return digest.summary;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for digest predicate");
}

describe("session brief revision", () => {
  test("rejects stale brief revision on update", async () => {
    const repo = await createTempGitRepo();
    const runtime = await createTestRuntimePaths();
    const plane = createControlPlane({ paths: runtime });
    planes.push(plane);

    const session = await plane.createSession({
      repo,
      base_ref: "HEAD",
      brief: { goal: "Test revision conflict." }
    });

    // First update succeeds (revision 0 → 1)
    await plane.updateSessionBrief({
      session_id: session.session_id,
      expected_brief_revision: 0,
      brief: { goal: "Updated goal." }
    });

    // Second update with stale revision 0 should fail
    await expect(
      plane.updateSessionBrief({
        session_id: session.session_id,
        expected_brief_revision: 0,
        brief: { goal: "Stale update." }
      })
    ).rejects.toThrow(/revision conflict/i);
  });

  test("rejects stale brief revision on task group submission", async () => {
    const repo = await createTempGitRepo();
    const runtime = await createTestRuntimePaths();
    const plane = createControlPlane({ paths: runtime });
    planes.push(plane);

    const session = await plane.createSession({
      repo,
      base_ref: "HEAD",
      brief: { goal: "Test submission revision conflict." }
    });

    await plane.updateSessionBrief({
      session_id: session.session_id,
      expected_brief_revision: 0,
      brief: { goal: "Bumped." }
    });

    await expect(
      plane.submitTaskGroup({
        session_id: session.session_id,
        title: "Stale",
        expected_brief_revision: 0,
        tasks: [{
          mode: "research",
          goal: "Should not run.",
          adapter: "fake",
          profile: "default",
          success_criteria: ["Never."]
        }]
      })
    ).rejects.toThrow(/revision conflict/i);
  });
});
