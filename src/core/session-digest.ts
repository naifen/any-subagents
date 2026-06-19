import type { Store, StoredGroup } from "../db/store.js";
import { failureStatuses } from "../domain/status.js";

export interface SessionDigest {
  session_id: string;
  summary: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
  };
  groups: Array<{ group_id: string; status: StoredGroup["status"] }>;
}

export const buildSessionDigest = (store: Store, sessionId: string): SessionDigest => {
  const tasks = store.listTasks({ session_id: sessionId });
  const groups = [...new Set(tasks.map((task) => task.group_id))]
    .map((groupId) => store.getGroup(groupId))
    .filter((group): group is StoredGroup => group !== undefined)
    .map((group) => ({ group_id: group.group_id, status: group.status }));
  return {
    session_id: sessionId,
    summary: {
      total: tasks.length,
      queued: tasks.filter((task) => task.status === "queued").length,
      running: tasks.filter((task) => task.status === "running").length,
      completed: tasks.filter((task) => task.status === "completed").length,
      failed: tasks.filter((task) => failureStatuses.has(task.status)).length,
      cancelled: tasks.filter((task) => task.status === "cancelled").length
    },
    groups
  };
};
