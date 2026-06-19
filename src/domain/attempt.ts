import type { ResultEnvelope } from "../schemas/index.js";
import type { TaskRuntimeStatus } from "./status.js";

export interface TaskAttempt {
  attemptId: string;
  taskId: string;
  attemptNumber: number;
  status: TaskRuntimeStatus;
  worktreePath?: string;
  logPath?: string;
  resultPath?: string;
  result?: ResultEnvelope;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  requestedModel?: string;
  effectiveModel?: string;
  requestedReasoningLevel?: string;
  effectiveReasoningLevel?: string;
  requestedPermissions?: Record<string, unknown>;
  effectivePermissions?: Record<string, unknown>;
  requestedSandbox?: Record<string, unknown>;
  effectiveSandbox?: Record<string, unknown>;
  networkPolicy?: string;
  packageInstallPolicy?: string;
}
