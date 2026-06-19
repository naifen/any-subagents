import type Database from "better-sqlite3";
import { newMetricId } from "../util/id.js";
import { nowIso } from "../util/time.js";
import { buildWhereClause } from "./query-helpers.js";
import { jsonColumn } from "./json-column.js";
import type { MetricRow, RecordMetricInput, StoredMetric } from "./store-types.js";

const mapMetric = (row: MetricRow): StoredMetric => ({
  metric_id: row.metric_id,
  name: row.name,
  value: row.value,
  created_at: row.created_at,
  labels: jsonColumn<Record<string, unknown>>(row.labels_json, {}),
  ...(row.unit != null ? { unit: row.unit } : {}),
  ...(row.session_id != null ? { session_id: row.session_id } : {}),
  ...(row.group_id != null ? { group_id: row.group_id } : {}),
  ...(row.task_id != null ? { task_id: row.task_id } : {}),
  ...(row.attempt_id != null ? { attempt_id: row.attempt_id } : {})
});

export const recordMetric = (db: Database.Database, input: RecordMetricInput & { metric_id?: string; created_at?: string }): void => {
  db.prepare(
    `insert into metrics
      (metric_id, name, value, unit, created_at, session_id, group_id, task_id, attempt_id, labels_json)
     values
      (@metric_id, @name, @value, @unit, @created_at, @session_id, @group_id, @task_id, @attempt_id, @labels_json)`
  ).run({
    metric_id: input.metric_id ?? newMetricId(),
    name: input.name,
    value: input.value,
    unit: input.unit ?? null,
    created_at: input.created_at ?? nowIso(),
    session_id: input.session_id ?? null,
    group_id: input.group_id ?? null,
    task_id: input.task_id ?? null,
    attempt_id: input.attempt_id ?? null,
    labels_json: JSON.stringify(input.labels ?? {})
  });
};

export const queryMetrics = (
  db: Database.Database,
  filter: { name?: string; session_id?: string; task_id?: string; limit?: number } = {}
): StoredMetric[] => {
  const { where, values } = buildWhereClause(filter, ["name", "session_id", "task_id"] as const);
  const limit = filter.limit ?? 100;
  return (db.prepare(`select * from metrics ${where} order by created_at desc limit ?`).all(...values, limit) as MetricRow[]).map(mapMetric);
};
