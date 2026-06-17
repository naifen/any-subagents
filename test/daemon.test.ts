import { afterEach, describe, expect, test } from "vitest";
import { createControlPlane } from "../src/core/control-plane.js";
import { createDaemonApp } from "../src/daemon/app.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";
import { createTempGitRepo } from "../src/test-support/git.js";
const apps: Array<{ close: () => Promise<void> }> = [];
const planes: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(planes.splice(0).map((plane) => plane.close()));
});

describe("daemon API", () => {
  test("mirrors the fake adapter control-plane path", async () => {
    const repo = await createTempGitRepo();
    const plane = createControlPlane({ paths: await createTestRuntimePaths(), maxConcurrency: 1 });
    planes.push(plane);
    const app = createDaemonApp({ plane });
    apps.push(app);

    const sessionResponse = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { repo, base_ref: "HEAD", brief: { goal: "Daemon route test." } }
    });
    expect(sessionResponse.statusCode).toBe(200);
    const session = sessionResponse.json();

    const groupResponse = await app.inject({
      method: "POST",
      url: "/task-groups",
      payload: {
        session_id: session.session_id,
        title: "Daemon fake group",
        expected_brief_revision: session.brief_revision,
        tasks: [
          {
            mode: "research",
            goal: "Complete through daemon routes.",
            adapter: "fake",
            profile: "default",
            success_criteria: ["Daemon query returns completion."]
          }
        ]
      }
    });
    expect(groupResponse.statusCode).toBe(200);
    await plane.waitForTaskGroup(groupResponse.json().group_id, 5_000);

    const tasksResponse = await app.inject({
      method: "GET",
      url: `/tasks?session_id=${session.session_id}`
    });
    expect(tasksResponse.statusCode).toBe(200);
    const tasks = tasksResponse.json().tasks;
    expect(tasks[0].status).toBe("completed");

    const resultResponse = await app.inject({
      method: "GET",
      url: `/tasks/${tasks[0].task_id}/result`
    });
    expect(resultResponse.statusCode).toBe(200);
    expect(resultResponse.json().result.status).toBe("completed");
  });
});

