import { afterEach, describe, expect, test } from "vitest";
import { createTestControlPlane } from "../src/test-support/control-plane.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";
import { createTempGitRepo } from "../src/test-support/git.js";

const planes: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(planes.splice(0).map((plane) => plane.close()));
});

describe("metrics", () => {
  test("records queue wait and task duration metrics for completed tasks", async () => {
    const repo = await createTempGitRepo();
    const plane = createTestControlPlane(await createTestRuntimePaths(), { globalConcurrency: 1 });
    planes.push(plane);
    const session = await plane.createSession({ repo, base_ref: "HEAD", brief: { goal: "Metrics test." } });
    const group = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Metrics",
      expected_brief_revision: session.brief_revision,
      tasks: [{
        mode: "research",
        goal: "Complete quickly.",
        adapter: "fake",
        profile: "default",
        success_criteria: ["Done."]
      }]
    });
    await plane.waitForTaskGroup(group.group_id, 5_000);
    const metrics = await plane.getMetrics({ session_id: session.session_id });
    expect(metrics.metrics.map((metric) => metric.name)).toEqual(
      expect.arrayContaining(["queue_wait_ms", "task_duration_ms", "verification_outcome"])
    );
  });
});
