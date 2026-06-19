import type { StoredArtifact, StoredAttempt } from "../db/store.js";
import type { MergeAttemptsResult } from "./merge-attempts.js";
import type { TaskAttempt } from "../domain/attempt.js";
import { taskAttemptFromStored, taskAttemptToStored } from "../domain/mappers.js";

export type ResultAudience = "internal" | "public";
export type MergeTasksResult = MergeAttemptsResult;

const stripAttemptPaths = (attempt: TaskAttempt): TaskAttempt => {
  const { worktreePath: _worktree, logPath: _log, resultPath: _result, ...publicAttempt } = attempt;
  return publicAttempt;
};

const stripArtifactPath = (artifact: StoredArtifact): StoredArtifact => {
  const { path: _path, ...publicArtifact } = artifact;
  return publicArtifact;
};

export type PublicMergeResult = Omit<MergeTasksResult, "integration_worktree_path"> & {
  integration_worktree_uri: string;
};

export const toPublicMergeResult = (result: MergeTasksResult): PublicMergeResult => {
  const { integration_worktree_path: _path, ...publicMerge } = result;
  return {
    ...publicMerge,
    integration_worktree_uri: `any-subagents://sessions/${result.session_id}/integration-worktrees/latest`
  };
};

export const forAudience = {
  attempt: (attempt: StoredAttempt, audience: ResultAudience): StoredAttempt => {
    const domainAttempt = taskAttemptFromStored(attempt);
    const viewed = audience === "public" ? stripAttemptPaths(domainAttempt) : domainAttempt;
    return taskAttemptToStored(viewed);
  },
  artifact: (artifact: StoredArtifact, audience: ResultAudience): StoredArtifact =>
    audience === "public" ? stripArtifactPath(artifact) : artifact
};
