import { nowIso } from "./time.js";
import { Store } from "../db/store.js";
import { deriveGroupStatus, type TaskRuntimeStatus } from "./status.js";

export interface FinalizeAttemptInput {
  attemptId?: string | undefined;
  taskId: string;
  groupId: string;
  status: TaskRuntimeStatus;
  error?: string;
}

/**
 * Centralised state transition for ending a task attempt.
 *
 * Performs the three-step dance that was previously duplicated across
 * ControlPlane.cancelTasks, Scheduler.schedule catch, and TaskRunner.run:
 *   1. Update the attempt record (status, error, finished_at)
 *   2. Update the task status
 *   3. Re-derive and update the group status
 *
 * Callers express *intent* (status + error); this function owns the
 * multi-step persistence.
 */
export const finalizeAttempt = (store: Store, input: FinalizeAttemptInput): void => {
  const timestamp = nowIso();

  if (input.attemptId) {
    const attempt = store.getAttempt(input.attemptId);
    if (attempt) {
      store.updateAttempt({
        ...attempt,
        status: input.status,
        ...(input.error ? { error: input.error } : {}),
        updated_at: timestamp,
        finished_at: timestamp
      });
    }
  }

  store.updateTaskStatus(input.taskId, input.status);

  const tasks = store.listTasks({ group_id: input.groupId });
  const groupStatus = deriveGroupStatus(tasks.map((task) => task.status as TaskRuntimeStatus));
  store.updateGroupStatus(input.groupId, groupStatus);
};
