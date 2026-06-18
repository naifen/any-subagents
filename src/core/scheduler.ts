import { finalizeAttempt } from "./lifecycle.js";
import { Store, type StoredTask } from "../db/store.js";
import { TaskRunner, type RunningAttempt } from "./task-runner.js";
import type { Session } from "../schemas/index.js";

export interface SchedulerOptions {
  store: Store;
  runner: TaskRunner;
  maxConcurrency: number;
  getSession: (sessionId: string) => Session;
  running: Map<string, RunningAttempt>;
}

/**
 * Manages task concurrency: maintains a queue, dispatches tasks to the
 * TaskRunner up to the concurrency limit, and updates group status on
 * completion.
 */
export class Scheduler {
  private readonly queue: string[] = [];
  private readonly active = new Set<string>();
  private readonly taskRuns = new Set<Promise<void>>();
  readonly running: Map<string, RunningAttempt>;

  private closed = false;

  constructor(private readonly options: SchedulerOptions) {
    this.running = options.running;
  }

  enqueue(taskIds: string[]): void {
    this.queue.push(...taskIds);
    this.schedule();
  }

  removeQueued(taskId: string): void {
    const index = this.queue.indexOf(taskId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const attempt of this.running.values()) {
      attempt.cancelled = true;
      attempt.child.kill("SIGTERM");
    }
    await Promise.allSettled(Array.from(this.taskRuns));
  }

  private schedule(): void {
    if (this.closed) return;
    while (this.active.size < this.options.maxConcurrency && this.queue.length > 0) {
      const taskId = this.queue.shift();
      if (!taskId) continue;
      const task = this.options.store.getTask(taskId);
      if (!task || task.status !== "queued") continue;
      this.active.add(taskId);
      const run = this.runTask(task)
        .catch((error: unknown) => {
          const latest = this.options.store.getLatestAttemptForTask(task.task_id);
          const message = error instanceof Error ? error.message : String(error);
          finalizeAttempt(this.options.store, {
            attemptId: latest?.attempt_id,
            taskId: task.task_id,
            groupId: task.group_id,
            status: "failed",
            error: message
          });
        })
        .finally(() => {
          this.active.delete(taskId);
          this.taskRuns.delete(run);
          this.schedule();
        });
      this.taskRuns.add(run);
    }
  }

  private async runTask(task: StoredTask): Promise<void> {
    const session = this.options.getSession(task.session_id);
    await this.options.runner.run(task, session);
    this.schedule();
  }
}
