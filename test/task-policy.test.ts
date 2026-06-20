import { describe, expect, test } from "vitest";
import { resolveTaskFields, TaskPolicyError } from "../src/core/task-policy.js";

describe("task policy", () => {
  test("rejects disallowed model when allow_fallback is absent", () => {
    expect(() =>
      resolveTaskFields(
        { model: "gpt-5" },
        { allowed_models: ["gpt-4"], default_model: "gpt-4" }
      )
    ).toThrow(TaskPolicyError);
  });

  test("rejects disallowed model when allow_fallback is false", () => {
    expect(() =>
      resolveTaskFields(
        { model: "gpt-5", allow_fallback: false },
        { allowed_models: ["gpt-4"], default_model: "gpt-4" }
      )
    ).toThrow(TaskPolicyError);
  });

  test("applies profile default when allow_fallback is true", () => {
    const resolved = resolveTaskFields(
      { model: "gpt-5", allow_fallback: true },
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

  test("rejects disallowed reasoning level when allow_fallback is absent", () => {
    expect(() =>
      resolveTaskFields(
        { reasoning_level: "high" },
        { allowed_reasoning_levels: ["medium"], default_reasoning_level: "medium" }
      )
    ).toThrow(TaskPolicyError);
  });

  test("applies reasoning fallback when allow_fallback is true", () => {
    const resolved = resolveTaskFields(
      { reasoning_level: "high", allow_fallback: true },
      { allowed_reasoning_levels: ["medium"], default_reasoning_level: "medium" }
    );
    expect(resolved.effectiveReasoning).toBe("medium");
    expect(resolved.events[0]?.type).toBe("task.reasoning_fallback");
  });

  test("accepts any model when allowlist is empty", () => {
    const resolved = resolveTaskFields({ model: "gpt-5" }, { allowed_models: [], default_model: "gpt-4" });
    expect(resolved.effectiveModel).toBe("gpt-5");
    expect(resolved.events).toHaveLength(0);
  });

  test("TaskPolicyError exposes structured rejection metadata", () => {
    try {
      resolveTaskFields({ model: "gpt-5" }, { allowed_models: ["gpt-4"], default_model: "gpt-4" });
      expect.unreachable("expected TaskPolicyError");
    } catch (error) {
      expect(error).toBeInstanceOf(TaskPolicyError);
      const policyError = error as TaskPolicyError;
      expect(policyError.code).toBe("TASK_POLICY");
      expect(policyError.field).toBe("model");
      expect(policyError.requested).toBe("gpt-5");
      expect(policyError.allowlist).toEqual(["gpt-4"]);
    }
  });
});
