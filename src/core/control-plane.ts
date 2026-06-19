import { stat } from "node:fs/promises";
import path from "node:path";
import type { RuntimePaths } from "../storage/paths.js";
import {
  schemaVersion,
  sessionBriefSchema,
  type ResultEnvelope,
  type Session,
  type SessionBrief,
  type TaskEnvelope,
  type EffectiveConfig,
  type CreateSessionInput
} from "../schemas/index.js";
import { adapterDefinitions, getAdapter, knownAdapters } from "../adapters/registry.js";
import { buildEffectiveConfig } from "../config/effective-config.js";
import { newSessionId } from "../util/id.js";
import { nowIso } from "../util/time.js";
import {
  Store,
  type StoredArtifact,
  type StoredAttempt,
  type StoredEvent,
  type StoredGroup,
  type StoredMetric,
  type StoredTask
} from "../db/store.js";
import { definedEntries } from "../util/defined.js";
import { assertCleanRepo, assertGitRepo, assertGitRef } from "./git.js";
import { execFileResult } from "./exec.js";
import { NotFoundError } from "./errors.js";
import { Scheduler } from "./scheduler.js";
import { TaskRunner } from "./task-runner.js";
import type { AdapterHealthSnapshot } from "../adapters/types.js";
import type { KnownAdapter } from "../adapters/registry.js";
import { terminalStatuses, type TaskRuntimeStatus } from "../domain/status.js";
import { defaultConfig, type AppConfig } from "../config/schema.js";
import { normalizeConfig } from "../config/normalize.js";
import { forAudience, type ResultAudience } from "./audience.js";
import { buildSessionDigest } from "./session-digest.js";
import { exportSessionBundle } from "./session-export.js";
import { createMetricsRecorder } from "./metrics-recorder.js";
import { readLogPreview } from "./log-preview.js";
import {
  buildTaskGroupSubmission,
  persistTaskGroupSubmission,
  type SubmitTaskGroupInput
} from "./submit-task-group.js";
import { recoverInterruptedAttempts } from "./recover-interrupted.js";
import { mergeAttempts } from "./merge-attempts.js";
import type { RunningAttempt } from "./task-runner.js";

export type { SubmitTaskGroupInput, CreateSessionInput };

export interface ControlPlaneOptions {
  paths: RuntimePaths;
  config?: AppConfig;
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

const adapterHealthTtlMs = 30_000;

export class ControlPlane {
  private readonly store: Store;
  private readonly scheduler: Scheduler;
  private readonly config: AppConfig;
  private adapterHealthCache?: { probedAt: number; health: Promise<Record<KnownAdapter, AdapterHealthSnapshot>> };

  constructor(private readonly options: ControlPlaneOptions) {
    const baseConfig = options.config ?? defaultConfig();
    this.config = normalizeConfig(baseConfig);
    this.store = new Store(options.paths.dbPath);
    const running = new Map<string, RunningAttempt>();
    const metrics = createMetricsRecorder(this.store);
    const runner = new TaskRunner(this.store, options.paths, running, this.config, metrics);
    this.scheduler = new Scheduler({
      store: this.store,
      runner,
      config: this.config,
      getSession: (id) => this.requireSession(id),
      running,
      metrics
    });

    const recovery = recoverInterruptedAttempts(this.store);
    if (recovery.queuedTaskIds.length > 0) {
      this.scheduler.enqueue(recovery.queuedTaskIds);
    }
  }

  async close(): Promise<void> {
    await this.scheduler.close();
    this.store.close();
  }

  // ─── Session CRUD ───────────────────────────────────────────────

