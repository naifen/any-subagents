import type { TaskEnvelope, Session, SubmitTaskGroupInput } from "../schemas/index.js";
import { schemaVersion, taskEnvelopeSchema } from "../schemas/index.js";
import type { AppConfig } from "../config/schema.js";
import type { EventInput, StoredGroup, StoredTask } from "../db/store.js";
import { Store } from "../db/store.js";
import { newTaskGroupId, newTaskId } from "../util/id.js";
import { nowIso } from "../util/time.js";
import { findDuplicateTasks, resolveProfile, resolveProfilePolicy, type TaskInputFields } from "./task-policy.js";

export type { SubmitTaskGroupInput };

export interface BuiltTaskGroupSubmission {
  group: StoredGroup;
  taskInputs: TaskEnvelope[];
  pendingEvents: EventInput[];
  timestamp: string;
}

export const buildTaskGroupSubmission = (
  config: AppConfig,
  session: Session,
  input: SubmitTaskGroupInput
): BuiltTaskGroupSubmission => {
  const pendingEvents: EventInput[] = [];
  const revisionConflict = session.brief_revision !== input.expected_brief_revision;
  if (revisionConflict && input.ignore_revision_conflict === true) {
    pendingEvents.push({
      type: "session.revision_override",
      session_id: session.session_id,
      severity: "warning",
      message: "Task group submitted with ignore_revision_conflict",
      data: { expected_brief_revision: input.expected_brief_revision, actual_brief_revision: session.brief_revision }
    });
  }

  const timestamp = nowIso();
  const group: StoredGroup = {
    group_id: newTaskGroupId(),
    session_id: session.session_id,
    title: input.title,
    status: "queued",
    expected_brief_revision: input.expected_brief_revision,
    created_at: timestamp,
    updated_at: timestamp
  };
  const inheritedPriority = input.priority ?? session.priority ?? 0;
  const taskInputs = input.tasks.map((taskInput) => {
    const task_id = newTaskId();
    const profile = resolveProfile(config, taskInput.adapter, taskInput.profile);
    const policyInput: TaskInputFields = {
      ...(taskInput.model !== undefined ? { model: taskInput.model } : {}),
      ...(taskInput.reasoning_level !== undefined ? { reasoning_level: taskInput.reasoning_level } : {}),
      ...(taskInput.allow_fallback !== undefined ? { allow_fallback: taskInput.allow_fallback } : {})
    };
    const resolved = resolveProfilePolicy(policyInput, profile);
    for (const event of resolved.events) {
      pendingEvents.push({ ...event, session_id: session.session_id });
    }
    const metadata = taskInput.metadata ?? {};
    return taskEnvelopeSchema.parse({
      schema_version: schemaVersion,
      task_id,
      session_id: session.session_id,
      group_id: group.group_id,
      mode: taskInput.mode,
      goal: taskInput.goal,
      adapter: taskInput.adapter,
      profile: taskInput.profile,
      scope: taskInput.scope,
      success_criteria: taskInput.success_criteria,
      constraints: taskInput.constraints,
      verification_commands: taskInput.verification_commands,
      timeout_ms: taskInput.timeout_ms,
      ...(taskInput.model ? { requested_model: taskInput.model } : {}),
      ...(taskInput.reasoning_level ? { requested_reasoning_level: taskInput.reasoning_level } : {}),
      ...(taskInput.allow_fallback !== undefined ? { allow_fallback: taskInput.allow_fallback } : {}),
      ...(resolved.effectiveModel ? { model: resolved.effectiveModel } : {}),
      ...(resolved.effectiveReasoning ? { reasoning_level: resolved.effectiveReasoning } : {}),
      priority: taskInput.priority ?? inheritedPriority,
      metadata
    });
  });

  const duplicateKeys = findDuplicateTasks(taskInputs);
  if (duplicateKeys.length > 0) {
    pendingEvents.push({
      type: "task_group.duplicate_warning",
      session_id: session.session_id,
      group_id: group.group_id,
      severity: "warning",
      message: "Deterministic duplicate tasks detected in submission",
      data: { duplicate_keys: duplicateKeys }
    });
  }

  return { group, taskInputs, pendingEvents, timestamp };
};

export const persistTaskGroupSubmission = (store: Store, submission: BuiltTaskGroupSubmission): void => {
  const { group, taskInputs, pendingEvents, timestamp } = submission;
  store.inTransaction(() => {
    store.insertGroup(group);
    for (const envelope of taskInputs) {
      const task: StoredTask = {
        task_id: envelope.task_id,
        session_id: envelope.session_id,
        group_id: envelope.group_id,
        status: "queued",
        mode: envelope.mode,
        goal: envelope.goal,
        adapter: envelope.adapter,
        profile: envelope.profile,
        envelope,
        attempt_count: 0,
        created_at: timestamp,
        updated_at: timestamp
      };
      store.insertTask(task);
      store.appendEvent({
        type: "task.queued",
        session_id: task.session_id,
        group_id: task.group_id,
        task_id: task.task_id,
        severity: "info",
        message: "Task queued"
      });
    }
    store.appendEvents(pendingEvents);
  });
};
