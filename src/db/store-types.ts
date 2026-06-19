import type { ResultEnvelope } from "../schemas/index.js";
import type { TaskRuntimeStatus } from "../domain/status.js";

export interface StoredEvent {
  event_id: string;
  type: string;
  created_at: string;
  session_id?: string;
  group_id?: string;
  task_id?: string;
  attempt_id?: string;
  artifact_id?: string;
  severity?: "debug" | "info" | "warning" | "error";
  message?: string;
  data?: Record<string, unknown>;
}

export interface EventInput {
  type: string;
  session_id?: string;
  group_id?: string;
  task_id?: string;
  attempt_id?: string;
  artifact_id?: string;
  severity?: "debug" | "info" | "warning" | "error";
  message?: string;
  data?: Record<string, unknown>;
}

export interface StoredMetric {
  metric_id: string;
  name: string;
  value: number;
  unit?: string;
  created_at: string;
  session_id?: string;
  group_id?: string;
  task_id?: string;
  attempt_id?: string;
  labels: Record<string, unknown>;
}

export type RecordMetricInput = Omit<StoredMetric, "metric_id" | "created_at">;

export interface EventRow {
  event_id: string;
  type: string;
  created_at: string;
  session_id: string | null;
  group_id: string | null;
  task_id: string | null;
  attempt_id: string | null;
  artifact_id: string | null;
  severity: string | null;
  message: string | null;
  data_json: string | null;
}

export interface MetricRow {
  metric_id: string;
  name: string;
  value: number;
  unit: string | null;
  created_at: string;
  session_id: string | null;
  group_id: string | null;
  task_id: string | null;
  attempt_id: string | null;
  labels_json: string;
}

export interface RecoverInterruptedResult {
  interruptedAttemptIds: string[];
  queuedTaskIds: string[];
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
  requested_model?: string;
  effective_model?: string;
  requested_reasoning_level?: string;
  effective_reasoning_level?: string;
  requested_permissions?: Record<string, unknown>;
  effective_permissions?: Record<string, unknown>;
  requested_sandbox?: Record<string, unknown>;
  effective_sandbox?: Record<string, unknown>;
  network_policy?: string;
  package_install_policy?: string;
}
