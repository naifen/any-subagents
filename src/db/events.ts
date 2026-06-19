import type Database from "better-sqlite3";
import { newEventId } from "../util/id.js";
import { nowIso } from "../util/time.js";
import { buildWhereClause } from "./query-helpers.js";
import type { EventRow, EventInput, StoredEvent } from "./store-types.js";

const mapEvent = (row: EventRow): StoredEvent => {
  const event: StoredEvent = {
    event_id: row.event_id,
    type: row.type,
    created_at: row.created_at
  };
  if (row.session_id != null) event.session_id = row.session_id;
  if (row.group_id != null) event.group_id = row.group_id;
  if (row.task_id != null) event.task_id = row.task_id;
  if (row.attempt_id != null) event.attempt_id = row.attempt_id;
  if (row.artifact_id != null) event.artifact_id = row.artifact_id;
  if (row.severity === "debug" || row.severity === "info" || row.severity === "warning" || row.severity === "error") {
    event.severity = row.severity;
  }
  if (row.message != null) event.message = row.message;
  if (row.data_json != null && row.data_json.length > 0) event.data = JSON.parse(row.data_json) as Record<string, unknown>;
  return event;
};

export const listEvents = (
  db: Database.Database,
  filter: { session_id?: string; group_id?: string; task_id?: string; type?: string } = {}
): StoredEvent[] => {
  const { where, values } = buildWhereClause(filter, ["session_id", "group_id", "task_id", "type"] as const);
  return (db.prepare(`select * from events ${where} order by created_at, event_id`).all(...values) as EventRow[]).map(mapEvent);
};

export const appendEvent = (db: Database.Database, input: EventInput): void => {
  db.prepare(
    `insert into events
      (event_id, type, created_at, session_id, group_id, task_id, attempt_id, artifact_id, severity, message, data_json)
     values
      (@event_id, @type, @created_at, @session_id, @group_id, @task_id, @attempt_id, @artifact_id, @severity, @message, @data_json)`
  ).run({
    event_id: newEventId(),
    type: input.type,
    created_at: nowIso(),
    session_id: input.session_id ?? null,
    group_id: input.group_id ?? null,
    task_id: input.task_id ?? null,
    attempt_id: input.attempt_id ?? null,
    artifact_id: input.artifact_id ?? null,
    severity: input.severity ?? null,
    message: input.message ?? null,
    data_json: JSON.stringify(input.data ?? {})
  });
};

export const appendEvents = (db: Database.Database, events: EventInput[]): void => {
  for (const event of events) {
    appendEvent(db, event);
  }
};
