import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimePaths } from "../storage/paths.js";
import {
  resultEnvelopeSchema,
  type ResultEnvelope,
  type Session,
  type TaskEnvelope
} from "../schemas/index.js";
import { newAttemptId } from "../util/id.js";
import { nowIso } from "../util/time.js";
import { Store, type StoredAttempt, type StoredTask } from "../db/store.js";
import { createTaskWorktree } from "./worktree.js";
import { registerAttemptEvidence } from "./attempt-evidence.js";
import { resolveTaskProfilePolicy } from "./task-policy.js";
import { execShell } from "./exec.js";
import { finalizeAttempt } from "./lifecycle.js";
import { writeHarnessFiles, type HarnessInput } from "./harness.js";
import {
  appendCodexJsonlLines,
  CODEX_COMMAND,
  flushCodexJsonlBuffer
} from "../adapters/codex-events.js";
import {
  buildCodexArgs,
  renderCodexPrompt,
  synthesizeResult
} from "../adapters/codex.js";
import type { SessionBrief } from "../schemas/index.js";
import { failureStatuses, type TaskRuntimeStatus } from "../domain/status.js";
import { isKnownAdapter } from "../adapters/registry.js";
import { spawnSupervised, type RunningAttempt } from "./spawn-supervised.js";
import type { AppConfig } from "../config/schema.js";
import { defaultConfig } from "../config/schema.js";
import { mountSkillPaths } from "./skills.js";
import type { MetricsRecorder } from "./metrics-recorder.js";
import { createMetricsRecorder } from "./metrics-recorder.js";

export type { RunningAttempt };

export interface RunTaskResult {
  attemptId: string;
  status: TaskRuntimeStatus;
}

/**
 * Manages the full lifecycle of a single task attempt: worktree creation,
 * harness setup, adapter execution, result parsing, verification, and
 * evidence registration.
 */
export class TaskRunner {
  constructor(
    private readonly store: Store,
    private readonly paths: RuntimePaths,
    private readonly running: Map<string, RunningAttempt>,
    private readonly config: AppConfig = defaultConfig(),
    private readonly metrics: MetricsRecorder = createMetricsRecorder(store)
  ) {}

