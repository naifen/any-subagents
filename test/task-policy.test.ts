import { describe, expect, test } from "vitest";
import { resolveTaskFields } from "../src/core/task-policy.js";

describe("task policy", () => {
  test("applies profile default when requested model is not allowlisted", () => {
    const resolved = resolveTaskFields(
      { model: "gpt-5" },
      { allowed_models: ["gpt-4"], default_model: "gpt-4" }
    );
    expect(resolved.effectiveModel).toBe("gpt-4");
    expect(resolved.events).toHaveLength(1);
    expect(resolved.events[0]?.type).toBe("task.model_fallback");
  });

  test("keeps requested model when allowlisted", () => {
    const resolved = resolveTaskFields({ model: "gpt-4" }, { allowed_models: ["gpt-4"], default_model: "gpt-4-mini" });
    expect(resolved.effectiveModel).toBe("gpt-4");
    expect(resolved.events).toHaveLength(0);
  });

  test("applies reasoning fallback when not allowlisted", () => {
    const resolved = resolveTaskFields(
      { reasoning_level: "high" },
      { allowed_reasoning_levels: ["medium"], default_reasoning_level: "medium" }
    );
    expect(resolved.effectiveReasoning).toBe("medium");
    expect(resolved.events[0]?.type).toBe("task.reasoning_fallback");
  });
});
