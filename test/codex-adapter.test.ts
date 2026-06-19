import { describe, expect, test } from "vitest";
import {
  buildCodexArgs,
  checkCodexAdapterHealth,
  renderCodexPrompt,
  smokeCodexAdapter,
  synthesizeResult
} from "../src/adapters/codex.js";
import { appendCodexJsonlLines, flushCodexJsonlBuffer } from "../src/adapters/codex-events.js";
import { resultEnvelopeSchema } from "../src/schemas/index.js";
import type { SessionBrief, TaskEnvelope } from "../src/schemas/index.js";

const baseTask = (overrides: Partial<TaskEnvelope> = {}): TaskEnvelope => ({
  schema_version: "1",
  task_id: "task_test123",
  session_id: "sess_test123",
  group_id: "grp_test123",
  mode: "research",
  goal: "Investigate auth flow",
  adapter: "codex",
  profile: "default",
  success_criteria: ["Document the auth entry points"],
  ...overrides
});

const baseBrief = (overrides: Partial<SessionBrief> = {}): SessionBrief => ({
  goal: "Improve session handling",
  constraints: ["Do not change public APIs"],
  decisions: ["Use JWT for v1"],
  accepted_findings: ["Refresh tokens rotate on use"],
  rejected_paths: ["OAuth implicit flow"],
  open_questions: ["Should we add rate limiting?"],
  ...overrides
});

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

describe("buildCodexArgs", () => {
  test("builds exec args with model, reasoning level, and worktree path", () => {
    const args = buildCodexArgs({
      worktreePath: "/tmp/worktree",
      model: "gpt-5.4",
      reasoning_level: "high",
      prompt: "Do the task"
    });
    expect(args).toEqual([
      "exec",
      "-m",
      "gpt-5.4",
      "-c",
      "model_reasoning_effort=high",
      "--full-auto",
      "-C",
      "/tmp/worktree",
      "--skip-git-repo-check",
      "--json",
      "--ephemeral",
      "Do the task"
    ]);
  });

  test("maps max reasoning level to xhigh for codex config", () => {
    const args = buildCodexArgs({
      worktreePath: "/tmp/worktree",
      reasoning_level: "max",
      prompt: "Do the task"
    });
    expect(args).toContain("-c");
    expect(args).toContain("model_reasoning_effort=xhigh");
  });

  test("passes minimal and xhigh reasoning levels through to codex config", () => {
    for (const level of ["minimal", "xhigh"] as const) {
      const args = buildCodexArgs({
        worktreePath: "/tmp/worktree",
        reasoning_level: level,
        prompt: "Do the task"
      });
      expect(args).toContain(`model_reasoning_effort=${level}`);
    }
  });

  test("omits model and reasoning flags when absent", () => {
    const args = buildCodexArgs({
      worktreePath: "/tmp/worktree",
      prompt: "Do the task"
    });
    expect(args).not.toContain("-m");
    expect(args).not.toContain("-c");
    expect(args).toEqual([
      "exec",
      "--full-auto",
      "-C",
      "/tmp/worktree",
      "--skip-git-repo-check",
      "--json",
      "--ephemeral",
      "Do the task"
    ]);
  });
});

