import { describe, expect, test } from "vitest";
import { checkCodexAdapterHealth, smokeCodexAdapter } from "../src/adapters/codex.js";

describe("Codex adapter health", () => {
  test("reports missing commands without running model calls", async () => {
    const health = await checkCodexAdapterHealth({ command: "definitely-missing-codex-command" });
    expect(health.available).toBe(false);
    expect(health.reason).toContain("not found");
  });

  test("reports version output for available commands", async () => {
    const health = await checkCodexAdapterHealth({ command: process.execPath, versionArgs: ["--version"] });
    expect(health.available).toBe(true);
    expect(health.version).toMatch(/^v?\d+/);
  });

  test("smoke path skips unavailable adapters deterministically", async () => {
    const smoke = await smokeCodexAdapter({ command: "definitely-missing-codex-command" });
    expect(smoke.status).toBe("skipped");
    expect(smoke.model_call_performed).toBe(false);
  });
});
