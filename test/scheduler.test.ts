import { afterEach, describe, expect, test } from "vitest";
import { mergeConfig } from "../src/config/load.js";
import { defaultConfig } from "../src/config/schema.js";
import { globalConcurrency, normalizeConfig } from "../src/config/normalize.js";
import { createControlPlane } from "../src/core/control-plane.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";
import { createTempGitRepo } from "../src/test-support/git.js";

const planes: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(planes.splice(0).map((plane) => plane.close()));
});

describe("scheduler concurrency", () => {
  test("profile concurrency of 1 serializes same-profile fake tasks", async () => {
    const repo = await createTempGitRepo();
    const runtime = await createTestRuntimePaths();
    const plane = createControlPlane({
      paths: runtime,
      config: mergeConfig(defaultConfig(), {
        concurrency: { global: 4 },
        profiles: { fake: { default: { concurrency: 1 } } }
      })
    });
    planes.push(plane);

    const session = await plane.createSession({ repo, base_ref: "HEAD", brief: { goal: "serialize" } });
    const group = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Parallel profile",
      expected_brief_revision: session.brief_revision,
      tasks: [
        {
          mode: "research",
          goal: "slow one",
          adapter: "fake",
          profile: "default",
          success_criteria: ["done"],
          metadata: { fake_delay_ms: 400 }
        },
        {
          mode: "research",
          goal: "slow two",
          adapter: "fake",
          profile: "default",
          success_criteria: ["done"],
          metadata: { fake_delay_ms: 400 }
        }
      ]
    });

    await new Promise((resolve) => setTimeout(resolve, 150));
    const mid = await plane.queryTasks({ group_id: group.group_id });
    const running = mid.tasks.filter((task) => task.status === "running").length;
    const queued = mid.tasks.filter((task) => task.status === "queued").length;
    expect(running).toBeLessThanOrEqual(1);
    expect(running + queued).toBeGreaterThanOrEqual(1);

    const terminal = await plane.waitForTaskGroup(group.group_id, 15_000);
    expect(terminal.status).toBe("completed");
  });
});

describe("scheduler cancel_running preemption", () => {
  test("evicts a lower-priority running task so a higher-priority queued task can start", async () => {
    const repo = await createTempGitRepo();
    const runtime = await createTestRuntimePaths();
    const plane = createControlPlane({
      paths: runtime,
      config: mergeConfig(defaultConfig(), {
        concurrency: { global: 1 },
        capacity_preemption_policy: "cancel_running"
      })
    });
    planes.push(plane);

    const session = await plane.createSession({ repo, base_ref: "HEAD", brief: { goal: "preempt" } });
    const lowPriorityGroup = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Low priority",
      expected_brief_revision: session.brief_revision,
      tasks: [
        {
          mode: "research",
          goal: "slow low priority",
          adapter: "fake",
          profile: "default",
          success_criteria: ["done"],
          priority: 0,
          metadata: { fake_delay_ms: 30_000 }
        }
      ]
    });

    for (let attempt = 0; attempt < 50; attempt++) {
      const status = (await plane.queryTasks({ group_id: lowPriorityGroup.group_id })).tasks[0]?.status;
      if (status === "running") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect((await plane.queryTasks({ group_id: lowPriorityGroup.group_id })).tasks[0]?.status).toBe("running");
    // Task status flips to running before spawnSupervised registers the child; wait for adapter startup.
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const highPriorityGroup = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "High priority",
      expected_brief_revision: session.brief_revision,
      tasks: [
        {
          mode: "research",
          goal: "urgent",
          adapter: "fake",
          profile: "default",
          success_criteria: ["done"],
          priority: 10
        }
      ]
    });

    const terminal = await plane.waitForTaskGroup(highPriorityGroup.group_id, 15_000);
    expect(terminal.status).toBe("completed");

    const lowTask = (await plane.queryTasks({ group_id: lowPriorityGroup.group_id })).tasks[0];
    expect(lowTask?.status).toBe("cancelled");
  });
});

describe("config normalization", () => {
  test("folds max_concurrency into concurrency.global", () => {
    const normalized = normalizeConfig(mergeConfig(defaultConfig(), { max_concurrency: 8 }));
    expect(globalConcurrency(normalized)).toBe(8);
    expect(normalized.max_concurrency).toBeUndefined();
  });

  test("mergeConfig deeply merges profile fields", () => {
    const merged = mergeConfig(
      mergeConfig(defaultConfig(), {
        profiles: { fake: { default: { concurrency: 1, timeout_ms: 10_000 } } }
      }),
      {
        profiles: { fake: { default: { timeout_ms: 20_000 } } }
      }
    );
    expect(merged.profiles?.["fake"]?.["default"]?.concurrency).toBe(1);
    expect(merged.profiles?.["fake"]?.["default"]?.timeout_ms).toBe(20_000);
  });
});