describe("renderCodexPrompt", () => {
  test("includes task goal, success criteria, constraints, and scope", () => {
    const prompt = renderCodexPrompt(
      baseTask({
        constraints: ["Keep changes minimal"],
        scope: { paths: ["src/auth.ts"], notes: "Auth module only" }
      }),
      baseBrief()
    );
    expect(prompt).toContain("Goal: Investigate auth flow");
    expect(prompt).toContain("Success criteria:");
    expect(prompt).toContain("- Document the auth entry points");
    expect(prompt).toContain("Task constraints:");
    expect(prompt).toContain("- Keep changes minimal");
    expect(prompt).toContain("Scope paths:");
    expect(prompt).toContain("- src/auth.ts");
    expect(prompt).toContain("Scope notes: Auth module only");
  });

  test("includes session brief context", () => {
    const prompt = renderCodexPrompt(baseTask(), baseBrief());
    expect(prompt).toContain("Session goal: Improve session handling");
    expect(prompt).toContain("Session constraints:");
    expect(prompt).toContain("- Do not change public APIs");
    expect(prompt).toContain("Accepted findings:");
    expect(prompt).toContain("- Refresh tokens rotate on use");
    expect(prompt).toContain("Rejected paths:");
    expect(prompt).toContain("- OAuth implicit flow");
    expect(prompt).toContain("Open questions:");
    expect(prompt).toContain("- Should we add rate limiting?");
  });

  test("omits empty optional sections", () => {
    const prompt = renderCodexPrompt(
      baseTask({ constraints: undefined, scope: undefined }),
      baseBrief({
        constraints: [],
        decisions: [],
        accepted_findings: [],
        rejected_paths: [],
        open_questions: []
      })
    );
    expect(prompt).not.toContain("Task constraints:");
    expect(prompt).not.toContain("Scope paths:");
    expect(prompt).not.toContain("Session constraints:");
    expect(prompt).not.toContain("Accepted findings:");
  });
});

