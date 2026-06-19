import { mkdir } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import type { Artifact, Session, SessionBrief, TaskEnvelope } from "../schemas/index.js";
import { nowIso } from "../util/time.js";
import type { GroupStatus, TaskRuntimeStatus } from "../core/status.js";
import { deriveGroupStatus } from "../core/status.js";
import { runMigrations } from "./migrations.js";
import * as eventStore from "./events.js";
import * as metricStore from "./metrics.js";
import * as attemptStore from "./attempts.js";
import { buildWhereClause, jsonColumn } from "./query-helpers.js";
import type {
  EventInput,
  FinishTaskOutcomeInput,
  RecoverInterruptedResult,
  RecordMetricInput,
  StoredAttempt,
  StoredEvent,
  StoredMetric
} from "./store-types.js";

export type {
  EventInput,
  RecordMetricInput,
  RecoverInterruptedResult,
  StoredAttempt,
  StoredEvent,
  StoredMetric
} from "./store-types.js";

export interface StoredTask {
  task_id: string;
  session_id: string;
  group_id: string;
  status: TaskRuntimeStatus;
  mode: string;
  goal: string;
  adapter: string;
  profile: string;
  envelope: TaskEnvelope;
  attempt_count: number;
  latest_attempt_id?: string;
  created_at: string;
  updated_at: string;
}

export interface StoredGroup {
  group_id: string;
  session_id: string;
  title: string;
  status: GroupStatus;
  expected_brief_revision: number;
  created_at: string;
  updated_at: string;
}

export interface StoredArtifact extends Artifact {
  path?: string;
}
// ─── Typed row interfaces matching SQLite column types ─────────────────
// These mirror the CREATE TABLE schemas so that column-name typos in
// mapper functions are caught at compile time.

interface SessionRow {
  session_id: string;
  repo: string;
  base_ref: string;
  status: string;
  brief_json: string;
  brief_revision: number;
  created_at: string;
  updated_at: string;
  metadata_json: string;
  priority: number | null;
}

interface GroupRow {
  group_id: string;
  session_id: string;
  title: string;
  status: string;
  expected_brief_revision: number;
  created_at: string;
  updated_at: string;
}

interface TaskRow {
  task_id: string;
  session_id: string;
  group_id: string;
  status: string;
  mode: string;
  goal: string;
  adapter: string;
  profile: string;
  envelope_json: string;
  latest_attempt_id: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

interface ArtifactRow {
  artifact_id: string;
  session_id: string | null;
  group_id: string | null;
  task_id: string | null;
  attempt_id: string | null;
  type: string;
  mime_type: string;
  summary: string;
  created_at: string;
  resource_uri: string;
  size_bytes: number | null;
  hash: string | null;
  preview: string | null;
  path: string | null;
  metadata_json: string;
}

export class Store {
  private readonly db: Database.Database;

  constructor(readonly dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  inTransaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  async ensureDirectories(): Promise<void> {
    await mkdir(path.dirname(this.dbPath), { recursive: true });
  }

  insertSession(session: Session): void {
    this.db
      .prepare(
        `insert into sessions
          (session_id, repo, base_ref, status, brief_json, brief_revision, created_at, updated_at, metadata_json, priority)
         values
          (@session_id, @repo, @base_ref, @status, @brief_json, @brief_revision, @created_at, @updated_at, @metadata_json, @priority)`
      )
      .run({
        ...session,
        brief_json: JSON.stringify(session.brief),
        metadata_json: JSON.stringify(session.metadata ?? {}),
        priority: session.priority ?? null
      });
  }

  getSession(sessionId: string): Session | undefined {
    const row = this.db.prepare("select * from sessions where session_id = ?").get(sessionId) as SessionRow | undefined;
    if (!row) return undefined;
    return {
      schema_version: "1",
      session_id: row.session_id,
      repo: row.repo,
      base_ref: row.base_ref,
      status: row.status as Session["status"],
      brief: JSON.parse(row.brief_json) as SessionBrief,
      brief_revision: row.brief_revision,
      created_at: row.created_at,
      updated_at: row.updated_at,
      metadata: jsonColumn<Record<string, unknown>>(row.metadata_json, {}),
      ...(row.priority != null ? { priority: row.priority } : {})
    };
  }

  updateSessionBrief(sessionId: string, brief: SessionBrief, expectedRevision: number): Session {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.brief_revision !== expectedRevision) {
      throw new Error(`Brief revision conflict: expected ${expectedRevision}, got ${session.brief_revision}`);
    }
    const updatedAt = nowIso();
    this.db
      .prepare("update sessions set brief_json = ?, brief_revision = ?, updated_at = ? where session_id = ?")
      .run(JSON.stringify(brief), expectedRevision + 1, updatedAt, sessionId);
    return {
      ...session,
      brief,
      brief_revision: expectedRevision + 1,
      updated_at: updatedAt
    };
  }

