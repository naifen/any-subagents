import type { StoredArtifact, StoredAttempt } from "../db/store.js";
import type { MergeAttemptsResult } from "./merge-attempts.js";

/** Path redaction for result reads. Audience is fixed at ControlPlane construction (MCP=public, CLI/daemon=internal). */

export type ResultAudience = "internal" | "public";
export type MergeTasksResult = MergeAttemptsResult;

const stripAttemptPaths = (attempt: StoredAttempt): StoredAttempt => {
  const { worktree_path: _worktree, log_path: _log, result_path: _result, ...publicAttempt } = attempt;
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
  attempt: (attempt: StoredAttempt, audience: ResultAudience): StoredAttempt =>
    audience === "public" ? stripAttemptPaths(attempt) : attempt,
  artifact: (artifact: StoredArtifact, audience: ResultAudience): StoredArtifact =>
    audience === "public" ? stripArtifactPath(artifact) : artifact
};
