import { writeFile } from "node:fs/promises";
import {
  appendCodexJsonlLines,
  CODEX_COMMAND,
  flushCodexJsonlBuffer
} from "./codex-events.js";
import {
  buildCodexArgs,
  checkCodexAdapterHealth,
  renderCodexPrompt,
  synthesizeResult
} from "./codex.js";
import type { Adapter, AdapterDoctorCheck, AdapterHealthSnapshot, AdapterRunContext, AdapterRunOutcome } from "./types.js";

const codexUnavailableMessage = "Codex CLI not available";

export class CodexAdapter implements Adapter {
  readonly name = "codex" as const;

  async run(context: AdapterRunContext): Promise<AdapterRunOutcome> {
    const prompt = renderCodexPrompt(context.task.envelope, context.sessionBrief);
    const args = buildCodexArgs({
      worktreePath: context.worktreePath,
      ...(context.task.envelope.model ? { model: context.task.envelope.model } : {}),
      ...(context.task.envelope.reasoning_level ? { reasoning_level: context.task.envelope.reasoning_level } : {}),
      prompt
    });

    const jsonlLines: string[] = [];
    let jsonlBuffer = "";
    const spawnResult = await context.spawn.spawn({
      taskId: context.task.task_id,
      attemptId: context.attemptId,
      command: CODEX_COMMAND,
      args,
      cwd: context.worktreePath,
      logPath: context.logPath,
      ...(context.task.envelope.timeout_ms === undefined ? {} : { timeoutMs: context.task.envelope.timeout_ms }),
      captureStdout: (chunk) => {
        const parsed = appendCodexJsonlLines(jsonlBuffer, chunk);
        jsonlBuffer = parsed.buffer;
        jsonlLines.push(...parsed.lines);
      }
    });
    jsonlLines.push(...flushCodexJsonlBuffer(jsonlBuffer));

    // ADR-0007: codex exec does not write result.json; the adapter synthesizes the envelope.
    const result = synthesizeResult({
      taskId: context.task.task_id,
      attemptId: context.attemptId,
      mode: context.task.envelope.mode,
      exitCode: spawnResult.exitCode,
      jsonlLines
    });
    await writeFile(context.resultPath, `${JSON.stringify(result, null, 2)}\n`);

    return spawnResult;
  }

  async health(): Promise<AdapterHealthSnapshot> {
    const health = await checkCodexAdapterHealth({ command: CODEX_COMMAND });
    if (health.available) {
      return {
        available: true,
        ...(health.version ? { version: health.version } : {})
      };
    }
    return {
      available: false,
      reason: health.reason ?? codexUnavailableMessage
    };
  }

  doctorCheck(health: AdapterHealthSnapshot): AdapterDoctorCheck {
    if (health.available) {
      return {
        status: "pass",
        message: `Codex CLI available (${health.version ?? "unknown version"})`
      };
    }
    return {
      status: "warn",
      message: health.reason ?? codexUnavailableMessage
    };
  }
}
