import { nowIso } from "../util/time.js";
import { Store } from "../db/store.js";
import type { TaskRuntimeStatus } from "./status.js";
import type { StoredAttempt } from "../db/store.js";

export interface FinalizeAttemptInput {
  attemptId?: string | undefined;
  taskId: string;
  groupId: string;
  status: TaskRuntimeStatus;
  error?: string;
  attempt?: StoredAttempt;
}

/**
 * Centralised state transition for ending a task attempt.
 *
 * Callers express intent (status + error, or a final attempt record);
 * persistence is delegated to store.finishTaskOutcome in one transaction.
 */
export const finalizeAttempt = (store: Store, input: FinalizeAttemptInput): void => {
  const timestamp = nowIso();
  const attempt =
    input.attempt ??
    (input.attemptId
      ? (() => {
          const existing = store.getAttempt(input.attemptId);
          if (!existing) return undefined;
          return {
            ...existing,
            status: input.status,
            ...(input.error ? { error: input.error } : {}),
            updated_at: timestamp,
            finished_at: timestamp
          };
        })()
      : undefined);

  if (attempt) {
    store.finishTaskOutcome({ groupId: input.groupId, taskId: input.taskId, attempt });
    return;
  }

  store.finishTaskOutcome({ groupId: input.groupId, taskId: input.taskId, status: input.status });
};