  insertGroup(group: StoredGroup): void {
    this.db
      .prepare(
        `insert into task_groups
          (group_id, session_id, title, status, expected_brief_revision, created_at, updated_at)
         values
          (@group_id, @session_id, @title, @status, @expected_brief_revision, @created_at, @updated_at)`
      )
      .run(group);
  }

  getGroup(groupId: string): StoredGroup | undefined {
    const row = this.db.prepare("select * from task_groups where group_id = ?").get(groupId) as GroupRow | undefined;
    return row ? this.mapGroup(row) : undefined;
  }

  updateGroupStatus(groupId: string, status: StoredGroup["status"]): void {
    this.db
      .prepare("update task_groups set status = ?, updated_at = ? where group_id = ?")
      .run(status, nowIso(), groupId);
  }

  insertTask(task: StoredTask): void {
    this.db
      .prepare(
        `insert into tasks
          (task_id, session_id, group_id, status, mode, goal, adapter, profile, envelope_json, attempt_count, created_at, updated_at)
         values
          (@task_id, @session_id, @group_id, @status, @mode, @goal, @adapter, @profile, @envelope_json, @attempt_count, @created_at, @updated_at)`
      )
      .run({
        ...task,
        envelope_json: JSON.stringify(task.envelope)
      });
  }

  getTask(taskId: string): StoredTask | undefined {
    const row = this.db.prepare("select * from tasks where task_id = ?").get(taskId) as TaskRow | undefined;
    return row ? this.mapTask(row) : undefined;
  }

  listTasks(filter: { session_id?: string; group_id?: string } = {}): StoredTask[] {
    if (filter.group_id) {
      return (
        this.db.prepare("select * from tasks where group_id = ? order by created_at, task_id").all(filter.group_id) as TaskRow[]
      ).map((row) => this.mapTask(row));
    }
    if (filter.session_id) {
      return (
        this.db.prepare("select * from tasks where session_id = ? order by created_at, task_id").all(filter.session_id) as TaskRow[]
      ).map((row) => this.mapTask(row));
    }
    return (this.db.prepare("select * from tasks order by created_at, task_id").all() as TaskRow[]).map((row) => this.mapTask(row));
  }

  updateTaskStatus(taskId: string, status: TaskRuntimeStatus, latestAttemptId?: string): void {
    this.db
      .prepare(
        `update tasks
         set status = @status,
             latest_attempt_id = coalesce(@latest_attempt_id, latest_attempt_id),
             attempt_count = case
               when @latest_attempt_id is not null and @latest_attempt_id != coalesce(latest_attempt_id, '')
               then attempt_count + 1
               else attempt_count
             end,
             updated_at = @updated_at
         where task_id = @task_id`
      )
      .run({
        task_id: taskId,
        status,
        latest_attempt_id: latestAttemptId ?? null,
        updated_at: nowIso()
      });
  }

  insertAttempt(attempt: StoredAttempt): void {
    attemptStore.insertAttempt(this.db, attempt);
  }

  startAttempt(attempt: StoredAttempt, groupId: string): void {
    this.inTransaction(() => {
      this.insertAttempt(attempt);
      this.updateTaskStatus(attempt.task_id, "running", attempt.attempt_id);
      this.refreshGroupStatus(groupId);
    });
  }

  finishTaskOutcome(input: FinishTaskOutcomeInput): void {
    this.inTransaction(() => {
      if ("attempt" in input) {
        this.updateAttempt(input.attempt);
        this.updateTaskStatus(input.taskId, input.attempt.status, input.attempt.attempt_id);
      } else {
        this.updateTaskStatus(input.taskId, input.status);
      }
      this.refreshGroupStatus(input.groupId);
    });
  }

  private refreshGroupStatus(groupId: string): void {
    const tasks = this.listTasks({ group_id: groupId });
    const groupStatus = deriveGroupStatus(tasks.map((task) => task.status as TaskRuntimeStatus));
    this.updateGroupStatus(groupId, groupStatus);
  }

  getAttempt(attemptId: string): StoredAttempt | undefined {
    return attemptStore.getAttempt(this.db, attemptId);
  }

  getLatestAttemptForTask(taskId: string): StoredAttempt | undefined {
    return attemptStore.getLatestAttemptForTask(this.db, taskId);
  }

  updateAttempt(attempt: StoredAttempt): void {
    attemptStore.updateAttempt(this.db, attempt);
  }