  /**
   * Execute a task attempt end-to-end. Returns when the attempt is finished.
   *
   * The caller (Scheduler) is responsible for catching errors and updating
   * task/group status on unhandled failures.
   */
  async run(task: StoredTask, session: Session): Promise<RunTaskResult> {
    const attemptId = newAttemptId();
    const attemptNumber = task.attempt_count + 1;
    const timestamp = nowIso();
    const policy = resolveTaskProfilePolicy(this.config, task);
    const requestedModel = task.envelope.requested_model ?? task.envelope.model;
    const requestedReasoning = task.envelope.requested_reasoning_level ?? task.envelope.reasoning_level;
    const effectiveModel = task.envelope.model ?? policy.effectiveModel;
    const effectiveReasoning = task.envelope.reasoning_level ?? policy.effectiveReasoning;
    const attempt: StoredAttempt = {
      attempt_id: attemptId,
      task_id: task.task_id,
      attempt_number: attemptNumber,
      status: "running",
      created_at: timestamp,
      updated_at: timestamp,
      started_at: timestamp,
      ...(requestedModel ? { requested_model: requestedModel } : {}),
      ...(effectiveModel ? { effective_model: effectiveModel } : {}),
      ...(requestedReasoning ? { requested_reasoning_level: requestedReasoning } : {}),
      ...(effectiveReasoning ? { effective_reasoning_level: effectiveReasoning } : {}),
      ...(task.envelope.permissions ? { requested_permissions: task.envelope.permissions } : {}),
      ...(task.envelope.sandbox ? { requested_sandbox: task.envelope.sandbox } : {}),
      ...(policy.effectivePermissions ? { effective_permissions: policy.effectivePermissions } : {}),
      ...(policy.effectiveSandbox ? { effective_sandbox: policy.effectiveSandbox } : {}),
      ...(policy.networkPolicy ? { network_policy: policy.networkPolicy } : {}),
      ...(policy.packageInstallPolicy ? { package_install_policy: policy.packageInstallPolicy } : {})
    };
    this.store.insertAttempt(attempt);
    this.store.updateTaskStatus(task.task_id, "running", attemptId);
    this.store.updateGroupStatus(task.group_id, "running");

    const worktreePath = await createTaskWorktree({ session, task, paths: this.paths, metrics: this.metrics });
    const harnessDir = path.join(worktreePath, ".any-subagents");
    const logPath = path.join(this.paths.logsDir, session.session_id, task.task_id, `${attemptId}.log`);
    const resultPath = path.join(harnessDir, "result.json");
    await Promise.all([mkdir(harnessDir, { recursive: true }), mkdir(path.dirname(logPath), { recursive: true })]);
    const mountedSkills = await mountSkillPaths({
      skillPaths: this.config.skill_paths,
      allowlist: this.config.skill_path_allowlist,
      mountMode: this.config.skill_mount,
      worktreePath
    });
    await writeHarnessFiles({
      harnessDir,
      envelope: task.envelope,
      brief: session.brief,
      attemptId,
      mountedSkills,
      config: this.config,
      paths: this.paths
    });

    let currentAttempt: StoredAttempt = {
      ...attempt,
      worktree_path: worktreePath,
      log_path: logPath,
      result_path: resultPath,
      updated_at: nowIso()
    };
    this.store.updateAttempt(currentAttempt);

    if (this.store.getTask(task.task_id)?.status === "cancelled") {
      await writeFile(logPath, "", { flag: "a" });
      finalizeAttempt(this.store, {
        attemptId,
        taskId: task.task_id,
        groupId: task.group_id,
        status: "cancelled",
        error: "Task cancelled"
      });
      currentAttempt = { ...currentAttempt, status: "cancelled" };
      await registerAttemptEvidence({
        store: this.store,
        config: this.config,
        paths: this.paths,
        session,
        task,
        attempt: currentAttempt,
        worktreePath,
        logPath
      });
      return { attemptId, status: "cancelled" };
    }

    const runResult = await this.runAdapter({
      task,
      sessionBrief: session.brief,
      attemptId,
      worktreePath,
      logPath,
      resultPath
    });

    let status: TaskRuntimeStatus;
    let parsedResult: ResultEnvelope | undefined;
    let error: string | undefined;

    if (runResult.cancelled) {
      status = "cancelled";
      error = "Task cancelled";
    } else if (runResult.timedOut) {
      status = "timed_out";
      error = "Task timed out";
    } else {
      const parsed = await this.parseResultFile(resultPath, task.task_id, attemptId);
      if (parsed.ok) {
        parsedResult = parsed.result;
        status = await this.statusFromResult(task, parsed.result, worktreePath, logPath);
      } else {
        status = "failed_contract";
        error = parsed.error;
      }
    }

    currentAttempt = {
      ...currentAttempt,
      status,
      ...(parsedResult ? { result: parsedResult } : {}),
      ...(error ? { error } : {}),
      updated_at: nowIso(),
      finished_at: nowIso()
    };
    this.store.updateAttempt(currentAttempt);
    await registerAttemptEvidence({
      store: this.store,
      config: this.config,
      paths: this.paths,
      session,
      task,
      attempt: currentAttempt,
      worktreePath,
      logPath
    });
    this.store.appendEvent({
      type: `task.${status}`,
      session_id: task.session_id,
      group_id: task.group_id,
      task_id: task.task_id,
      attempt_id: attemptId,
      severity: failureStatuses.has(status) ? "warning" : "info",
      message: `Task finished with status ${status}`
    });
    if (failureStatuses.has(status)) {
      this.metrics.record("adapter_failure_total", 1, {
        session_id: task.session_id,
        group_id: task.group_id,
        task_id: task.task_id,
        attempt_id: attemptId,
        adapter: task.adapter,
        status
      });
    }
    this.metrics.record("verification_outcome", status === "completed_with_failed_verification" ? 0 : 1, {
      session_id: task.session_id,
      group_id: task.group_id,
      task_id: task.task_id,
      attempt_id: attemptId,
      status
    });
    finalizeAttempt(this.store, {
      attemptId,
      taskId: task.task_id,
      groupId: task.group_id,
      status,
      ...(error ? { error } : {})
    });
    return { attemptId, status };
  }

  private async runAdapter(input: {
    task: StoredTask;
    sessionBrief: SessionBrief;
    attemptId: string;
    worktreePath: string;
    logPath: string;
    resultPath: string;
  }): Promise<{ cancelled: boolean; timedOut: boolean; exitCode: number | null }> {
    // `adapter` is an open string by design (provider-neutral), so narrow to the
    // set this harness implements before an exhaustive switch guarantees that a
    // newly listed adapter cannot be silently left unhandled.
    if (!isKnownAdapter(input.task.adapter)) {
      throw new Error(`Unsupported adapter: ${input.task.adapter}`);
    }
    const adapter = input.task.adapter;
    switch (adapter) {
      case "codex":
        return this.runCodexAdapter(input);
      case "fake":
        return this.runFakeAdapter(input);
      default: {
        const unhandled: never = adapter;
        throw new Error(`Unsupported adapter: ${String(unhandled)}`);
      }
    }
  }

