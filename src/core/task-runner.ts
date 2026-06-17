import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { RuntimePaths } from "../storage/paths.js";
import {
  resultEnvelopeSchema,
  schemaVersion,
  type ResultEnvelope,
  type Session,
  type TaskEnvelope
} from "../schemas/index.js";
import { newArtifactId, newAttemptId } from "./id.js";
import { nowIso } from "./time.js";
import { Store, type StoredArtifact, type StoredAttempt, type StoredTask } from "../db/store.js";
import { createPatch, excludeHarness } from "./git.js";
import { execShell } from "./exec.js";
import { writeHarnessFiles } from "./harness.js";
import { failureStatuses, type TaskRuntimeStatus } from "./status.js";

export interface RunningAttempt {
  child: ChildProcess;
  attempt_id: string;
  cancelled: boolean;
  timedOut: boolean;
}

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
    private readonly running: Map<string, RunningAttempt>
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
    const attempt: StoredAttempt = {
      attempt_id: attemptId,
      task_id: task.task_id,
      attempt_number: attemptNumber,
      status: "running",
      created_at: timestamp,
      updated_at: timestamp,
      started_at: timestamp
    };
    this.store.insertAttempt(attempt);
    this.store.updateTaskStatus(task.task_id, "running", attemptId);
    this.store.updateGroupStatus(task.group_id, "running");

    const worktreePath = await this.createWorktree(session, task);
    const harnessDir = path.join(worktreePath, ".any-subagents");
    const logPath = path.join(this.paths.logsDir, session.session_id, task.task_id, `${attemptId}.log`);
    const resultPath = path.join(harnessDir, "result.json");
    await Promise.all([mkdir(harnessDir, { recursive: true }), mkdir(path.dirname(logPath), { recursive: true })]);
    await writeHarnessFiles({ harnessDir, envelope: task.envelope, brief: session.brief, attemptId });

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
      currentAttempt = {
        ...currentAttempt,
        status: "cancelled",
        error: "Task cancelled",
        updated_at: nowIso(),
        finished_at: nowIso()
      };
      this.store.updateAttempt(currentAttempt);
      await this.registerEvidence({ session, task, attempt: currentAttempt, worktreePath, logPath });
      return { attemptId, status: "cancelled" };
    }

    const runResult = await this.runAdapter({ task, attemptId, worktreePath, logPath });
    this.running.delete(task.task_id);

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
    this.store.updateTaskStatus(task.task_id, status);
    await this.registerEvidence({ session, task, attempt: currentAttempt, worktreePath, logPath });
    this.store.appendEvent({
      type: `task.${status}`,
      session_id: task.session_id,
      group_id: task.group_id,
      task_id: task.task_id,
      attempt_id: attemptId,
      severity: failureStatuses.has(status) ? "warning" : "info",
      message: `Task finished with status ${status}`
    });
    return { attemptId, status };
  }

  private async createWorktree(session: Session, task: StoredTask): Promise<string> {
    const { execRequired } = await import("./exec.js");
    await mkdir(this.paths.worktreeRoot, { recursive: true });
    const project = path.basename(session.repo).replace(/[^A-Za-z0-9._-]/g, "-") || "repo";
    const worktreePath = path.join(this.paths.worktreeRoot, `${project}-${task.task_id}`);
    await execRequired("git", ["worktree", "add", "--detach", worktreePath, task.envelope.base_ref ?? session.base_ref], session.repo);
    await excludeHarness(worktreePath);
    return worktreePath;
  }

  private async runAdapter(input: {
    task: StoredTask;
    attemptId: string;
    worktreePath: string;
    logPath: string;
  }): Promise<{ cancelled: boolean; timedOut: boolean; exitCode: number | null }> {
    if (input.task.adapter !== "fake") {
      throw new Error(`Unsupported adapter: ${input.task.adapter}`);
    }

    const logStream = createWriteStream(input.logPath, { flags: "a" });
    const child = spawn(process.execPath, [path.join(input.worktreePath, ".any-subagents", "fake-adapter.mjs")], {
      cwd: input.worktreePath,
      env: {
        ...process.env,
        ANY_SUBAGENTS_ATTEMPT_ID: input.attemptId
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout?.pipe(logStream, { end: false });
    child.stderr?.pipe(logStream, { end: false });
    const running: RunningAttempt = { child, attempt_id: input.attemptId, cancelled: false, timedOut: false };
    this.running.set(input.task.task_id, running);

    const timeoutMs = input.task.envelope.timeout_ms;
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            running.timedOut = true;
            child.kill("SIGTERM");
          }, timeoutMs);

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("exit", (code) => resolve(code));
    });
    if (timer) clearTimeout(timer);
    await new Promise<void>((resolve) => logStream.end(resolve));
    return { cancelled: running.cancelled, timedOut: running.timedOut, exitCode };
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

  private async registerEvidence(input: {
    session: Session;
    task: StoredTask;
    attempt: StoredAttempt;
    worktreePath: string;
    logPath: string;
  }): Promise<void> {
    const logPreview = await previewFile(input.logPath);
    const logArtifact = await this.createArtifact({
      session: input.session,
      task: input.task,
      attempt: input.attempt,
      type: "log",
      mime_type: "text/plain",
      summary: "Captured stdout/stderr for the task attempt.",
      localPath: input.logPath,
      preview: logPreview
    });
    this.store.insertArtifact(logArtifact);

    if (input.task.mode !== "write") {
      return;
    }

    const patch = await createPatch(input.worktreePath);
    if (patch.trim().length > 0) {
      const patchPath = path.join(this.paths.artifactsDir, input.session.session_id, input.task.task_id, `${input.attempt.attempt_id}.patch`);
      await mkdir(path.dirname(patchPath), { recursive: true });
      await writeFile(patchPath, patch);
      const patchArtifact = await this.createArtifact({
        session: input.session,
        task: input.task,
        attempt: input.attempt,
        type: "diff",
        mime_type: "text/x-diff",
        summary: "Patch produced by the task attempt.",
        localPath: patchPath,
        preview: patch.slice(0, 4_096)
      });
      this.store.insertArtifact(patchArtifact);
    }
  }

  private async createArtifact(input: {
    session: Session;
    task: StoredTask;
    attempt: StoredAttempt;
    type: StoredArtifact["type"];
    mime_type: string;
    summary: string;
    localPath: string;
    preview?: string;
  }): Promise<StoredArtifact> {
    const artifactId = newArtifactId();
    const size = await stat(input.localPath);
    const hash = createHash("sha256").update(await readFile(input.localPath)).digest("hex");
    return {
      schema_version: schemaVersion,
      artifact_id: artifactId,
      scope: {
        session_id: input.session.session_id,
        group_id: input.task.group_id,
        task_id: input.task.task_id,
        attempt_id: input.attempt.attempt_id
      },
      type: input.type,
      mime_type: input.mime_type,
      summary: input.summary,
      created_at: nowIso(),
      resource_uri: `any-subagents://sessions/${input.session.session_id}/tasks/${input.task.task_id}/artifacts/${artifactId}`,
      size_bytes: size.size,
      hash,
      preview: input.preview,
      path: input.localPath
    };
  }
}

const previewFile = async (filePath: string): Promise<string> => {
  const content = await readFile(filePath, "utf8");
  return content.slice(0, 4_096);
};
