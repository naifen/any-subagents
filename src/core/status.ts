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

export interface TaskStatusCounts {
  queued: number;
  running: number;
  completed: number;
  blocked: number;
  cancelled: number;
  failed: number;
}

export const countTaskStatuses = (statuses: TaskRuntimeStatus[]): TaskStatusCounts => {
  const counts: TaskStatusCounts = {
    queued: 0,
    running: 0,
    completed: 0,
    blocked: 0,
    cancelled: 0,
    failed: 0
  };

  for (const status of statuses) {
    switch (status) {
      case "queued":
        counts.queued++;
        break;
      case "running":
        counts.running++;
        break;
      case "completed":
        counts.completed++;
        break;
      case "blocked":
        counts.blocked++;
        break;
      case "cancelled":
        counts.cancelled++;
        break;
      case "failed":
      case "timed_out":
      case "interrupted":
      case "failed_contract":
      case "completed_with_failed_verification":
        counts.failed++;
        break;
      default: {
        const unhandled: never = status;
        throw new Error(`Unhandled task status: ${String(unhandled)}`);
      }
    }
  }

  return counts;
};

/**
 * Derive a task group's aggregate status from its tasks' statuses.
 */
export const deriveGroupStatus = (statuses: TaskRuntimeStatus[]): GroupStatus => {
  if (statuses.length === 0) return "queued";

  const counts = countTaskStatuses(statuses);

  if (counts.running > 0 || counts.queued > 0) return "running";
  if (counts.completed === statuses.length) return "completed";
  if (counts.cancelled === statuses.length) return "cancelled";
  // Story 26: blocked is terminal; an all-blocked group is a group-level failure.
  if (counts.blocked === statuses.length) return "failed";
  if (counts.failed > 0) return "failed";

  return "mixed";
};
