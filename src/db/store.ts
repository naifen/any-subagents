import { mkdir } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import type { Artifact, ResultEnvelope, Session, SessionBrief, TaskEnvelope } from "../schemas/index.js";
import { newEventId } from "../core/id.js";
import { nowIso } from "../core/time.js";
import type { GroupStatus, TaskRuntimeStatus } from "../core/status.js";

export type { TaskRuntimeStatus, GroupStatus } from "../core/status.js";

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

export interface StoredAttempt {
  attempt_id: string;
  task_id: string;
  attempt_number: number;
  status: TaskRuntimeStatus;
  worktree_path?: string;
  log_path?: string;
  result_path?: string;
  result?: ResultEnvelope;
  error?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
  finished_at?: string;
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

interface AttemptRow {
  attempt_id: string;
  task_id: string;
  attempt_number: number;
  status: string;
  worktree_path: string | null;
  log_path: string | null;
  result_path: string | null;
  result_json: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
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

/** Parse a nullable JSON column, defaulting to `fallback` when null/empty. */
const jsonColumn = <T>(value: string | null, fallback: T): T =>
  value != null && value.length > 0 ? (JSON.parse(value) as T) : fallback;

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
          (session_id, repo, base_ref, status, brief_json, brief_revision, created_at, updated_at, metadata_json)
         values
          (@session_id, @repo, @base_ref, @status, @brief_json, @brief_revision, @created_at, @updated_at, @metadata_json)`
      )
      .run({
        ...session,
        brief_json: JSON.stringify(session.brief),
        metadata_json: JSON.stringify(session.metadata ?? {})
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
      metadata: jsonColumn<Record<string, unknown>>(row.metadata_json, {})
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
    this.db
      .prepare(
        `insert into attempts
          (attempt_id, task_id, attempt_number, status, worktree_path, log_path, result_path, result_json, error, created_at, updated_at, started_at, finished_at)
         values
          (@attempt_id, @task_id, @attempt_number, @status, @worktree_path, @log_path, @result_path, @result_json, @error, @created_at, @updated_at, @started_at, @finished_at)`
      )
      .run({
        ...attempt,
        worktree_path: attempt.worktree_path,
        log_path: attempt.log_path,
        result_path: attempt.result_path,
        result_json: attempt.result ? JSON.stringify(attempt.result) : null,
        error: attempt.error ?? null,
        started_at: attempt.started_at ?? null,
        finished_at: attempt.finished_at ?? null
      });
  }

  getAttempt(attemptId: string): StoredAttempt | undefined {
    const row = this.db.prepare("select * from attempts where attempt_id = ?").get(attemptId) as AttemptRow | undefined;
    return row ? this.mapAttempt(row) : undefined;
  }

  getLatestAttemptForTask(taskId: string): StoredAttempt | undefined {
    const row = this.db
      .prepare("select * from attempts where task_id = ? order by attempt_number desc limit 1")
      .get(taskId) as AttemptRow | undefined;
    return row ? this.mapAttempt(row) : undefined;
  }

  updateAttempt(attempt: StoredAttempt): void {
    this.db
      .prepare(
        `update attempts
         set status = @status,
             worktree_path = @worktree_path,
             log_path = @log_path,
             result_path = @result_path,
             result_json = @result_json,
             error = @error,
             updated_at = @updated_at,
             started_at = @started_at,
             finished_at = @finished_at
         where attempt_id = @attempt_id`
      )
      .run({
        attempt_id: attempt.attempt_id,
        status: attempt.status,
        worktree_path: attempt.worktree_path ?? null,
        log_path: attempt.log_path ?? null,
        result_path: attempt.result_path ?? null,
        result_json: attempt.result ? JSON.stringify(attempt.result) : null,
        error: attempt.error ?? null,
        updated_at: attempt.updated_at,
        started_at: attempt.started_at ?? null,
        finished_at: attempt.finished_at ?? null
      });
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
    const clauses: string[] = [];
    const values: string[] = [];
    for (const key of ["session_id", "group_id", "task_id", "attempt_id"] as const) {
      const value = filter[key];
      if (value) {
        clauses.push(`${key} = ?`);
        values.push(value);
      }
    }
    const where = clauses.length > 0 ? `where ${clauses.join(" and ")}` : "";
    return (this.db.prepare(`select * from artifacts ${where} order by created_at, artifact_id`).all(...values) as ArtifactRow[]).map((row) =>
      this.mapArtifact(row)
    );
  }

  getArtifactByResourceUri(resourceUri: string): StoredArtifact | undefined {
    const row = this.db.prepare("select * from artifacts where resource_uri = ?").get(resourceUri) as ArtifactRow | undefined;
    return row ? this.mapArtifact(row) : undefined;
  }

  appendEvent(input: {
    type: string;
    session_id?: string;
    group_id?: string;
    task_id?: string;
    attempt_id?: string;
    artifact_id?: string;
    severity?: "debug" | "info" | "warning" | "error";
    message?: string;
    data?: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `insert into events
          (event_id, type, created_at, session_id, group_id, task_id, attempt_id, artifact_id, severity, message, data_json)
         values
          (@event_id, @type, @created_at, @session_id, @group_id, @task_id, @attempt_id, @artifact_id, @severity, @message, @data_json)`
      )
      .run({
        event_id: newEventId(),
        type: input.type,
        created_at: nowIso(),
        session_id: input.session_id ?? null,
        group_id: input.group_id ?? null,
        task_id: input.task_id ?? null,
        attempt_id: input.attempt_id ?? null,
        artifact_id: input.artifact_id ?? null,
        severity: input.severity ?? null,
        message: input.message ?? null,
        data_json: JSON.stringify(input.data ?? {})
      });
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists sessions (
        session_id text primary key,
        repo text not null,
        base_ref text not null,
        status text not null,
        brief_json text not null,
        brief_revision integer not null,
        created_at text not null,
        updated_at text not null,
        metadata_json text not null
      );

      create table if not exists task_groups (
        group_id text primary key,
        session_id text not null references sessions(session_id) on delete cascade,
        title text not null,
        status text not null,
        expected_brief_revision integer not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists tasks (
        task_id text primary key,
        session_id text not null references sessions(session_id) on delete cascade,
        group_id text not null references task_groups(group_id) on delete cascade,
        status text not null,
        mode text not null,
        goal text not null,
        adapter text not null,
        profile text not null,
        envelope_json text not null,
        latest_attempt_id text,
        attempt_count integer not null,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists attempts (
        attempt_id text primary key,
        task_id text not null references tasks(task_id) on delete cascade,
        attempt_number integer not null,
        status text not null,
        worktree_path text,
        log_path text,
        result_path text,
        result_json text,
        error text,
        created_at text not null,
        updated_at text not null,
        started_at text,
        finished_at text
      );

      create table if not exists artifacts (
        artifact_id text primary key,
        session_id text,
        group_id text,
        task_id text,
        attempt_id text,
        type text not null,
        mime_type text not null,
        summary text not null,
        created_at text not null,
        resource_uri text not null unique,
        size_bytes integer,
        hash text,
        preview text,
        path text,
        metadata_json text not null
      );

      create table if not exists events (
        event_id text primary key,
        type text not null,
        created_at text not null,
        session_id text,
        group_id text,
        task_id text,
        attempt_id text,
        artifact_id text,
        severity text,
        message text,
        data_json text
      );
    `);
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

  private mapAttempt(row: AttemptRow): StoredAttempt {
    return {
      attempt_id: row.attempt_id,
      task_id: row.task_id,
      attempt_number: row.attempt_number,
      status: row.status as TaskRuntimeStatus,
      created_at: row.created_at,
      updated_at: row.updated_at,
      ...(row.worktree_path != null ? { worktree_path: row.worktree_path } : {}),
      ...(row.log_path != null ? { log_path: row.log_path } : {}),
      ...(row.result_path != null ? { result_path: row.result_path } : {}),
      ...(row.result_json != null && row.result_json.length > 0 ? { result: JSON.parse(row.result_json) as ResultEnvelope } : {}),
      ...(row.error != null ? { error: row.error } : {}),
      ...(row.started_at != null ? { started_at: row.started_at } : {}),
      ...(row.finished_at != null ? { finished_at: row.finished_at } : {})
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
