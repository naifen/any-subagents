import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimePaths } from "../storage/paths.js";
import {
  schemaVersion,
  sessionBriefSchema,
  taskEnvelopeSchema,
  type ResultEnvelope,
  type Session,
  type SessionBrief,
  type TaskEnvelope,
  type EffectiveConfig
} from "../schemas/index.js";
import { newSessionId, newTaskGroupId, newTaskId } from "./id.js";
import { nowIso } from "./time.js";
import { Store, type StoredArtifact, type StoredAttempt, type StoredGroup, type StoredTask } from "../db/store.js";
import { definedEntries } from "./defined.js";
import { assertGitRepo, assertGitRef, createPatch, excludeHarness, parsePorcelainChangedFiles } from "./git.js";
import { execFileResult, execRequired } from "./exec.js";
import { NotFoundError } from "./errors.js";
import { Scheduler } from "./scheduler.js";
import { TaskRunner } from "./task-runner.js";
import { failureStatuses, terminalStatuses, type TaskRuntimeStatus } from "./status.js";

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

export const createControlPlane = (options: ControlPlaneOptions): ControlPlane => new ControlPlane(options);

export class ControlPlane {
  private readonly store: Store;
  private readonly scheduler: Scheduler;

  constructor(private readonly options: ControlPlaneOptions) {
    this.store = new Store(options.paths.dbPath);
    const running = new Map<string, import("./task-runner.js").RunningAttempt>();
    const runner = new TaskRunner(this.store, options.paths, running);
    this.scheduler = new Scheduler({
      store: this.store,
      runner,
      maxConcurrency: options.maxConcurrency ?? 4,
      getSession: (id) => this.requireSession(id),
      running
    });
  }

  async close(): Promise<void> {
    await this.scheduler.close();
    this.store.close();
  }

  // ─── Session CRUD ───────────────────────────────────────────────

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
        failed: tasks.filter((task) => failureStatuses.has(task.status)).length,
        cancelled: tasks.filter((task) => task.status === "cancelled").length
      },
      groups: Array.from(groupsById.values())
        .filter((group): group is StoredGroup => Boolean(group))
        .map((group) => ({ group_id: group.group_id, status: group.status }))
    };
  }

  // ─── Task Group Submission ──────────────────────────────────────

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

    this.scheduler.enqueue(taskInputs.map((task) => task.task_id));
    return group;
  }

  // ─── Task Queries ───────────────────────────────────────────────

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
      throw new NotFoundError("Attempt", `for task ${task.task_id}`);
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

  // ─── Artifacts ──────────────────────────────────────────────────

  async listArtifacts(filter: { session_id?: string; group_id?: string; task_id?: string; attempt_id?: string }): Promise<{
    artifacts: StoredArtifact[];
  }> {
    return { artifacts: this.store.listArtifacts(filter).map(hideArtifactPath) };
  }

  async getArtifact(input: { artifact_id?: string; resource_uri?: string; include_path?: boolean }): Promise<StoredArtifact> {
    if (!input.artifact_id && !input.resource_uri) {
      throw new Error("Either artifact_id or resource_uri must be provided");
    }
    const artifacts = input.resource_uri
      ? [this.store.getArtifactByResourceUri(input.resource_uri)].filter((artifact): artifact is StoredArtifact => Boolean(artifact))
      : this.store.listArtifacts({});
    const artifact = input.artifact_id ? artifacts.find((candidate) => candidate.artifact_id === input.artifact_id) : artifacts[0];
    if (!artifact) {
      throw new NotFoundError("Artifact", input.artifact_id ?? input.resource_uri ?? "unknown");
    }
    return input.include_path ? artifact : hideArtifactPath(artifact);
  }

  // ─── Cancellation ──────────────────────────────────────────────

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
      const running = this.scheduler.running.get(taskId);
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
        this.scheduler.updateGroupStatus(task.group_id);
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
        this.scheduler.removeQueued(taskId);
        this.store.updateTaskStatus(taskId, "cancelled");
        this.scheduler.updateGroupStatus(task.group_id);
      }
      cancelled.push(taskId);
    }
    return { cancelled_task_ids: cancelled };
  }

  // ─── Merge ─────────────────────────────────────────────────────

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

    const changed = await execFileResult("git", ["status", "--porcelain"], integrationPath);
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

  // ─── Wait ──────────────────────────────────────────────────────

  async waitForTaskGroup(groupId: string, timeoutMs: number): Promise<StoredGroup> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const group = this.store.getGroup(groupId);
      if (!group) {
        throw new NotFoundError("Task group", groupId);
      }
      if (["completed", "failed", "cancelled", "mixed"].includes(group.status)) {
        return group;
      }
      await sleep(25);
    }
    throw new Error(`Timed out waiting for task group ${groupId}`);
  }

  // ─── Configuration & Diagnostics ──────────────────────────────

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
            concurrency: this.options.maxConcurrency ?? 4,
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

  // ─── Internal Helpers ──────────────────────────────────────────

  private requireSession(sessionId: string): Session {
    const session = this.store.getSession(sessionId);
    if (!session) throw new NotFoundError("Session", sessionId);
    return session;
  }

  private requireTask(taskId: string): StoredTask {
    const task = this.store.getTask(taskId);
    if (!task) throw new NotFoundError("Task", taskId);
    return task;
  }

  private requireAttemptForTask(taskId: string, attemptId?: string): StoredAttempt {
    const attempt = attemptId ? this.store.getAttempt(attemptId) : this.store.getLatestAttemptForTask(taskId);
    if (!attempt) throw new NotFoundError("Attempt", `for task ${taskId}`);
    return attempt;
  }
}

// ─── Module-Level Helpers ──────────────────────────────────────

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};
