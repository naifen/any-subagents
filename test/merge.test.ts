import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createTestControlPlane } from "../src/test-support/control-plane.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";
import { createTempGitRepo } from "../src/test-support/git.js";

const planes: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(planes.splice(0).map((plane) => plane.close()));
});

describe("merge tasks", () => {
  test("applies selected non-conflicting attempts into an integration worktree", async () => {
    const repo = await createTempGitRepo();
    const plane = createTestControlPlane(await createTestRuntimePaths(), { globalConcurrency: 2 });
    planes.push(plane);
    const session = await plane.createSession({ repo, base_ref: "HEAD", brief: { goal: "Merge selected attempts." } });
    const group = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Implement",
      expected_brief_revision: session.brief_revision,
      tasks: ["src/a.txt", "src/b.txt"].map((file) => ({
        mode: "write" as const,
        goal: `Create ${file}`,
        adapter: "fake",
        profile: "default",
        scope: { paths: [file] },
        success_criteria: [`${file} exists.`],
        metadata: {
          fake_change_file: file,
          fake_change_content: `${file}\n`
        }
      }))
    });

    await plane.waitForTaskGroup(group.group_id, 5_000);
    const tasks = await plane.queryTasks({ group_id: group.group_id });
    const attemptIds = await Promise.all(
      tasks.tasks.map(async (task) => {
        const result = await plane.getTaskResult({ task_id: task.task_id });
        return result.attempt.attempt_id;
      })
    );

    const merge = await plane.mergeTasks({ session_id: session.session_id, attempt_ids: attemptIds });
    expect(merge.status).toBe("completed");
    expect(merge.changed_files.sort()).toEqual(["src/a.txt", "src/b.txt"]);
    await expect(readWorktreeFile(merge.integration_worktree_path, "src/a.txt")).resolves.toBe("src/a.txt\n");
    await expect(readWorktreeFile(merge.integration_worktree_path, "src/b.txt")).resolves.toBe("src/b.txt\n");
  });

  test("persists merge conflict events and diff artifacts", async () => {
    const repo = await createTempGitRepo();
    const plane = createTestControlPlane(await createTestRuntimePaths(), { globalConcurrency: 1 });
    planes.push(plane);
    const session = await plane.createSession({ repo, base_ref: "HEAD", brief: { goal: "Conflict merge." } });
    const group = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Conflict",
      expected_brief_revision: session.brief_revision,
      tasks: [{
        mode: "write",
        goal: "Create conflicting file.",
        adapter: "fake",
        profile: "default",
        scope: { paths: ["src/conflict.txt"] },
        success_criteria: ["File exists."],
        metadata: { fake_change_file: "src/conflict.txt", fake_change_content: "from-task\n" }
      }]
    });
    await plane.waitForTaskGroup(group.group_id, 5_000);
    const first = await plane.getTaskResult({ task_id: (await plane.queryTasks({ group_id: group.group_id })).tasks[0]!.task_id });

    const group2 = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Conflict 2",
      expected_brief_revision: session.brief_revision,
      tasks: [{
        mode: "write",
        goal: "Create conflicting file again.",
        adapter: "fake",
        profile: "default",
        scope: { paths: ["src/conflict.txt"] },
        success_criteria: ["File exists."],
        metadata: { fake_change_file: "src/conflict.txt", fake_change_content: "from-task-2\n" }
      }]
    });
    await plane.waitForTaskGroup(group2.group_id, 5_000);
    const second = await plane.getTaskResult({ task_id: (await plane.queryTasks({ group_id: group2.group_id })).tasks[0]!.task_id });

    const merge = await plane.mergeTasks({ session_id: session.session_id, attempt_ids: [first.attempt.attempt_id, second.attempt.attempt_id] });
    expect(merge.status).toBe("conflicted");
    const events = plane.listEvents({ session_id: session.session_id, type: "merge.conflict" });
    expect(events.events.length).toBeGreaterThan(0);
    const artifacts = await plane.listArtifacts({ session_id: session.session_id });
    expect(artifacts.artifacts.some((artifact) => artifact.type === "diff" && artifact.summary.includes("conflict"))).toBe(true);
  });
});


async function readWorktreeFile(worktree: string, file: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path.join(worktree, file), "utf8");
}
