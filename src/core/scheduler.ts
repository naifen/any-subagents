import { finalizeAttempt } from "./lifecycle.js";
import { Store, type StoredTask } from "../db/store.js";
import { TaskRunner, type RunningAttempt } from "./task-runner.js";
import { killRunningAttempt } from "./spawn-supervised.js";
import type { Session } from "../schemas/index.js";
import type { AppConfig } from "../config/schema.js";
import type { MetricsRecorder } from "./metrics-recorder.js";
import { ActiveLimitTracker, LimitPolicy } from "./limit-policy.js";
import { terminalStatuses } from "./status.js";

export interface QueuedTask {
  taskId: string;
  priority: number;
  enqueuedAt: number;
}

export interface SchedulerOptions {
  store: Store;
  runner: TaskRunner;
  config: AppConfig;
  getSession: (sessionId: string) => Session;
  running: Map<string, RunningAttempt>;
  metrics: MetricsRecorder;
}

/**
 * Manages task concurrency: maintains a priority-ordered queue (higher priority
 * first, FIFO tie-break), dispatches tasks to the TaskRunner up to configured
 * limits, and updates group status on completion.
 */
export class Scheduler {
  private readonly queue: QueuedTask[] = [];
  private readonly activeCounts = new ActiveLimitTracker();
  private readonly limitPolicy: LimitPolicy;
  private readonly taskRuns = new Set<Promise<void>>();
  private readonly running: Map<string, RunningAttempt>;

  private closed = false;

  constructor(private readonly options: SchedulerOptions) {
    this.running = options.running;
    this.limitPolicy = new LimitPolicy(options.config, this.activeCounts, options.getSession);
  }

  enqueue(taskIds: string[]): void {
    const now = Date.now();
    for (const taskId of taskIds) {
      const task = this.options.store.getTask(taskId);
      if (!task) continue;
      this.queue.push({
        taskId,
        priority: task.envelope.priority ?? 0,
        enqueuedAt: now
      });
    }
    this.sortQueue();
    this.schedule();
  }

  removeQueued(taskId: string): void {
    const index = this.queue.findIndex((entry) => entry.taskId === taskId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  cancelTask(taskId: string, options: { error?: string } = {}): boolean {
    const task = this.options.store.getTask(taskId);
    if (!task || terminalStatuses.has(task.status)) return false;

    this.removeQueued(taskId);
    const running = this.running.get(taskId);
    if (running) {
      killRunningAttempt(this.running, taskId);
    }
    const attemptId =
      running?.attempt_id ??
      (task.status === "running" ? this.options.store.getLatestAttemptForTask(taskId)?.attempt_id : undefined);
    finalizeAttempt(this.options.store, {
      attemptId,
      taskId,
      groupId: task.group_id,
      status: "cancelled",
      error: options.error ?? "Task cancelled"
    });
    return true;
  }

  cancelTasks(taskIds: string[], options: { error?: string } = {}): string[] {
    const cancelled: string[] = [];
    for (const taskId of taskIds) {
      if (this.cancelTask(taskId, options)) cancelled.push(taskId);
    }
    return cancelled;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const attempt of this.running.values()) {
      attempt.cancelled = true;
      attempt.child.kill("SIGTERM");
    }
    await Promise.allSettled(Array.from(this.taskRuns));
  }

  private sortQueue(): void {
    this.queue.sort((left, right) => right.priority - left.priority || left.enqueuedAt - right.enqueuedAt);
  }

  private schedule(): void {
    if (this.closed) return;

    while (this.queue.length > 0) {
      const nextIndex = this.queue.findIndex((entry) => {
        const task = this.options.store.getTask(entry.taskId);
        return task ? this.limitPolicy.canStart(task) : false;
      });
      if (nextIndex < 0) {
        if (this.tryCancelRunningForCapacity()) break;
        break;
      }
      const [entry] = this.queue.splice(nextIndex, 1);
      if (!entry) continue;
      const task = this.options.store.getTask(entry.taskId);
      if (!task || task.status !== "queued") continue;
      this.startTask(task, entry.enqueuedAt);
    }
  }

  private tryCancelRunningForCapacity(): boolean {
    if (this.options.config.capacity_preemption_policy !== "cancel_running") return false;
    if (this.queue.length === 0 || this.activeCounts.size() === 0) return false;
    const next = this.queue[0];
    if (!next) return false;
    const queuedTask = this.options.store.getTask(next.taskId);
    if (!queuedTask) return false;

    // Only preempt a strictly lower-priority running task; never evict equal or
    // higher priority work for a queued task.
    const queuedPriority = queuedTask.envelope.priority ?? 0;
    const victimId = this.activeCounts.lowestPriorityTaskId(
      (snapshot) => snapshot.priority < queuedPriority && this.limitPolicy.shouldEvictFor(queuedTask, snapshot)
    );

    if (!victimId) return false;
    return this.cancelTask(victimId, { error: "Preempted for higher-priority queued task" });
  }

  private startTask(task: StoredTask, queuedAt: number): void {
    const session = this.options.getSession(task.session_id);
    this.activeCounts.add(task, session);
    const run = this.runTask(task, queuedAt)
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
        this.activeCounts.remove(task.task_id);
        this.taskRuns.delete(run);
        this.schedule();
      });
    this.taskRuns.add(run);
  }

  private async runTask(task: StoredTask, queuedAt: number): Promise<void> {
    const waitMs = Date.now() - queuedAt;
    this.options.metrics.record("queue_wait_ms", waitMs, {
      task_id: task.task_id,
      group_id: task.group_id,
      session_id: task.session_id
    });
    const startedAt = Date.now();
    const session = this.options.getSession(task.session_id);
    await this.options.runner.run(task, session);
    this.options.metrics.record("task_duration_ms", Date.now() - startedAt, {
      task_id: task.task_id,
      group_id: task.group_id,
      session_id: task.session_id,
      adapter: task.adapter
    });
  }
}