describe("synthesizeResult", () => {
  const baseInput = {
    taskId: "task_test123",
    attemptId: "att_test123",
    mode: "research" as const
  };

  test("marks exit code 0 as completed with summary from last agent message", () => {
    const result = synthesizeResult({
      ...baseInput,
      exitCode: 0,
      jsonlLines: [
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_1", type: "agent_message", text: "First finding." }
        }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_2", type: "agent_message", text: "Final summary." }
        })
      ]
    });
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("Final summary.");
    expect(result.findings).toEqual([{ summary: "First finding." }, { summary: "Final summary." }]);
    expect(result.verification).toEqual([]);
    expect(result.artifacts).toEqual([]);
    expect(result.risks).toEqual([]);
    expect(result.proposed_brief_updates).toEqual([]);
  });

  test("marks non-zero exit code as failed", () => {
    const result = synthesizeResult({
      ...baseInput,
      exitCode: 1,
      jsonlLines: [
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_1", type: "agent_message", text: "Partial work." }
        })
      ]
    });
    expect(result.status).toBe("failed");
    expect(result.summary).toBe("Codex exited with code 1. Last agent message: Partial work.");
  });

  test("collects file changes in write mode", () => {
    const result = synthesizeResult({
      ...baseInput,
      mode: "write",
      exitCode: 0,
      jsonlLines: [
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_1",
            type: "file_change",
            status: "completed",
            changes: [
              { path: "src/auth.ts", kind: "update" },
              { path: "src/auth.test.ts", kind: "add" }
            ]
          }
        }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_2", type: "agent_message", text: "Updated auth module." }
        })
      ]
    });
    expect(result.changes).toEqual([
      { path: "src/auth.ts", summary: "update" },
      { path: "src/auth.test.ts", summary: "add" }
    ]);
    expect(result.findings).toBeUndefined();
    expect(result.summary).toBe("Updated auth module.");
  });

  test("uses findings for write mode when no file changes are reported", () => {
    const result = synthesizeResult({
      ...baseInput,
      mode: "write",
      exitCode: 0,
      jsonlLines: [
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_1", type: "agent_message", text: "No files changed." }
        })
      ]
    });
    expect(result.changes).toBeUndefined();
    expect(result.findings).toEqual([{ summary: "No files changed." }]);
  });

  test("extracts usage from turn.completed events", () => {
    const result = synthesizeResult({
      ...baseInput,
      exitCode: 0,
      jsonlLines: [
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_1", type: "agent_message", text: "Done." }
        }),
        JSON.stringify({
          type: "turn.completed",
          usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 30, reasoning_output_tokens: 5 }
        })
      ]
    });
    expect(result.usage).toEqual({
      input_tokens: 100,
      cached_input_tokens: 20,
      output_tokens: 30,
      reasoning_output_tokens: 5
    });
  });

  test("handles empty events with a fallback summary", () => {
    const result = synthesizeResult({
      ...baseInput,
      exitCode: 0,
      jsonlLines: []
    });
    expect(result.status).toBe("completed");
    expect(result.summary).toBe("Codex completed without agent messages.");
    expect(result.findings).toEqual([{ summary: "Codex completed without agent messages." }]);
  });

  test("skips malformed JSONL lines", () => {
    const result = synthesizeResult({
      ...baseInput,
      exitCode: 0,
      jsonlLines: [
        "{not valid json",
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_1", type: "agent_message", text: "Valid line." }
        })
      ]
    });
    expect(result.summary).toBe("Valid line.");
    expect(result.findings).toEqual([{ summary: "Valid line." }]);
  });

  test("accepts legacy assistant_message item type", () => {
    const result = synthesizeResult({
      ...baseInput,
      exitCode: 0,
      jsonlLines: [
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_1", item_type: "assistant_message", text: "Legacy message." }
        })
      ]
    });
    expect(result.summary).toBe("Legacy message.");
  });

  test("ignores malformed item.completed events without throwing", () => {
    const result = synthesizeResult({
      ...baseInput,
      exitCode: 0,
      jsonlLines: [
        JSON.stringify({ type: "item.completed", item: null }),
        JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: 123 } }),
        JSON.stringify({
          type: "item.completed",
          item: { id: "item_1", type: "agent_message", text: "Surviving message." }
        })
      ]
    });
    expect(result.summary).toBe("Surviving message.");
  });

  test("filters invalid file changes instead of failing contract validation", () => {
    const result = synthesizeResult({
      ...baseInput,
      mode: "write",
      exitCode: 0,
      jsonlLines: [
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "file_change",
            changes: [
              { path: "", kind: "update" },
              { path: "src/valid.ts", kind: "" },
              { path: "src/valid.ts", kind: "update" }
            ]
          }
        })
      ]
    });
    expect(result.changes).toEqual([{ path: "src/valid.ts", summary: "update" }]);
    expect(resultEnvelopeSchema.safeParse(result).success).toBe(true);
  });

  test("produces result envelopes that pass schema validation", () => {
    const scenarios = [
      synthesizeResult({
        ...baseInput,
        exitCode: 0,
        jsonlLines: [
          JSON.stringify({
            type: "item.completed",
            item: { type: "agent_message", text: "Finding." }
          })
        ]
      }),
      synthesizeResult({
        ...baseInput,
        mode: "write",
        exitCode: 0,
        jsonlLines: [
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "file_change",
              changes: [{ path: "src/a.ts", kind: "update" }]
            }
          })
        ]
      })
    ];
    for (const result of scenarios) {
      expect(resultEnvelopeSchema.safeParse(result).success).toBe(true);
    }
  });

  test("ignores turn.completed events with invalid usage", () => {
    const result = synthesizeResult({
      ...baseInput,
      exitCode: 0,
      jsonlLines: [
        JSON.stringify({ type: "turn.completed", usage: "high" }),
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "Done." }
        })
      ]
    });
    expect(result.usage).toBeUndefined();
    expect(resultEnvelopeSchema.safeParse(result).success).toBe(true);
  });
});

describe("appendCodexJsonlLines and flushCodexJsonlBuffer", () => {
  test("reassembles JSONL split across multiple chunks", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "chunked" }
    });
    const split = Math.floor(line.length / 2);
    let buffer = "";
    const first = appendCodexJsonlLines(buffer, line.slice(0, split));
    buffer = first.buffer;
    const second = appendCodexJsonlLines(buffer, line.slice(split));
    const flushed = flushCodexJsonlBuffer(second.buffer);
    expect([...first.lines, ...second.lines, ...flushed]).toEqual([line]);
  });
});