  async createSession(input: CreateSessionInput): Promise<Session> {
    await assertGitRepo(input.repo);
    await assertGitRef(input.repo, input.base_ref);
    await assertCleanRepo(input.repo);

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
      metadata: input.metadata ?? {},
      ...(input.priority !== undefined ? { priority: input.priority } : {})
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

  async getSessionDigest(input: { session_id: string }): Promise<ReturnType<typeof buildSessionDigest>> {
    this.requireSession(input.session_id);
    return buildSessionDigest(this.store, input.session_id);
  }

  // ─── Task Group Submission ──────────────────────────────────────

  async submitTaskGroup(input: SubmitTaskGroupInput): Promise<StoredGroup> {
    const session = this.requireSession(input.session_id);
    await assertCleanRepo(session.repo);

    const revisionConflict = session.brief_revision !== input.expected_brief_revision;
    if (revisionConflict && input.ignore_revision_conflict !== true) {
      throw new Error(`Brief revision conflict: expected ${input.expected_brief_revision}, got ${session.brief_revision}`);
    }

    const submission = buildTaskGroupSubmission(this.config, session, input);
    persistTaskGroupSubmission(this.store, submission);
    this.scheduler.enqueue(submission.taskInputs.map((task) => task.task_id));
    return submission.group;
  }

  // ─── Task Queries ───────────────────────────────────────────────

  async queryTasks(filter: { session_id?: string; group_id?: string } = {}): Promise<{ tasks: TaskSummary[] }> {
    return { tasks: this.store.listTasks(filter).map((task) => summarizeTask(task)) };
  }

  async getTaskResult(
    input: { task_id: string; attempt_id?: string },
    options: { audience?: ResultAudience } = {}
  ): Promise<{
    task: TaskSummary;
    attempt: StoredAttempt;
    result?: ResultEnvelope;
  }> {
    const audience = options.audience ?? "internal";
    const task = this.requireTask(input.task_id);
    const attempt = input.attempt_id ? this.store.getAttempt(input.attempt_id) : this.store.getLatestAttemptForTask(task.task_id);
    if (!attempt) {
      throw new NotFoundError("Attempt", `for task ${task.task_id}`);
    }
    return {
      task: summarizeTask(task),
      attempt: forAudience.attempt(attempt, audience),
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
    const { preview, truncated } = await readLogPreview(attempt.log_path, this.config, maxBytes, this.options.paths);
    return {
      task_id: input.task_id,
      attempt_id: attempt.attempt_id,
      preview,
      truncated
    };
  }

  // ─── Artifacts ──────────────────────────────────────────────────

  async listArtifacts(
    filter: { session_id?: string; group_id?: string; task_id?: string; attempt_id?: string },
    options: { audience?: ResultAudience } = {}
  ): Promise<{
    artifacts: StoredArtifact[];
  }> {
    const audience = options.audience ?? "public";
    return { artifacts: this.store.listArtifacts(filter).map((artifact) => forAudience.artifact(artifact, audience)) };
  }

  async getArtifact(
    input: { artifact_id?: string; resource_uri?: string },
    options: { audience?: ResultAudience } = {}
  ): Promise<StoredArtifact> {
    if (!input.artifact_id && !input.resource_uri) {
      throw new Error("Either artifact_id or resource_uri must be provided");
    }
    const artifact = input.artifact_id
      ? this.store.getArtifactById(input.artifact_id)
      : this.store.getArtifactByResourceUri(input.resource_uri!);
    if (!artifact) {
      throw new NotFoundError("Artifact", input.artifact_id ?? input.resource_uri ?? "unknown");
    }
    return forAudience.artifact(artifact, options.audience ?? "public");
  }

  // ─── Cancellation ──────────────────────────────────────────────

  async cancelTasks(input: { task_ids?: string[]; group_id?: string; session_id?: string }): Promise<{ cancelled_task_ids: string[] }> {
    const taskIds =
      input.task_ids ??
      this.store
        .listTasks(definedEntries({ group_id: input.group_id, session_id: input.session_id }))
        .filter((task) => !terminalStatuses.has(task.status))
        .map((task) => task.task_id);
    return { cancelled_task_ids: this.scheduler.cancelTasks(taskIds) };
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
    return mergeAttempts({ session, attempt_ids: input.attempt_ids }, { store: this.store, paths: this.options.paths });
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

  // ─── Metrics ───────────────────────────────────────────────────

  async getMetrics(filter: { name?: string; session_id?: string; task_id?: string; limit?: number } = {}): Promise<{ metrics: StoredMetric[] }> {
    return { metrics: this.store.queryMetrics(filter) };
  }

  listEvents(filter: { session_id?: string; group_id?: string; task_id?: string; type?: string } = {}): { events: StoredEvent[] } {
    return { events: this.store.listEvents(filter) };
  }

  // ─── Export ────────────────────────────────────────────────────

  async exportSession(input: { session_id: string; output_dir: string }): Promise<{ output_dir: string; files: string[]; skipped_logs: string[] }> {
    const session = this.requireSession(input.session_id);
    return exportSessionBundle(session, input.output_dir, {
      store: this.store,
      config: this.config,
      paths: this.options.paths
    });
  }

  // ─── Configuration & Diagnostics ──────────────────────────────

  listAdapters(): {
    adapters: Array<{
      name: string;
      profiles: string[];
      supports_model_selection: boolean;
      supports_native_skills: boolean;
      supports_skill_paths: boolean;
      supports_reasoning_levels: boolean;
    }>;
  } {
    return {
      adapters: [...adapterDefinitions().values()].map((adapter) => ({
        name: adapter.name,
        profiles: Object.keys(this.config.profiles?.[adapter.name] ?? adapter.defaultProfiles),
        ...adapter.capabilities
      }))
    };
  }

  async getEffectiveConfig(): Promise<EffectiveConfig> {
    const adapterHealth = await this.probeAdapterHealth();
    return buildEffectiveConfig(this.config, this.options.paths, adapterHealth);
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
    const adapterHealth = await this.probeAdapterHealth();
    for (const name of knownAdapters) {
      const health = adapterHealth[name];
      const doctorCheck = getAdapter(name).doctorCheck(health);
      checks.push({
        name: `${name}_adapter`,
        status: doctorCheck.status,
        message: doctorCheck.message
      });
    }

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

  private probeAdapterHealth(): Promise<Record<KnownAdapter, AdapterHealthSnapshot>> {
    const now = Date.now();
    if (!this.adapterHealthCache || now - this.adapterHealthCache.probedAt > adapterHealthTtlMs) {
      this.adapterHealthCache = {
        probedAt: now,
        health: Promise.all(
          knownAdapters.map(async (name) => [name, await getAdapter(name).health()] as const)
        ).then((entries) => Object.fromEntries(entries) as Record<KnownAdapter, AdapterHealthSnapshot>)
      };
    }
    return this.adapterHealthCache.health;
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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pathExists = async (target: string): Promise<boolean> => {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
};
