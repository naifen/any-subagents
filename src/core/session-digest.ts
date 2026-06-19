import type { Store, StoredGroup } from "../db/store.js";
import { countTaskStatuses } from "./status.js";

export interface SessionDigest {
  session_id: string;
  summary: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    blocked: number;
    failed: number;
    cancelled: number;
  };
  groups: Array<{ group_id: string; status: StoredGroup["status"] }>;
}

export const buildSessionDigest = (store: Store, sessionId: string): SessionDigest => {
  const tasks = store.listTasks({ session_id: sessionId });
  const counts = countTaskStatuses(tasks.map((task) => task.status));
  const groups = [...new Set(tasks.map((task) => task.group_id))]
    .map((groupId) => store.getGroup(groupId))
    .filter((group): group is StoredGroup => group !== undefined)
    .map((group) => ({ group_id: group.group_id, status: group.status }));
  return {
    session_id: sessionId,
    summary: {
      total: tasks.length,
      queued: counts.queued,
      running: counts.running,
      completed: counts.completed,
      blocked: counts.blocked,
      failed: counts.failed,
      cancelled: counts.cancelled
    },
    groups
  };
};
