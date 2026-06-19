import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { RuntimePaths } from "../storage/paths.js";
import type { Session } from "../schemas/index.js";
import type { StoredTask } from "../db/store.js";
import { excludeHarness } from "./git.js";
import { execRequired } from "./exec.js";
import type { MetricsRecorder } from "./metrics-recorder.js";

export const sanitizeRepoName = (repoPath: string): string =>
  path.basename(repoPath).replace(/[^A-Za-z0-9._-]/g, "-") || "repo";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const retry = async <T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 100,
  onRetry?: () => void
): Promise<T> => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      onRetry?.();
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw new Error("unreachable");
};

export const createTaskWorktree = async (input: {
  session: Session;
  task: StoredTask;
  paths: RuntimePaths;
  metrics: MetricsRecorder;
}): Promise<string> => {
  await mkdir(input.paths.worktreeRoot, { recursive: true });
  const worktreePath = path.join(input.paths.worktreeRoot, `${sanitizeRepoName(input.session.repo)}-${input.task.task_id}`);
  let retries = 0;
  await retry(
    () =>
      execRequired(
        "git",
        ["worktree", "add", "--detach", worktreePath, input.task.envelope.base_ref ?? input.session.base_ref],
        input.session.repo
      ),
    3,
    100,
    () => {
      retries += 1;
      input.metrics.record("infra_retry_total", 1, {
        session_id: input.task.session_id,
        group_id: input.task.group_id,
        task_id: input.task.task_id,
        operation: "worktree_add"
      });
    }
  );
  if (retries > 0) {
    input.metrics.record("infra_retry_count", retries, {
      session_id: input.task.session_id,
      group_id: input.task.group_id,
      task_id: input.task.task_id,
      operation: "worktree_add"
    });
  }
  await excludeHarness(worktreePath);
  return worktreePath;
};
