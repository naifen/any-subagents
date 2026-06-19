import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimePaths } from "../storage/paths.js";
import { schemaVersion, type Session } from "../schemas/index.js";
import type { AppConfig } from "../config/schema.js";
import type { Store, StoredArtifact, StoredAttempt, StoredTask } from "../db/store.js";
import { newArtifactId } from "../util/id.js";
import { nowIso } from "../util/time.js";
import { createPatch } from "./git.js";
import { readLogPreview } from "./log-preview.js";

export const createAttemptArtifact = async (input: {
  session: Session;
  task: StoredTask;
  attempt: StoredAttempt;
  type: StoredArtifact["type"];
  mime_type: string;
  summary: string;
  localPath: string;
  preview?: string;
}): Promise<StoredArtifact> => {
  const artifactId = newArtifactId();
  const size = await stat(input.localPath);
  const hash = createHash("sha256").update(await readFile(input.localPath)).digest("hex");
  return {
    schema_version: schemaVersion,
    artifact_id: artifactId,
    scope: {
      session_id: input.session.session_id,
      group_id: input.task.group_id,
      task_id: input.task.task_id,
      attempt_id: input.attempt.attempt_id
    },
    type: input.type,
    mime_type: input.mime_type,
    summary: input.summary,
    created_at: nowIso(),
    resource_uri: `any-subagents://sessions/${input.session.session_id}/tasks/${input.task.task_id}/artifacts/${artifactId}`,
    size_bytes: size.size,
    hash,
    preview: input.preview,
    path: input.localPath
  };
};

export const registerAttemptEvidence = async (input: {
  store: Store;
  config: AppConfig;
  paths: RuntimePaths;
  session: Session;
  task: StoredTask;
  attempt: StoredAttempt;
  worktreePath: string;
  logPath: string;
}): Promise<void> => {
  const logPreview = (await readLogPreview(input.logPath, input.config, 4_096, input.paths)).preview;
  const logArtifact = await createAttemptArtifact({
    session: input.session,
    task: input.task,
    attempt: input.attempt,
    type: "log",
    mime_type: "text/plain",
    summary: "Captured stdout/stderr for the task attempt.",
    localPath: input.logPath,
    preview: logPreview
  });
  input.store.insertArtifact(logArtifact);

  if (input.task.mode !== "write") return;

  const patch = await createPatch(input.worktreePath);
  if (patch.trim().length === 0) return;

  const patchPath = path.join(input.paths.artifactsDir, input.session.session_id, input.task.task_id, `${input.attempt.attempt_id}.patch`);
  await mkdir(path.dirname(patchPath), { recursive: true });
  await writeFile(patchPath, patch);
  const patchArtifact = await createAttemptArtifact({
    session: input.session,
    task: input.task,
    attempt: input.attempt,
    type: "diff",
    mime_type: "text/x-diff",
    summary: "Patch produced by the task attempt.",
    localPath: patchPath,
    preview: patch.slice(0, 4_096)
  });
  input.store.insertArtifact(patchArtifact);
};
