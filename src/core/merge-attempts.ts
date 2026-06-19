import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimePaths } from "../storage/paths.js";
import { schemaVersion } from "../schemas/index.js";
import type { Session } from "../schemas/index.js";
import type { Store, StoredArtifact } from "../db/store.js";
import type { EventInput } from "../db/store-types.js";
import { newArtifactId } from "../util/id.js";
import { nowIso } from "../util/time.js";
import { createPatch, excludeHarness, parsePorcelainChangedFiles } from "./git.js";
import { execFileResult, execRequired } from "./exec.js";
import { sanitizeRepoName } from "./worktree.js";

export interface MergeAttemptsInput {
  session: Session;
  attempt_ids: string[];
}

export interface MergeAttemptsResult {
  status: "completed" | "conflicted";
  session_id: string;
  attempt_ids: string[];
  integration_worktree_path: string;
  changed_files: string[];
  conflicts: string[];
}

export interface MergeAttemptsDeps {
  store: Store;
  paths: RuntimePaths;
}

export const mergeAttempts = async (
  input: MergeAttemptsInput,
  deps: MergeAttemptsDeps
): Promise<MergeAttemptsResult> => {
  const { session, attempt_ids } = input;
  const project = sanitizeRepoName(session.repo);
  const integrationPath = path.join(deps.paths.worktreeRoot, `${project}-integration-${Date.now()}`);
  await mkdir(deps.paths.worktreeRoot, { recursive: true });
  await execRequired("git", ["worktree", "add", "--detach", integrationPath, session.base_ref], session.repo);
  await excludeHarness(integrationPath);

  const conflicts: string[] = [];
  let conflictPatch = "";
  for (const attemptId of attempt_ids) {
    const attempt = deps.store.getAttempt(attemptId);
    if (!attempt?.worktree_path) {
      conflicts.push(`Attempt ${attemptId} has no worktree evidence`);
      continue;
    }
    const patch = await createPatch(attempt.worktree_path);
    if (patch.trim().length === 0) continue;
    const patchPath = path.join(deps.paths.artifactsDir, session.session_id, "merge", `${attemptId}.patch`);
    await mkdir(path.dirname(patchPath), { recursive: true });
    await writeFile(patchPath, patch);
    const applied = await execFileResult("git", ["apply", "--3way", patchPath], integrationPath);
    if (applied.code !== 0) {
      conflictPatch = patch;
      conflicts.push(applied.stderr || applied.stdout || `Attempt ${attemptId} did not apply cleanly`);
      break;
    }
  }

  const changed = await execFileResult("git", ["status", "--porcelain"], integrationPath);
  const changedFiles = parsePorcelainChangedFiles(changed.stdout);

  if (conflicts.length > 0) {
    await persistMergeConflict({ session, attempt_ids, conflicts, conflictPatch }, deps);
  }

  return {
    status: conflicts.length > 0 ? "conflicted" : "completed",
    session_id: session.session_id,
    attempt_ids,
    integration_worktree_path: integrationPath,
    changed_files: changedFiles,
    conflicts
  };
};

const persistMergeConflict = async (
  input: {
    session: Session;
    attempt_ids: string[];
    conflicts: string[];
    conflictPatch: string;
  },
  deps: MergeAttemptsDeps
): Promise<void> => {
  const artifactId = newArtifactId();
  const conflictPath = path.join(deps.paths.artifactsDir, input.session.session_id, "merge", `${artifactId}.conflict.patch`);
  const conflictBody = input.conflictPatch || input.conflicts.join("\n");
  await mkdir(path.dirname(conflictPath), { recursive: true });
  await writeFile(conflictPath, conflictBody);

  const artifact: StoredArtifact = {
    schema_version: schemaVersion,
    artifact_id: artifactId,
    scope: { session_id: input.session.session_id },
    type: "diff",
    mime_type: "text/x-diff",
    summary: "Merge conflict patch",
    created_at: nowIso(),
    resource_uri: `any-subagents://sessions/${input.session.session_id}/merge-conflicts/${artifactId}`,
    preview: conflictBody.slice(0, 4_096),
    path: conflictPath
  };
  deps.store.insertArtifact(artifact);
  const event: EventInput = {
    type: "merge.conflict",
    session_id: input.session.session_id,
    artifact_id: artifactId,
    severity: "error",
    message: "Merge conflict detected",
    data: { attempt_ids: input.attempt_ids, conflicts: input.conflicts }
  };
  deps.store.appendEvent(event);
};
