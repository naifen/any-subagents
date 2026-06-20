import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimePaths } from "../storage/paths.js";
import {
  resultEnvelopeSchema,
  type ResultEnvelope,
  type Session,
} from "../schemas/index.js";
import { newAttemptId } from "../util/id.js";
import { nowIso } from "../util/time.js";
import { Store, type StoredAttempt, type StoredTask } from "../db/store.js";
import { createTaskWorktree } from "./worktree.js";
import { registerAttemptEvidence } from "./attempt-evidence.js";
import { resolveTaskProfilePolicy } from "./task-policy.js";
import { execShell } from "./exec.js";
import { finalizeAttempt } from "./lifecycle.js";
import { writeHarnessFiles } from "./harness.js";
import type { SessionBrief } from "../schemas/index.js";
import { failureStatuses, type TaskRuntimeStatus } from "../domain/status.js";
import { getAdapter, isKnownAdapter } from "../adapters/registry.js";
import type { AttemptSpawner } from "../adapters/types.js";
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
    this.store.startAttempt(attempt, task.group_id);

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
      taskId: task.task_id,
      groupId: task.group_id,
      attempt: currentAttempt
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
    if (!isKnownAdapter(input.task.adapter)) {
      throw new Error(`Unsupported adapter: ${input.task.adapter}`);
    }
    return getAdapter(input.task.adapter).run({
      task: { task_id: input.task.task_id, envelope: input.task.envelope },
      sessionBrief: input.sessionBrief,
      attemptId: input.attemptId,
      worktreePath: input.worktreePath,
      logPath: input.logPath,
      resultPath: input.resultPath,
      spawn: this.attemptSpawner()
    });
  }

  private attemptSpawner(): AttemptSpawner {
    return {
      spawn: (spawnInput) => spawnSupervised(this.running, spawnInput)
    };
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
