import { beforeEach, describe, expect, test, vi } from "vitest";
import type { CodexHealth } from "../src/adapters/codex.js";
import { createTestControlPlane } from "../src/test-support/control-plane.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";

const mockCheckCodexAdapterHealth = vi.fn<
  typeof import("../src/adapters/codex.js").checkCodexAdapterHealth
>();

vi.mock("../src/adapters/codex.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/adapters/codex.js")>();
  return {
    ...actual,
    checkCodexAdapterHealth: (...args: Parameters<typeof actual.checkCodexAdapterHealth>) =>
      mockCheckCodexAdapterHealth(...args)
  };
});

const availableHealth: CodexHealth = {
  adapter: "codex",
  available: true,
  command: "codex",
  version: "codex-cli 1.0.0",
  supports_model_selection: true,
  supports_reasoning_level: true,
  allowed_models: [],
  allowed_reasoning_levels: ["minimal", "low", "medium", "high", "xhigh", "max"]
};

const unavailableHealth: CodexHealth = {
  adapter: "codex",
  available: false,
  command: "codex",
  reason: "command not found",
  supports_model_selection: true,
  supports_reasoning_level: true,
  allowed_models: [],
  allowed_reasoning_levels: ["minimal", "low", "medium", "high", "xhigh", "max"]
};

describe("doctor and effective config", () => {
  beforeEach(() => {
    mockCheckCodexAdapterHealth.mockReset();
  });

  test("reports storage, adapters, security defaults, and healthy local checks", async () => {
    mockCheckCodexAdapterHealth.mockResolvedValue(availableHealth);
    const paths = await createTestRuntimePaths();
    const plane = createTestControlPlane(paths, { globalConcurrency: 3 });
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
        codex: { available: true, version: "codex-cli 1.0.0" }
      });
      expect(config.security).toMatchObject({
        preset: "default",
        preset_expansion: {
          network_policy: "restricted",
          package_install_policy: "ask",
          sandbox: { mode: "restricted" }
        }
      });
      expect(JSON.stringify(config)).not.toContain("API_KEY");

      const doctor = await plane.doctor();
      expect(doctor.status).toBe("healthy");
      expect(doctor.checks.map((check) => check.name)).toEqual(
        expect.arrayContaining(["git", "storage", "fake_adapter", "codex_adapter"])
      );
      const codexCheck = doctor.checks.find((check) => check.name === "codex_adapter");
      expect(codexCheck?.status).toBe("pass");
      expect(codexCheck?.message).toContain("codex-cli 1.0.0");
      expect(mockCheckCodexAdapterHealth).toHaveBeenCalledTimes(1);
    } finally {
      await plane.close();
    }
  });

  test("reports codex adapter as unavailable when health probe fails", async () => {
    mockCheckCodexAdapterHealth.mockResolvedValue(unavailableHealth);
    const paths = await createTestRuntimePaths();
    const plane = createTestControlPlane(paths, { globalConcurrency: 3 });
    try {
      const config = await plane.getEffectiveConfig();
      expect(config.adapters["codex"]).toMatchObject({
        available: false,
        reason: "command not found"
      });

      const doctor = await plane.doctor();
      expect(doctor.status).toBe("healthy");
      const codexCheck = doctor.checks.find((check) => check.name === "codex_adapter");
      expect(codexCheck?.status).toBe("warn");
      expect(codexCheck?.message).toBe("command not found");
      expect(mockCheckCodexAdapterHealth).toHaveBeenCalledTimes(1);
    } finally {
      await plane.close();
    }
  });

  test("uses a shared codex health probe across config and doctor", async () => {
    mockCheckCodexAdapterHealth.mockResolvedValue(availableHealth);
    const paths = await createTestRuntimePaths();
    const plane = createTestControlPlane(paths, { globalConcurrency: 3 });
    try {
      await plane.getEffectiveConfig();
      await plane.doctor();
      expect(mockCheckCodexAdapterHealth).toHaveBeenCalledTimes(1);
    } finally {
      await plane.close();
    }
  });
});
