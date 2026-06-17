import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RuntimePaths } from "../storage/paths.js";

export const createTestRuntimePaths = async (): Promise<RuntimePaths> => {
  const root = await mkdtemp(path.join(os.tmpdir(), "any-subagents-runtime-"));
  const paths = {
    root,
    stateDir: path.join(root, "state"),
    dbPath: path.join(root, "state", "state.sqlite3"),
    logsDir: path.join(root, "logs"),
    artifactsDir: path.join(root, "artifacts"),
    worktreeRoot: path.join(root, "worktrees"),
    runtimeDir: path.join(root, "run")
  };

  await Promise.all([
    mkdir(paths.stateDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.artifactsDir, { recursive: true }),
    mkdir(paths.worktreeRoot, { recursive: true }),
    mkdir(paths.runtimeDir, { recursive: true })
  ]);

  return paths;
};
