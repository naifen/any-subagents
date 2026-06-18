import os from "node:os";
import path from "node:path";

export interface RuntimePaths {
  root: string;
  stateDir: string;
  dbPath: string;
  logsDir: string;
  artifactsDir: string;
  worktreeRoot: string;
  runtimeDir: string;
}

export const defaultRuntimePaths = (): RuntimePaths => {
  const home = os.homedir();
  const platform = process.platform;
  const root =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support", "any-subagents")
      : path.join(process.env["XDG_STATE_HOME"] ?? path.join(home, ".local", "state"), "any-subagents");
  const logsDir =
    platform === "darwin"
      ? path.join(home, "Library", "Logs", "any-subagents")
      : path.join(process.env["XDG_STATE_HOME"] ?? path.join(home, ".local", "state"), "any-subagents", "logs");
  const runtimeDir =
    platform === "darwin"
      ? path.join(os.tmpdir(), "any-subagents-run")
      : path.join(process.env["XDG_RUNTIME_DIR"] ?? os.tmpdir(), "any-subagents");

  return {
    root,
    stateDir: root,
    dbPath: path.join(root, "state.sqlite3"),
    logsDir,
    artifactsDir: path.join(root, "artifacts"),
    worktreeRoot: path.join(home, "Repos", "worktrees"),
    runtimeDir
  };
};
