import { describe, expect, test, vi } from "vitest";
import { adapterRegistry, getAdapter, isKnownAdapter, knownAdapters } from "../src/adapters/registry.js";

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

describe("adapter registry seam", () => {
  test("keeps registry metadata aligned with known adapters", () => {
    expect(adapterRegistry.map((adapter) => adapter.name).sort()).toEqual([...knownAdapters].sort());
    expect(knownAdapters.every((name) => isKnownAdapter(name))).toBe(true);
  });

  test("resolves known adapters with run and health methods", () => {
    for (const name of ["fake", "codex"] as const) {
      expect(isKnownAdapter(name)).toBe(true);
      const adapter = getAdapter(name);
      expect(adapter.name).toBe(name);
      expect(typeof adapter.run).toBe("function");
      expect(typeof adapter.health).toBe("function");
      expect(typeof adapter.doctorCheck).toBe("function");
    }
  });

  test("fake adapter reports always available", async () => {
    const health = await getAdapter("fake").health();
    expect(health).toEqual({ available: true });
  });

  test("codex adapter delegates health probe to codex module", async () => {
    mockCheckCodexAdapterHealth.mockResolvedValue({
      adapter: "codex",
      available: true,
      command: "codex",
      version: "codex-cli 1.0.0",
      supports_model_selection: true,
      supports_reasoning_level: true,
      allowed_models: [],
      allowed_reasoning_levels: ["high"]
    });
    const health = await getAdapter("codex").health();
    expect(health).toEqual({ available: true, version: "codex-cli 1.0.0" });
    expect(mockCheckCodexAdapterHealth).toHaveBeenCalledOnce();
  });
});