  insertArtifact(artifact: StoredArtifact): void {
    this.db
      .prepare(
        `insert into artifacts
          (artifact_id, session_id, group_id, task_id, attempt_id, type, mime_type, summary, created_at, resource_uri, size_bytes, hash, preview, path, metadata_json)
         values
          (@artifact_id, @session_id, @group_id, @task_id, @attempt_id, @type, @mime_type, @summary, @created_at, @resource_uri, @size_bytes, @hash, @preview, @path, @metadata_json)`
      )
      .run({
        artifact_id: artifact.artifact_id,
        session_id: artifact.scope.session_id,
        group_id: artifact.scope.group_id,
        task_id: artifact.scope.task_id,
        attempt_id: artifact.scope.attempt_id,
        type: artifact.type,
        mime_type: artifact.mime_type,
        summary: artifact.summary,
        created_at: artifact.created_at,
        resource_uri: artifact.resource_uri,
        size_bytes: artifact.size_bytes,
        hash: artifact.hash,
        preview: artifact.preview,
        path: artifact.path,
        metadata_json: JSON.stringify(artifact.metadata ?? {})
      });
  }

  listArtifacts(filter: { session_id?: string; group_id?: string; task_id?: string; attempt_id?: string }): StoredArtifact[] {
    const { where, values } = buildWhereClause(filter, ["session_id", "group_id", "task_id", "attempt_id"] as const);
    return (this.db.prepare(`select * from artifacts ${where} order by created_at, artifact_id`).all(...values) as ArtifactRow[]).map((row) =>
      this.mapArtifact(row)
    );
  }

  getArtifactByResourceUri(resourceUri: string): StoredArtifact | undefined {
    const row = this.db.prepare("select * from artifacts where resource_uri = ?").get(resourceUri) as ArtifactRow | undefined;
    return row ? this.mapArtifact(row) : undefined;
  }

  getArtifactById(artifactId: string): StoredArtifact | undefined {
    const row = this.db.prepare("select * from artifacts where artifact_id = ?").get(artifactId) as ArtifactRow | undefined;
    return row ? this.mapArtifact(row) : undefined;
  }

  listEvents(filter: { session_id?: string; group_id?: string; task_id?: string; type?: string } = {}): StoredEvent[] {
    return eventStore.listEvents(this.db, filter);
  }

  listAttemptsByStatus(status: TaskRuntimeStatus): StoredAttempt[] {
    return attemptStore.listAttemptsByStatus(this.db, status);
  }

  listQueuedTaskIds(): string[] {
    return (this.db.prepare("select task_id from tasks where status = 'queued' order by created_at, task_id").all() as Array<{ task_id: string }>).map(
      (row) => row.task_id
    );
  }

  recordMetric(input: RecordMetricInput & { metric_id?: string; created_at?: string }): void {
    metricStore.recordMetric(this.db, input);
  }

  queryMetrics(filter: { name?: string; session_id?: string; task_id?: string; limit?: number } = {}): StoredMetric[] {
    return metricStore.queryMetrics(this.db, filter);
  }

  appendEvents(events: EventInput[]): void {
    eventStore.appendEvents(this.db, events);
  }

  appendEvent(input: EventInput): void {
    eventStore.appendEvent(this.db, input);
  }

  private migrate(): void {
    runMigrations(this.db, this.dbPath);
  }

  private mapGroup(row: GroupRow): StoredGroup {
    return {
      group_id: row.group_id,
      session_id: row.session_id,
      title: row.title,
      status: row.status as StoredGroup["status"],
      expected_brief_revision: row.expected_brief_revision,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private mapTask(row: TaskRow): StoredTask {
    return {
      task_id: row.task_id,
      session_id: row.session_id,
      group_id: row.group_id,
      status: row.status as TaskRuntimeStatus,
      mode: row.mode,
      goal: row.goal,
      adapter: row.adapter,
      profile: row.profile,
      envelope: JSON.parse(row.envelope_json) as TaskEnvelope,
      attempt_count: row.attempt_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
      ...(row.latest_attempt_id != null ? { latest_attempt_id: row.latest_attempt_id } : {})
    };
  }

  private mapArtifact(row: ArtifactRow): StoredArtifact {
    const scope = {
      ...(row.session_id != null ? { session_id: row.session_id } : {}),
      ...(row.group_id != null ? { group_id: row.group_id } : {}),
      ...(row.task_id != null ? { task_id: row.task_id } : {}),
      ...(row.attempt_id != null ? { attempt_id: row.attempt_id } : {})
    };
    return {
      schema_version: "1",
      artifact_id: row.artifact_id,
      scope,
      type: row.type as StoredArtifact["type"],
      mime_type: row.mime_type,
      summary: row.summary,
      created_at: row.created_at,
      resource_uri: row.resource_uri,
      metadata: jsonColumn<Record<string, unknown>>(row.metadata_json, {}),
      ...(row.size_bytes != null ? { size_bytes: row.size_bytes } : {}),
      ...(row.hash != null ? { hash: row.hash } : {}),
      ...(row.preview != null ? { preview: row.preview } : {}),
      ...(row.path != null ? { path: row.path } : {})
    };
  }
}
