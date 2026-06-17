export type TaskRuntimeStatus =
  | "queued"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "interrupted"
  | "failed_contract"
  | "completed_with_failed_verification";

export type GroupStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "mixed";

export const terminalStatuses = new Set<TaskRuntimeStatus>([
  "completed",
  "blocked",
  "failed",
  "timed_out",
  "cancelled",
  "interrupted",
  "failed_contract",
  "completed_with_failed_verification"
]);

export const failureStatuses = new Set<TaskRuntimeStatus>([
  "failed",
  "timed_out",
  "interrupted",
  "failed_contract",
  "completed_with_failed_verification"
]);

/**
 * Derive a task group's aggregate status from its tasks' statuses.
 *
 * Single-pass count-based approach — no implicit priority ordering.
 */
export const deriveGroupStatus = (statuses: TaskRuntimeStatus[]): GroupStatus => {
  if (statuses.length === 0) return "queued";

  let running = 0;
  let queued = 0;
  let completed = 0;
  let cancelled = 0;
  let failed = 0;

  for (const status of statuses) {
    if (status === "running") running++;
    else if (status === "queued") queued++;
    else if (status === "completed") completed++;
    else if (status === "cancelled") cancelled++;
    else if (failureStatuses.has(status)) failed++;
  }

  // Any task still in progress → group is running
  if (running > 0 || queued > 0) return "running";

  // All tasks reached the same terminal state
  if (completed === statuses.length) return "completed";
  if (cancelled === statuses.length) return "cancelled";

  // Any failures → group failed
  if (failed > 0) return "failed";

  // Mix of terminal states (e.g. some completed, some cancelled)
  return "mixed";
};
