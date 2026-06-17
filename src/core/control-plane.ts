import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { RuntimePaths } from "../storage/paths.js";
import {
  resultEnvelopeSchema,
  publicSchemas,
  schemaVersion,
  sessionBriefSchema,
  taskEnvelopeSchema,
  type ResultEnvelope,
  type Session,
  type SessionBrief,
  type TaskEnvelope,
  type EffectiveConfig
} from "../schemas/index.js";
import { newArtifactId, newAttemptId, newSessionId, newTaskGroupId, newTaskId } from "./id.js";
import { nowIso } from "./time.js";
import { Store, type StoredArtifact, type StoredAttempt, type StoredGroup, type StoredTask, type TaskRuntimeStatus } from "../db/store.js";
import { definedEntries } from "./defined.js";
import { assertGitRepo, assertGitRef, createPatch, excludeHarness, execFileResult, execGit, execRequired, execShell, parsePorcelainChangedFiles } from "./git.js";
import { fakeAdapterScript } from "../adapters/fake-script.js";

export interface ControlPlaneOptions {
  paths: RuntimePaths;
  maxConcurrency?: number;
}

export interface CreateSessionInput {
  repo: string;
  base_ref: string;
  brief?: Partial<SessionBrief>;
  metadata?: Record<string, unknown>;
}

export interface SubmitTaskGroupInput {
  session_id: string;
  title: string;
  expected_brief_revision: number;
  ignore_revision_conflict?: boolean;
  tasks: Array<{
    mode: TaskEnvelope["mode"];
    goal: string;
    adapter: string;
    profile: string;
    success_criteria: string[];
    scope?: TaskEnvelope["scope"];
    constraints?: string[];
    verification_commands?: TaskEnvelope["verification_commands"];
    timeout_ms?: number;
    metadata?: Record<string, unknown>;
  }>;
}

export interface TaskSummary {
  task_id: string;
  group_id: string;
  session_id: string;
  status: TaskRuntimeStatus;
  mode: string;
  goal: string;
  adapter: string;
  profile: string;
  attempt_count: number;
  latest_attempt_id?: string;
}

interface RunningAttempt {
  child: ChildProcess;
  attempt_id: string;
  cancelled: boolean;
  timedOut: boolean;
}

const terminalStatuses = new Set<TaskRuntimeStatus>([
  "completed",
  "blocked",
  "failed",
  "timed_out",
  "cancelled",
  "interrupted",
  "failed_contract",
  "completed_with_failed_verification"
]);

export const createControlPlane = (options: ControlPlaneOptions): ControlPlane => new ControlPlane(options);

export class ControlPlane {
  private readonly store: Store;
  private readonly maxConcurrency: number;
  private readonly queue: string[] = [];
  private readonly active = new Set<string>();
  private readonly taskRuns = new Set<Promise<void>>();
  private readonly running = new Map<string, RunningAttempt>();
  private closed = false;

