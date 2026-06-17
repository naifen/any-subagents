import { describe, expect, test } from "vitest";
import { createControlPlane } from "../src/core/control-plane.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";

describe("doctor and effective config", () => {
  test("reports storage, adapters, security defaults, and healthy local checks", async () => {
    const paths = await createTestRuntimePaths();
    const plane = createControlPlane({ paths, maxConcurrency: 3 });
    try {
      const config = await plane.getEffectiveConfig();
      expect(config.storage).toMatchObject({
        state_dir: paths.stateDir,
        logs_dir: paths.logsDir,
        artifacts_dir: paths.artifactsDir,
        worktree_root: paths.worktreeRoot
      });
      expect(config.adapters).toMatchObject({
        fake: { available: true },
        codex: { available: false }
      });
      expect(JSON.stringify(config)).not.toContain("API_KEY");

      const doctor = await plane.doctor();
      expect(doctor.status).toBe("healthy");
      expect(doctor.checks.map((check) => check.name)).toEqual(
        expect.arrayContaining(["git", "storage", "fake_adapter", "codex_adapter"])
      );
    } finally {
      await plane.close();
    }
  });
});
