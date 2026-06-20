import path from "node:path";
import type { Adapter, AdapterDoctorCheck, AdapterHealthSnapshot, AdapterRunContext, AdapterRunOutcome } from "./types.js";

export class FakeAdapter implements Adapter {
  readonly name = "fake" as const;

  async run(context: AdapterRunContext): Promise<AdapterRunOutcome> {
    return context.spawn.spawn({
      taskId: context.task.task_id,
      attemptId: context.attemptId,
      command: process.execPath,
      args: [path.join(context.worktreePath, ".any-subagents", "fake-adapter.mjs")],
      cwd: context.worktreePath,
      logPath: context.logPath,
      ...(context.task.envelope.timeout_ms === undefined ? {} : { timeoutMs: context.task.envelope.timeout_ms })
    });
  }

  async health(): Promise<AdapterHealthSnapshot> {
    return { available: true };
  }

  doctorCheck(_health: AdapterHealthSnapshot): AdapterDoctorCheck {
    return { status: "pass", message: "Fake adapter is built in" };
  }
}
