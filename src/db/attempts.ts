import type Database from "better-sqlite3";
import type { ResultEnvelope } from "../schemas/index.js";
import type { TaskRuntimeStatus } from "../domain/status.js";
import type { StoredAttempt } from "./store-types.js";

export interface AttemptRow {
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
  requested_model: string | null;
  effective_model: string | null;
  requested_reasoning_level: string | null;
  effective_reasoning_level: string | null;
  requested_permissions_json: string | null;
  effective_permissions_json: string | null;
  requested_sandbox_json: string | null;
  effective_sandbox_json: string | null;
  network_policy: string | null;
  package_install_policy: string | null;
}

export const attemptToBindParams = (attempt: StoredAttempt): Record<string, unknown> => ({
  attempt_id: attempt.attempt_id,
  task_id: attempt.task_id,
  attempt_number: attempt.attempt_number,
  status: attempt.status,
  worktree_path: attempt.worktree_path ?? null,
  log_path: attempt.log_path ?? null,
  result_path: attempt.result_path ?? null,
  result_json: attempt.result ? JSON.stringify(attempt.result) : null,
  error: attempt.error ?? null,
  created_at: attempt.created_at,
  updated_at: attempt.updated_at,
  started_at: attempt.started_at ?? null,
  finished_at: attempt.finished_at ?? null,
  requested_model: attempt.requested_model ?? null,
  effective_model: attempt.effective_model ?? null,
  requested_reasoning_level: attempt.requested_reasoning_level ?? null,
  effective_reasoning_level: attempt.effective_reasoning_level ?? null,
  requested_permissions_json: attempt.requested_permissions ? JSON.stringify(attempt.requested_permissions) : null,
  effective_permissions_json: attempt.effective_permissions ? JSON.stringify(attempt.effective_permissions) : null,
  requested_sandbox_json: attempt.requested_sandbox ? JSON.stringify(attempt.requested_sandbox) : null,
  effective_sandbox_json: attempt.effective_sandbox ? JSON.stringify(attempt.effective_sandbox) : null,
  network_policy: attempt.network_policy ?? null,
  package_install_policy: attempt.package_install_policy ?? null
});

export const mapAttemptRow = (row: AttemptRow): StoredAttempt => ({
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
  ...(row.finished_at != null ? { finished_at: row.finished_at } : {}),
  ...(row.requested_model != null ? { requested_model: row.requested_model } : {}),
  ...(row.effective_model != null ? { effective_model: row.effective_model } : {}),
  ...(row.requested_reasoning_level != null ? { requested_reasoning_level: row.requested_reasoning_level } : {}),
  ...(row.effective_reasoning_level != null ? { effective_reasoning_level: row.effective_reasoning_level } : {}),
  ...(row.requested_permissions_json != null
    ? { requested_permissions: JSON.parse(row.requested_permissions_json) as Record<string, unknown> }
    : {}),
  ...(row.effective_permissions_json != null
    ? { effective_permissions: JSON.parse(row.effective_permissions_json) as Record<string, unknown> }
    : {}),
  ...(row.requested_sandbox_json != null ? { requested_sandbox: JSON.parse(row.requested_sandbox_json) as Record<string, unknown> } : {}),
  ...(row.effective_sandbox_json != null ? { effective_sandbox: JSON.parse(row.effective_sandbox_json) as Record<string, unknown> } : {}),
  ...(row.network_policy != null ? { network_policy: row.network_policy } : {}),
  ...(row.package_install_policy != null ? { package_install_policy: row.package_install_policy } : {})
});

const INSERT_SQL = `insert into attempts
  (attempt_id, task_id, attempt_number, status, worktree_path, log_path, result_path, result_json, error,
   created_at, updated_at, started_at, finished_at,
   requested_model, effective_model, requested_reasoning_level, effective_reasoning_level,
   requested_permissions_json, effective_permissions_json, requested_sandbox_json, effective_sandbox_json,
   network_policy, package_install_policy)
 values
  (@attempt_id, @task_id, @attempt_number, @status, @worktree_path, @log_path, @result_path, @result_json, @error,
   @created_at, @updated_at, @started_at, @finished_at,
   @requested_model, @effective_model, @requested_reasoning_level, @effective_reasoning_level,
   @requested_permissions_json, @effective_permissions_json, @requested_sandbox_json, @effective_sandbox_json,
   @network_policy, @package_install_policy)`;

const UPDATE_SQL = `update attempts
 set status = @status,
     worktree_path = @worktree_path,
     log_path = @log_path,
     result_path = @result_path,
     result_json = @result_json,
     error = @error,
     updated_at = @updated_at,
     started_at = @started_at,
     finished_at = @finished_at,
     requested_model = @requested_model,
     effective_model = @effective_model,
     requested_reasoning_level = @requested_reasoning_level,
     effective_reasoning_level = @effective_reasoning_level,
     requested_permissions_json = @requested_permissions_json,
     effective_permissions_json = @effective_permissions_json,
     requested_sandbox_json = @requested_sandbox_json,
     effective_sandbox_json = @effective_sandbox_json,
     network_policy = @network_policy,
     package_install_policy = @package_install_policy
 where attempt_id = @attempt_id`;

export const insertAttempt = (db: Database.Database, attempt: StoredAttempt): void => {
  db.prepare(INSERT_SQL).run(attemptToBindParams(attempt));
};

export const updateAttempt = (db: Database.Database, attempt: StoredAttempt): void => {
  db.prepare(UPDATE_SQL).run(attemptToBindParams(attempt));
};

export const getAttempt = (db: Database.Database, attemptId: string): StoredAttempt | undefined => {
  const row = db.prepare("select * from attempts where attempt_id = ?").get(attemptId) as AttemptRow | undefined;
  return row ? mapAttemptRow(row) : undefined;
};

export const getLatestAttemptForTask = (db: Database.Database, taskId: string): StoredAttempt | undefined => {
  const row = db
    .prepare("select * from attempts where task_id = ? order by attempt_number desc limit 1")
    .get(taskId) as AttemptRow | undefined;
  return row ? mapAttemptRow(row) : undefined;
};

export const listAttemptsByStatus = (db: Database.Database, status: TaskRuntimeStatus): StoredAttempt[] => {
  return (db.prepare("select * from attempts where status = ?").all(status) as AttemptRow[]).map(mapAttemptRow);
};
