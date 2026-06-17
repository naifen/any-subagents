import { describe, expect, test } from "vitest";
import { publicSchemas, resultEnvelopeSchema, taskEnvelopeSchema } from "../src/schemas/index.js";

describe("public schemas", () => {
  test("reject unknown top-level task fields while allowing metadata extensions", () => {
    const validTask = {
      schema_version: "1",
      task_id: "task_abc",
      session_id: "sess_abc",
      group_id: "grp_abc",
      mode: "write",
      goal: "Add the focused behavior.",
      adapter: "fake",
      profile: "default",
      scope: { paths: ["src/example.ts"] },
      success_criteria: ["The behavior is observable through the public API."],
      metadata: { ticket: "T-1" }
    };

    expect(taskEnvelopeSchema.parse(validTask).metadata?.["ticket"]).toBe("T-1");
    expect(taskEnvelopeSchema.safeParse({ ...validTask, typo: true }).success).toBe(false);
  });

  test("requires write tasks to declare scope", () => {
    const result = taskEnvelopeSchema.safeParse({
      schema_version: "1",
      task_id: "task_abc",
      session_id: "sess_abc",
      group_id: "grp_abc",
      mode: "write",
      goal: "Change files.",
      adapter: "fake",
      profile: "default",
      success_criteria: ["A scoped write is completed."]
    });

    expect(result.success).toBe(false);
  });

  test("result envelopes must include task identity and at least findings or changes", () => {
    const validResult = {
      schema_version: "1",
      task_id: "task_abc",
      attempt_id: "att_abc",
      status: "completed",
      summary: "Completed the task.",
      findings: [{ summary: "The behavior is present." }],
      verification: [{ command: "npm test", status: "passed" }],
      artifacts: [],
      risks: [],
      proposed_brief_updates: []
    };

    expect(resultEnvelopeSchema.parse(validResult).task_id).toBe("task_abc");
    expect(resultEnvelopeSchema.safeParse({ ...validResult, findings: undefined }).success).toBe(false);
  });

  test("publishes JSON schemas for the documented public objects", () => {
    expect(Object.keys(publicSchemas).sort()).toEqual([
      "artifact",
      "effective_config",
      "event",
      "result_envelope",
      "session",
      "task_attempt",
      "task_envelope",
      "task_group"
    ]);
  });
});
