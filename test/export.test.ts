import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createTestControlPlane } from "../src/test-support/control-plane.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";
import { createTempGitRepo } from "../src/test-support/git.js";

const planes: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(planes.splice(0).map((plane) => plane.close()));
});

describe("export session", () => {
  test("writes JSON bundle files for a session", async () => {
    const repo = await createTempGitRepo();
    const runtime = await createTestRuntimePaths();
    const plane = createTestControlPlane(runtime, { globalConcurrency: 1 });
    planes.push(plane);
    const session = await plane.createSession({ repo, base_ref: "HEAD", brief: { goal: "Export me." } });
    const group = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Export",
      expected_brief_revision: session.brief_revision,
      tasks: [{
        mode: "research",
        goal: "Complete.",
        adapter: "fake",
        profile: "default",
        success_criteria: ["Done."]
      }]
    });
    await plane.waitForTaskGroup(group.group_id, 5_000);

    const outputRoot = await mkdtemp(path.join(tmpdir(), "export-out-"));
    const exported = await plane.exportSession({ session_id: session.session_id, output_dir: outputRoot });
    expect(await stat(exported.output_dir)).toBeTruthy();
    const sessionJson = JSON.parse(await readFile(path.join(exported.output_dir, "session.json"), "utf8")) as { session_id: string };
    expect(sessionJson.session_id).toBe(session.session_id);
    expect(exported.files.some((file) => file.endsWith("summary.md"))).toBe(true);
  });
});
