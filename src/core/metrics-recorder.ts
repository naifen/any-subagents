import type { Store, RecordMetricInput } from "../db/store.js";

export interface MetricsRecorder {
  record(name: string, value: number, labels?: Record<string, unknown>): void;
}

const scopeKeys = ["session_id", "group_id", "task_id", "attempt_id"] as const;

export const createMetricsRecorder = (store: Store): MetricsRecorder => ({
  record(name, value, labels = {}) {
    // Promote scope ids to dedicated columns and drop them from the labels blob
    // so they are not persisted twice.
    const remainingLabels: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(labels)) {
      if (!(scopeKeys as readonly string[]).includes(key)) remainingLabels[key] = entry;
    }
    const metric: RecordMetricInput = { name, value, labels: remainingLabels };
    for (const key of scopeKeys) {
      const id = labels[key];
      if (typeof id === "string") metric[key] = id;
    }
    store.recordMetric(metric);
  }
});
