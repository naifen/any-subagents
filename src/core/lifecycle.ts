import { nowIso } from "../util/time.js";
import { Store } from "../db/store.js";
import type { TaskRuntimeStatus } from "../domain/status.js";
import type { StoredAttempt } from "../db/store.js";

export type FinalizeAttemptInput =
  | { taskId: string; groupId: string; attempt: StoredAttempt }
  | { taskId: string; groupId: string; attemptId?: string; status: TaskRuntimeStatus; error?: string };

/**
 * Centralised state transition for ending a task attempt.
 *
 * Callers express intent (status + error, or a final attempt record);
 * persistence is delegated to store.finishTaskOutcome in one transaction.
 */
export const finalizeAttempt = (store: Store, input: FinalizeAttemptInput): void => {
  if ("attempt" in input) {
    store.finishTaskOutcome({ groupId: input.groupId, taskId: input.taskId, attempt: input.attempt });
    return;
  }

  const timestamp = nowIso();
  let attempt: StoredAttempt | undefined;
  if (input.attemptId) {
    const existing = store.getAttempt(input.attemptId);
    if (existing) {
      attempt = {
        ...existing,
        status: input.status,
        ...(input.error ? { error: input.error } : {}),
        updated_at: timestamp,
        finished_at: timestamp
      };
    }
  }

  if (attempt) {
    store.finishTaskOutcome({ groupId: input.groupId, taskId: input.taskId, attempt });
    return;
  }

  store.finishTaskOutcome({ groupId: input.groupId, taskId: input.taskId, status: input.status });
};