  private async runFakeAdapter(input: {
    task: StoredTask;
    attemptId: string;
    worktreePath: string;
    logPath: string;
  }): Promise<{ cancelled: boolean; timedOut: boolean; exitCode: number | null }> {
    return spawnSupervised(this.running, {
      taskId: input.task.task_id,
      attemptId: input.attemptId,
      command: process.execPath,
      args: [path.join(input.worktreePath, ".any-subagents", "fake-adapter.mjs")],
      cwd: input.worktreePath,
      logPath: input.logPath,
      ...(input.task.envelope.timeout_ms === undefined ? {} : { timeoutMs: input.task.envelope.timeout_ms })
    });
  }

  private async runCodexAdapter(input: {
    task: StoredTask;
    sessionBrief: SessionBrief;
    attemptId: string;
    worktreePath: string;
    logPath: string;
    resultPath: string;
  }): Promise<{ cancelled: boolean; timedOut: boolean; exitCode: number | null }> {
    const prompt = renderCodexPrompt(input.task.envelope, input.sessionBrief);
    const args = buildCodexArgs({
      worktreePath: input.worktreePath,
      ...(input.task.envelope.model ? { model: input.task.envelope.model } : {}),
      ...(input.task.envelope.reasoning_level ? { reasoning_level: input.task.envelope.reasoning_level } : {}),
      prompt
    });

    const jsonlLines: string[] = [];
    let jsonlBuffer = "";
    const spawnResult = await spawnSupervised(this.running, {
      taskId: input.task.task_id,
      attemptId: input.attemptId,
      command: CODEX_COMMAND,
      args,
      cwd: input.worktreePath,
      logPath: input.logPath,
      ...(input.task.envelope.timeout_ms === undefined ? {} : { timeoutMs: input.task.envelope.timeout_ms }),
      captureStdout: (chunk) => {
        const parsed = appendCodexJsonlLines(jsonlBuffer, chunk);
        jsonlBuffer = parsed.buffer;
        jsonlLines.push(...parsed.lines);
      }
    });
    jsonlLines.push(...flushCodexJsonlBuffer(jsonlBuffer));

    // Harness-owned path (ADR 0007): the Codex adapter synthesizes result.json
    // itself so the shared finalization path can treat every adapter uniformly.
    // codex exec is not instructed to write this file.
    const result = synthesizeResult({
      taskId: input.task.task_id,
      attemptId: input.attemptId,
      mode: input.task.envelope.mode,
      exitCode: spawnResult.exitCode,
      jsonlLines
    });
    await writeFile(input.resultPath, `${JSON.stringify(result, null, 2)}\n`);

    return spawnResult;
  }

  private async parseResultFile(resultPath: string, taskId: string, attemptId: string): Promise<
    | { ok: true; result: ResultEnvelope }
    | { ok: false; error: string }
  > {
    if (!existsSync(resultPath)) {
      return { ok: false, error: "Missing result.json" };
    }
    try {
      const raw = await readFile(resultPath, "utf8");
      const parsed = resultEnvelopeSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        return { ok: false, error: parsed.error.message };
      }
      if (parsed.data.task_id !== taskId || parsed.data.attempt_id !== attemptId) {
        return { ok: false, error: "Result task_id or attempt_id does not match this attempt" };
      }
      return { ok: true, result: parsed.data };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async statusFromResult(task: StoredTask, result: ResultEnvelope, worktreePath: string, logPath: string): Promise<TaskRuntimeStatus> {
    if (result.status === "blocked") return "blocked";
    if (result.status === "failed") return "failed";
    const verification = await this.runVerification(task, worktreePath, logPath);
    return verification ? "completed" : "completed_with_failed_verification";
  }

  private async runVerification(task: StoredTask, worktreePath: string, logPath: string): Promise<boolean> {
    const commands = task.envelope.verification_commands ?? [];
    if (commands.length === 0) return true;
    const logStream = createWriteStream(logPath, { flags: "a" });
    let passed = true;
    for (const command of commands) {
      const commandText = typeof command === "string" ? command : command.command;
      logStream.write(`\n$ ${commandText}\n`);
      const result = await execShell(commandText, worktreePath);
      logStream.write(result.stdout);
      logStream.write(result.stderr);
      if (result.code !== 0) passed = false;
    }
    await new Promise<void>((resolve) => logStream.end(resolve));
    return passed;
  }
}
