import type { StoredAttempt } from "../db/store-types.js";
import type { TaskAttempt } from "./attempt.js";

export const taskAttemptFromStored = (attempt: StoredAttempt): TaskAttempt => ({
  attemptId: attempt.attempt_id,
  taskId: attempt.task_id,
  attemptNumber: attempt.attempt_number,
  status: attempt.status,
  createdAt: attempt.created_at,
  updatedAt: attempt.updated_at,
  ...(attempt.worktree_path ? { worktreePath: attempt.worktree_path } : {}),
  ...(attempt.log_path ? { logPath: attempt.log_path } : {}),
  ...(attempt.result_path ? { resultPath: attempt.result_path } : {}),
  ...(attempt.result ? { result: attempt.result } : {}),
  ...(attempt.error ? { error: attempt.error } : {}),
  ...(attempt.started_at ? { startedAt: attempt.started_at } : {}),
  ...(attempt.finished_at ? { finishedAt: attempt.finished_at } : {}),
  ...(attempt.requested_model ? { requestedModel: attempt.requested_model } : {}),
  ...(attempt.effective_model ? { effectiveModel: attempt.effective_model } : {}),
  ...(attempt.requested_reasoning_level ? { requestedReasoningLevel: attempt.requested_reasoning_level } : {}),
  ...(attempt.effective_reasoning_level ? { effectiveReasoningLevel: attempt.effective_reasoning_level } : {}),
  ...(attempt.requested_permissions ? { requestedPermissions: attempt.requested_permissions } : {}),
  ...(attempt.effective_permissions ? { effectivePermissions: attempt.effective_permissions } : {}),
  ...(attempt.requested_sandbox ? { requestedSandbox: attempt.requested_sandbox } : {}),
  ...(attempt.effective_sandbox ? { effectiveSandbox: attempt.effective_sandbox } : {}),
  ...(attempt.network_policy ? { networkPolicy: attempt.network_policy } : {}),
  ...(attempt.package_install_policy ? { packageInstallPolicy: attempt.package_install_policy } : {})
});

export const taskAttemptToStored = (attempt: TaskAttempt): StoredAttempt => ({
  attempt_id: attempt.attemptId,
  task_id: attempt.taskId,
  attempt_number: attempt.attemptNumber,
  status: attempt.status,
  created_at: attempt.createdAt,
  updated_at: attempt.updatedAt,
  ...(attempt.worktreePath ? { worktree_path: attempt.worktreePath } : {}),
  ...(attempt.logPath ? { log_path: attempt.logPath } : {}),
  ...(attempt.resultPath ? { result_path: attempt.resultPath } : {}),
  ...(attempt.result ? { result: attempt.result } : {}),
  ...(attempt.error ? { error: attempt.error } : {}),
  ...(attempt.startedAt ? { started_at: attempt.startedAt } : {}),
  ...(attempt.finishedAt ? { finished_at: attempt.finishedAt } : {}),
  ...(attempt.requestedModel ? { requested_model: attempt.requestedModel } : {}),
  ...(attempt.effectiveModel ? { effective_model: attempt.effectiveModel } : {}),
  ...(attempt.requestedReasoningLevel ? { requested_reasoning_level: attempt.requestedReasoningLevel } : {}),
  ...(attempt.effectiveReasoningLevel ? { effective_reasoning_level: attempt.effectiveReasoningLevel } : {}),
  ...(attempt.requestedPermissions ? { requested_permissions: attempt.requestedPermissions } : {}),
  ...(attempt.effectivePermissions ? { effective_permissions: attempt.effectivePermissions } : {}),
  ...(attempt.requestedSandbox ? { requested_sandbox: attempt.requestedSandbox } : {}),
  ...(attempt.effectiveSandbox ? { effective_sandbox: attempt.effectiveSandbox } : {}),
  ...(attempt.networkPolicy ? { network_policy: attempt.networkPolicy } : {}),
  ...(attempt.packageInstallPolicy ? { package_install_policy: attempt.packageInstallPolicy } : {})
});
