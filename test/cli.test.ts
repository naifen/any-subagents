import { afterEach, describe, expect, test } from "vitest";
import { createCli } from "../src/cli/program.js";
import { createControlPlane } from "../src/core/control-plane.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";
import { createTempGitRepo } from "../src/test-support/git.js";
const planes: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(planes.splice(0).map((plane) => plane.close()));
});

describe("CLI", () => {
  test("creates sessions with JSON output", async () => {
    const repo = await createTempGitRepo();
    const plane = createControlPlane({ paths: await createTestRuntimePaths(), maxConcurrency: 1 });
    planes.push(plane);
    const output: string[] = [];
    const errors: string[] = [];
    const program = createCli({
      plane,
      stdout: (text) => output.push(text),
      stderr: (text) => errors.push(text)
    });

    await program.parseAsync([
      "node",
      "any-subagents",
      "session",
      "create",
      "--repo",
      repo,
      "--base-ref",
      "HEAD",
      "--goal",
      "CLI route test.",
      "--json"
    ]);

    expect(errors).toEqual([]);
    const session = JSON.parse(output.join(""));
    expect(session.session_id).toMatch(/^sess_/);
    expect(session.brief.goal).toBe("CLI route test.");
  });
});