  constructor(private readonly options: ControlPlaneOptions) {
    this.maxConcurrency = options.maxConcurrency ?? 4;
    this.store = new Store(options.paths.dbPath);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const running of this.running.values()) {
      running.cancelled = true;
      running.child.kill("SIGTERM");
    }
    await Promise.allSettled(Array.from(this.taskRuns));
    this.store.close();
  }

  async createSession(input: CreateSessionInput): Promise<Session> {
    await assertGitRepo(input.repo);
    await assertGitRef(input.repo, input.base_ref);

    const timestamp = nowIso();
    const brief = sessionBriefSchema.parse({
      goal: input.brief?.goal ?? "",
      constraints: input.brief?.constraints ?? [],
      decisions: input.brief?.decisions ?? [],
      accepted_findings: input.brief?.accepted_findings ?? [],
      rejected_paths: input.brief?.rejected_paths ?? [],
      open_questions: input.brief?.open_questions ?? []
    });
    const session: Session = {
      schema_version: schemaVersion,
      session_id: newSessionId(),
      repo: input.repo,
      base_ref: input.base_ref,
      status: "open",
      brief,
      brief_revision: 0,
      created_at: timestamp,
      updated_at: timestamp,
      metadata: input.metadata ?? {}
    };

    this.store.insertSession(session);
    this.store.appendEvent({
      type: "session.created",
      session_id: session.session_id,
      severity: "info",
      message: "Session created"
    });
    return session;
  }

  async submitTaskGroup(input: SubmitTaskGroupInput): Promise<StoredGroup> {
    const session = this.requireSession(input.session_id);
    if (session.brief_revision !== input.expected_brief_revision && input.ignore_revision_conflict !== true) {
      throw new Error(`Brief revision conflict: expected ${input.expected_brief_revision}, got ${session.brief_revision}`);
    }

    const timestamp = nowIso();
    const group: StoredGroup = {
      group_id: newTaskGroupId(),
      session_id: session.session_id,
      title: input.title,
      status: "queued",
      expected_brief_revision: input.expected_brief_revision,
      created_at: timestamp,
      updated_at: timestamp
    };
    const taskInputs = input.tasks.map((taskInput) => {
      const task_id = newTaskId();
      return taskEnvelopeSchema.parse({
        schema_version: schemaVersion,
        task_id,
        session_id: session.session_id,
        group_id: group.group_id,
        mode: taskInput.mode,
        goal: taskInput.goal,
        adapter: taskInput.adapter,
        profile: taskInput.profile,
        scope: taskInput.scope,
        success_criteria: taskInput.success_criteria,
        constraints: taskInput.constraints,
        verification_commands: taskInput.verification_commands,
        timeout_ms: taskInput.timeout_ms,
        metadata: taskInput.metadata ?? {}
      });
    });

    this.store.inTransaction(() => {
      this.store.insertGroup(group);
      for (const envelope of taskInputs) {
        const task: StoredTask = {
          task_id: envelope.task_id,
          session_id: envelope.session_id,
          group_id: envelope.group_id,
          status: "queued",
          mode: envelope.mode,
          goal: envelope.goal,
          adapter: envelope.adapter,
          profile: envelope.profile,
          envelope,
          attempt_count: 0,
          created_at: timestamp,
          updated_at: timestamp
        };
        this.store.insertTask(task);
        this.store.appendEvent({
          type: "task.queued",
          session_id: task.session_id,
          group_id: task.group_id,
          task_id: task.task_id,
          severity: "info",
          message: "Task queued"
        });
      }
    });

    this.queue.push(...taskInputs.map((task) => task.task_id));
    this.schedule();
    return group;
  }

  async queryTasks(filter: { session_id?: string; group_id?: string } = {}): Promise<{ tasks: TaskSummary[] }> {
    return { tasks: this.store.listTasks(filter).map((task) => summarizeTask(task)) };
  }

  async getTaskResult(input: { task_id: string; attempt_id?: string }): Promise<{
    task: TaskSummary;
    attempt: StoredAttempt;
    result?: ResultEnvelope;
  }> {
    const task = this.requireTask(input.task_id);
    const attempt = input.attempt_id ? this.store.getAttempt(input.attempt_id) : this.store.getLatestAttemptForTask(task.task_id);
    if (!attempt) {
      throw new Error(`No attempt found for task ${task.task_id}`);
    }
    return {
      task: summarizeTask(task),
      attempt,
      ...(attempt.result ? { result: attempt.result } : {})
    };
  }

  async getTaskLogs(input: { task_id: string; attempt_id?: string; max_bytes?: number }): Promise<{
    task_id: string;
    attempt_id: string;
    preview: string;
    truncated: boolean;
  }> {
    const attempt = this.requireAttemptForTask(input.task_id, input.attempt_id);
    if (!attempt.log_path) {
      return { task_id: input.task_id, attempt_id: attempt.attempt_id, preview: "", truncated: false };
    }
    const maxBytes = input.max_bytes ?? 8_192;
    const content = await readFile(attempt.log_path, "utf8");
    return {
      task_id: input.task_id,
      attempt_id: attempt.attempt_id,
      preview: content.slice(0, maxBytes),
      truncated: content.length > maxBytes
    };
  }

  async listArtifacts(filter: { session_id?: string; group_id?: string; task_id?: string; attempt_id?: string }): Promise<{
    artifacts: StoredArtifact[];
  }> {
    return { artifacts: this.store.listArtifacts(filter).map(hideArtifactPath) };
  }

  async getArtifact(input: { artifact_id?: string; resource_uri?: string; include_path?: boolean }): Promise<StoredArtifact> {
    const artifacts = input.resource_uri
      ? [this.store.getArtifactByResourceUri(input.resource_uri)].filter((artifact): artifact is StoredArtifact => Boolean(artifact))
      : this.store.listArtifacts({});
    const artifact = input.artifact_id ? artifacts.find((candidate) => candidate.artifact_id === input.artifact_id) : artifacts[0];
    if (!artifact) {
      throw new Error("Artifact not found");
    }
    return input.include_path ? artifact : hideArtifactPath(artifact);
  }

  async getSessionDigest(input: { session_id: string }): Promise<{
    session_id: string;
    summary: { total: number; queued: number; running: number; completed: number; failed: number; cancelled: number };
    groups: Array<{ group_id: string; status: StoredGroup["status"] }>;
  }> {
    this.requireSession(input.session_id);
    const tasks = this.store.listTasks({ session_id: input.session_id });
    const groupsById = new Map(tasks.map((task) => [task.group_id, this.store.getGroup(task.group_id)]));
    return {
      session_id: input.session_id,
      summary: {
        total: tasks.length,
        queued: tasks.filter((task) => task.status === "queued").length,
        running: tasks.filter((task) => task.status === "running").length,
        completed: tasks.filter((task) => task.status === "completed").length,
        failed: tasks.filter((task) => isFailureStatus(task.status)).length,
        cancelled: tasks.filter((task) => task.status === "cancelled").length
      },
      groups: Array.from(groupsById.values())
        .filter((group): group is StoredGroup => Boolean(group))
        .map((group) => ({ group_id: group.group_id, status: group.status }))
    };
  }

  async updateSessionBrief(input: {
    session_id: string;
    expected_brief_revision: number;
    brief: Partial<SessionBrief>;
  }): Promise<Session> {
    const session = this.requireSession(input.session_id);
    const brief = sessionBriefSchema.parse({
      ...session.brief,
      ...input.brief
    });
    const updated = this.store.updateSessionBrief(input.session_id, brief, input.expected_brief_revision);
    this.store.appendEvent({
      type: "session.brief_updated",
      session_id: input.session_id,
      severity: "info",
      message: "Session brief updated"
    });
    return updated;
  }

  async mergeTasks(input: { session_id: string; attempt_ids: string[] }): Promise<{
    status: "completed" | "conflicted";
    session_id: string;
    attempt_ids: string[];
    integration_worktree_path: string;
    changed_files: string[];
    conflicts: string[];
  }> {
    const session = this.requireSession(input.session_id);
    const project = path.basename(session.repo).replace(/[^A-Za-z0-9._-]/g, "-") || "repo";
    const integrationPath = path.join(this.options.paths.worktreeRoot, `${project}-integration-${Date.now()}`);
    await mkdir(this.options.paths.worktreeRoot, { recursive: true });
    await execRequired("git", ["worktree", "add", "--detach", integrationPath, session.base_ref], session.repo);
    await excludeHarness(integrationPath);

    const conflicts: string[] = [];
    for (const attemptId of input.attempt_ids) {
      const attempt = this.store.getAttempt(attemptId);
      if (!attempt?.worktree_path) {
        conflicts.push(`Attempt ${attemptId} has no worktree evidence`);
        continue;
      }
      const patch = await createPatch(attempt.worktree_path);
      if (patch.trim().length === 0) continue;
      const patchPath = path.join(this.options.paths.artifactsDir, input.session_id, "merge", `${attemptId}.patch`);
      await mkdir(path.dirname(patchPath), { recursive: true });
      await writeFile(patchPath, patch);
      const applied = await execFileResult("git", ["apply", "--3way", patchPath], integrationPath);
      if (applied.code !== 0) {
        conflicts.push(applied.stderr || applied.stdout || `Attempt ${attemptId} did not apply cleanly`);
        break;
      }
    }

    const changed = await execGit(["status", "--porcelain"], integrationPath);
    const changedFiles = parsePorcelainChangedFiles(changed.stdout);
    return {
      status: conflicts.length > 0 ? "conflicted" : "completed",
      session_id: input.session_id,
      attempt_ids: input.attempt_ids,
      integration_worktree_path: integrationPath,
      changed_files: changedFiles,
      conflicts
    };
  }

  async cancelTasks(input: { task_ids?: string[]; group_id?: string; session_id?: string }): Promise<{ cancelled_task_ids: string[] }> {
    const taskIds =
      input.task_ids ??
      this.store
        .listTasks(definedEntries({ group_id: input.group_id, session_id: input.session_id }))
        .filter((task) => !terminalStatuses.has(task.status))
        .map((task) => task.task_id);
    const cancelled: string[] = [];
    for (const taskId of taskIds) {
      const task = this.store.getTask(taskId);
      if (!task || terminalStatuses.has(task.status)) continue;
      const running = this.running.get(taskId);
      if (running) {
        running.cancelled = true;
        running.child.kill("SIGTERM");
        const attempt = this.store.getAttempt(running.attempt_id);
        const timestamp = nowIso();
        if (attempt) {
          this.store.updateAttempt({
            ...attempt,
            status: "cancelled",
            error: "Task cancelled",
            updated_at: timestamp,
            finished_at: timestamp
          });
        }
        this.store.updateTaskStatus(taskId, "cancelled");
        this.updateGroupDerivedStatus(task.group_id);
      } else {
        const timestamp = nowIso();
        const attempt = this.store.getLatestAttemptForTask(taskId);
        if (attempt && task.status === "running") {
          this.store.updateAttempt({
            ...attempt,
            status: "cancelled",
            error: "Task cancelled",
            updated_at: timestamp,
            finished_at: timestamp
          });
        }
        this.removeQueuedTask(taskId);
        this.store.updateTaskStatus(taskId, "cancelled");
        this.updateGroupDerivedStatus(task.group_id);
      }
      cancelled.push(taskId);
    }
    return { cancelled_task_ids: cancelled };
  }

  async waitForTaskGroup(groupId: string, timeoutMs: number): Promise<StoredGroup> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const group = this.store.getGroup(groupId);
      if (!group) {
        throw new Error(`Task group not found: ${groupId}`);
      }
      if (["completed", "failed", "cancelled", "mixed"].includes(group.status)) {
        return group;
      }
      await sleep(25);
    }
    throw new Error(`Timed out waiting for task group ${groupId}`);
  }

  listAdapters(): { adapters: Array<{ name: string; profiles: string[]; supports_model_selection: boolean }> } {
    return {
      adapters: [
        { name: "fake", profiles: ["default"], supports_model_selection: false },
        { name: "codex", profiles: [], supports_model_selection: true }
      ]
    };
  }

  async getEffectiveConfig(): Promise<EffectiveConfig> {
    return {
      schema_version: schemaVersion,
      storage: {
        state_dir: this.options.paths.stateDir,
        db_path: this.options.paths.dbPath,
        logs_dir: this.options.paths.logsDir,
        artifacts_dir: this.options.paths.artifactsDir,
        worktree_root: this.options.paths.worktreeRoot,
        runtime_dir: this.options.paths.runtimeDir
      },
      profiles: {
        fake: {
          default: {
            concurrency: this.maxConcurrency,
            timeout_ms: 30_000
          }
        }
      },
      adapters: {
        fake: {
          available: true,
          supports_native_skills: false,
          supports_skill_paths: false
        },
        codex: {
          available: false,
          reason: "Codex adapter command/profile is not configured in this slice",
          supports_native_skills: true,
          supports_skill_paths: true
        }
      },
      security: {
        preset: "default",
        stores_provider_secrets: false,
        path_redaction: false
      },
      skill_paths: [],
      redactions: []
    };
  }

  async doctor(): Promise<{
    status: "healthy" | "degraded";
    checks: Array<{ name: string; status: "pass" | "warn" | "fail"; message: string }>;
  }> {
    const checks: Array<{ name: string; status: "pass" | "warn" | "fail"; message: string }> = [];
    const git = await execFileResult("git", ["--version"], process.cwd());
    checks.push({
      name: "git",
      status: git.code === 0 ? "pass" : "fail",
      message: git.code === 0 ? git.stdout.trim() : git.stderr.trim()
    });

    const storageOk = await Promise.all([
      pathExists(this.options.paths.stateDir),
      pathExists(this.options.paths.logsDir),
      pathExists(this.options.paths.artifactsDir),
      pathExists(this.options.paths.worktreeRoot)
    ]);
    checks.push({
      name: "storage",
      status: storageOk.every(Boolean) ? "pass" : "fail",
      message: "Required storage directories are present"
    });
    checks.push({ name: "fake_adapter", status: "pass", message: "Fake adapter is built in" });
    checks.push({ name: "codex_adapter", status: "warn", message: "Codex adapter is not configured in this slice" });

    return {
      status: checks.some((check) => check.status === "fail") ? "degraded" : "healthy",
      checks
    };
  }

  private schedule(): void {
    if (this.closed) return;
    while (this.active.size < this.maxConcurrency && this.queue.length > 0) {
      const taskId = this.queue.shift();
      if (!taskId) continue;
      const task = this.store.getTask(taskId);
      if (!task || task.status !== "queued") continue;
      this.active.add(taskId);
      const run = this.runTask(task)
        .catch((error: unknown) => {
          const latest = this.store.getLatestAttemptForTask(task.task_id);
          const message = error instanceof Error ? error.message : String(error);
          if (latest) {
            const failed = { ...latest, status: "failed" as const, error: message, updated_at: nowIso(), finished_at: nowIso() };
            this.store.updateAttempt(failed);
          }
          this.store.updateTaskStatus(task.task_id, "failed");
          this.updateGroupDerivedStatus(task.group_id);
        })
        .finally(() => {
          this.active.delete(taskId);
          this.taskRuns.delete(run);
          this.schedule();
        });
      this.taskRuns.add(run);
    }
  }

  private async runTask(task: StoredTask): Promise<void> {
    const session = this.requireSession(task.session_id);
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
    const logPath = path.join(this.options.paths.logsDir, session.session_id, task.task_id, `${attemptId}.log`);
    const resultPath = path.join(harnessDir, "result.json");
    await Promise.all([mkdir(harnessDir, { recursive: true }), mkdir(path.dirname(logPath), { recursive: true })]);
    await this.writeHarnessFiles({ session, task, attemptId, harnessDir });

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
      this.updateGroupDerivedStatus(task.group_id);
      this.schedule();
      return;
    }

    const runResult = await this.runFakeAdapter({ task, attemptId, worktreePath, logPath });
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
      severity: isFailureStatus(status) ? "warning" : "info",
      message: `Task finished with status ${status}`
    });
    this.updateGroupDerivedStatus(task.group_id);
    this.schedule();
  }

  private async createWorktree(session: Session, task: StoredTask): Promise<string> {
    await mkdir(this.options.paths.worktreeRoot, { recursive: true });
    const project = path.basename(session.repo).replace(/[^A-Za-z0-9._-]/g, "-") || "repo";
    const worktreePath = path.join(this.options.paths.worktreeRoot, `${project}-${task.task_id}`);
    await execRequired("git", ["worktree", "add", "--detach", worktreePath, task.envelope.base_ref ?? session.base_ref], session.repo);
    await excludeHarness(worktreePath);
    return worktreePath;
  }

  private async writeHarnessFiles(input: { session: Session; task: StoredTask; attemptId: string; harnessDir: string }): Promise<void> {
    await writeFile(path.join(input.harnessDir, "task.json"), `${JSON.stringify(input.task.envelope, null, 2)}\n`);
    await writeFile(path.join(input.harnessDir, "brief.md"), renderBrief(input.session.brief));
    await writeFile(path.join(input.harnessDir, "instructions.md"), renderInstructions(input.task.envelope, input.attemptId));
    await writeFile(
      path.join(input.harnessDir, "result.schema.json"),
      `${JSON.stringify(publicSchemas.result_envelope, null, 2)}\n`
    );
    await mkdir(path.join(input.harnessDir, "artifacts"), { recursive: true });
    await writeFile(path.join(input.harnessDir, "fake-adapter.mjs"), fakeAdapterScript);
  }

  private async runFakeAdapter(input: {
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
      const patchPath = path.join(this.options.paths.artifactsDir, input.session.session_id, input.task.task_id, `${input.attempt.attempt_id}.patch`);
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

  private updateGroupDerivedStatus(groupId: string): void {
    const tasks = this.store.listTasks({ group_id: groupId });
    if (tasks.length === 0) return;
    if (tasks.some((task) => task.status === "running")) {
      this.store.updateGroupStatus(groupId, "running");
      return;
    }
    if (tasks.some((task) => task.status === "queued")) {
      this.store.updateGroupStatus(groupId, "queued");
      return;
    }
    if (tasks.every((task) => task.status === "completed")) {
      this.store.updateGroupStatus(groupId, "completed");
      return;
    }
    if (tasks.every((task) => task.status === "cancelled")) {
      this.store.updateGroupStatus(groupId, "cancelled");
      return;
    }
    if (tasks.some((task) => isFailureStatus(task.status))) {
      this.store.updateGroupStatus(groupId, "failed");
      return;
    }
    this.store.updateGroupStatus(groupId, "mixed");
  }

  private removeQueuedTask(taskId: string): void {
    const index = this.queue.indexOf(taskId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private requireSession(sessionId: string): Session {
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

  private requireTask(taskId: string): StoredTask {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  private requireAttemptForTask(taskId: string, attemptId?: string): StoredAttempt {
    const attempt = attemptId ? this.store.getAttempt(attemptId) : this.store.getLatestAttemptForTask(taskId);
    if (!attempt) throw new Error(`Attempt not found for task ${taskId}`);
    return attempt;
  }
}

const summarizeTask = (task: StoredTask): TaskSummary => ({
  task_id: task.task_id,
  group_id: task.group_id,
  session_id: task.session_id,
  status: task.status,
  mode: task.mode,
  goal: task.goal,
  adapter: task.adapter,
  profile: task.profile,
  attempt_count: task.attempt_count,
  ...(task.latest_attempt_id ? { latest_attempt_id: task.latest_attempt_id } : {})
});

const hideArtifactPath = (artifact: StoredArtifact): StoredArtifact => {
  const { path: _path, ...publicArtifact } = artifact;
  return publicArtifact;
};

const isFailureStatus = (status: TaskRuntimeStatus): boolean =>
  ["failed", "timed_out", "interrupted", "failed_contract", "completed_with_failed_verification"].includes(status);

const renderBrief = (brief: SessionBrief): string => `# Session Brief

Goal: ${brief.goal}

Constraints:
${brief.constraints.map((item) => `- ${item}`).join("\n")}

Decisions:
${brief.decisions.map((item) => `- ${item}`).join("\n")}

Accepted Findings:
${brief.accepted_findings.map((item) => `- ${item}`).join("\n")}

Rejected Paths:
${brief.rejected_paths.map((item) => `- ${item}`).join("\n")}

Open Questions:
${brief.open_questions.map((item) => `- ${item}`).join("\n")}
`;

const renderInstructions = (task: TaskEnvelope, attemptId: string): string => `You are a subagent running under any-subagents.

Follow the task contract exactly. Write .any-subagents/result.tmp.json first, then atomically rename it to .any-subagents/result.json.

Identity:
- Session: ${task.session_id}
- Task Group: ${task.group_id}
- Task: ${task.task_id}
- Attempt: ${attemptId}
- Mode: ${task.mode}
- Adapter/Profile: ${task.adapter}/${task.profile}
`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const previewFile = async (filePath: string): Promise<string> => {
  const content = await readFile(filePath, "utf8");
  return content.slice(0, 4_096);
};

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};
