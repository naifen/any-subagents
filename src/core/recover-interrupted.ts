import type { Store } from "../db/store.js";
import type { EventInput, RecoverInterruptedResult } from "../db/store-types.js";
import { finalizeAttempt } from "./lifecycle.js";

export const recoverInterruptedAttempts = (store: Store): RecoverInterruptedResult => {
  return store.inTransaction(() => {
    const running = store.listAttemptsByStatus("running");
    const interruptedAttemptIds: string[] = [];
    const events: EventInput[] = [];

    for (const attempt of running) {
      const task = store.getTask(attempt.task_id);
      if (task) {
        finalizeAttempt(store, {
          attemptId: attempt.attempt_id,
          taskId: attempt.task_id,
          groupId: task.group_id,
          status: "interrupted",
          error: attempt.error ?? "Interrupted by daemon restart"
        });
        const event: EventInput = {
          type: "attempt.interrupted",
          task_id: attempt.task_id,
          attempt_id: attempt.attempt_id,
          severity: "warning",
          message: "Attempt interrupted by daemon restart"
        };
        if (task.session_id !== undefined) event.session_id = task.session_id;
        if (task.group_id !== undefined) event.group_id = task.group_id;
        events.push(event);
      }
      interruptedAttemptIds.push(attempt.attempt_id);
    }

    if (events.length > 0) {
      store.appendEvents(events);
    }

    return { interruptedAttemptIds, queuedTaskIds: store.listQueuedTaskIds() };
  });
};
