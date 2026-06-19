import type { Session } from "../schemas/index.js";
import type { AppConfig } from "../config/schema.js";
import type { StoredTask } from "../db/store.js";
import { globalConcurrency } from "../config/normalize.js";

const profileKey = (adapter: string, profile: string): string => `${adapter}/${profile}`;

export interface ActiveTaskSnapshot {
  taskId: string;
  priority: number;
  groupId: string;
  adapter: string;
  profile: string;
  repo: string;
}

export interface LimitCountReader {
  size(): number;
  countGroup(groupId: string): number;
  countAdapter(adapter: string): number;
  countRepo(repo: string): number;
  countProfile(adapter: string, profile: string): number;
}

/** Tracks active running tasks for limit accounting and eviction targeting. */
export class ActiveLimitTracker implements LimitCountReader {
  private readonly byGroup = new Map<string, number>();
  private readonly byAdapter = new Map<string, number>();
  private readonly byRepo = new Map<string, number>();
  private readonly byProfile = new Map<string, number>();
  private readonly snapshots = new Map<string, ActiveTaskSnapshot>();

  add(task: StoredTask, session: Session): void {
    const snapshot: ActiveTaskSnapshot = {
      taskId: task.task_id,
      priority: task.envelope.priority ?? 0,
      groupId: task.group_id,
      adapter: task.adapter,
      profile: task.profile,
      repo: session.repo
    };
    this.snapshots.set(task.task_id, snapshot);
    this.increment(this.byGroup, snapshot.groupId);
    this.increment(this.byAdapter, snapshot.adapter);
    this.increment(this.byRepo, snapshot.repo);
    this.increment(this.byProfile, profileKey(snapshot.adapter, snapshot.profile));
  }

  remove(taskId: string): void {
    const snapshot = this.snapshots.get(taskId);
    if (!snapshot) return;
    this.snapshots.delete(taskId);
    this.decrement(this.byGroup, snapshot.groupId);
    this.decrement(this.byAdapter, snapshot.adapter);
    this.decrement(this.byRepo, snapshot.repo);
    this.decrement(this.byProfile, profileKey(snapshot.adapter, snapshot.profile));
  }

  size(): number {
    return this.snapshots.size;
  }

  lowestPriorityTaskId(filter?: (snapshot: ActiveTaskSnapshot) => boolean): string | undefined {
    let candidate: ActiveTaskSnapshot | undefined;
    for (const snapshot of this.snapshots.values()) {
      if (filter && !filter(snapshot)) continue;
      if (!candidate || snapshot.priority < candidate.priority) {
        candidate = snapshot;
      }
    }
    return candidate?.taskId;
  }

  countGroup(groupId: string): number {
    return this.byGroup.get(groupId) ?? 0;
  }

  countAdapter(adapter: string): number {
    return this.byAdapter.get(adapter) ?? 0;
  }

  countRepo(repo: string): number {
    return this.byRepo.get(repo) ?? 0;
  }

  countProfile(adapter: string, profile: string): number {
    return this.byProfile.get(profileKey(adapter, profile)) ?? 0;
  }

  private increment(map: Map<string, number>, key: string): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  private decrement(map: Map<string, number>, key: string): void {
    const next = (map.get(key) ?? 0) - 1;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  }
}

export interface SchedulableTask {
  task_id: string;
  session_id: string;
  group_id: string;
  adapter: string;
  profile: string;
}

type LimitDimension =
  | { kind: "global" }
  | { kind: "profile"; adapter: string; profile: string }
  | { kind: "group"; groupId: string }
  | { kind: "provider"; adapter: string }
  | { kind: "repo"; repo: string };

/**
 * Single source of truth for concurrency limit checks and eviction targeting.
 * Both "can this task start?" and "which running task blocks capacity?" use the same rules.
 */
export class LimitPolicy {
  constructor(
    private readonly config: AppConfig,
    private readonly counts: LimitCountReader,
    private readonly getSession: (sessionId: string) => Session
  ) {}

  globalLimit(): number {
    return globalConcurrency(this.config);
  }

  canStart(task: SchedulableTask): boolean {
    return this.blockingDimensions(task).length === 0;
  }

  /** True when evicting `snapshot` would relieve a limit blocking `queuedTask`. */
  shouldEvictFor(queuedTask: SchedulableTask, snapshot: ActiveTaskSnapshot): boolean {
    return this.blockingDimensions(queuedTask).some((dimension) => this.snapshotMatchesDimension(snapshot, dimension));
  }

  blockingDimensions(task: SchedulableTask): LimitDimension[] {
    const session = this.getSession(task.session_id);
    const limits = this.config.concurrency;
    const dimensions: LimitDimension[] = [];

    const profileLimit = this.config.profiles?.[task.adapter]?.[task.profile]?.concurrency;
    if (profileLimit != null && this.counts.countProfile(task.adapter, task.profile) >= profileLimit) {
      dimensions.push({ kind: "profile", adapter: task.adapter, profile: task.profile });
    }
    if (limits?.group != null && this.counts.countGroup(task.group_id) >= limits.group) {
      dimensions.push({ kind: "group", groupId: task.group_id });
    }
    if (limits?.provider?.[task.adapter] != null && this.counts.countAdapter(task.adapter) >= limits.provider[task.adapter]!) {
      dimensions.push({ kind: "provider", adapter: task.adapter });
    }
    if (limits?.repo?.[session.repo] != null && this.counts.countRepo(session.repo) >= limits.repo[session.repo]!) {
      dimensions.push({ kind: "repo", repo: session.repo });
    }
    if (this.counts.size() >= this.globalLimit()) {
      dimensions.push({ kind: "global" });
    }
    return dimensions;
  }

  private snapshotMatchesDimension(snapshot: ActiveTaskSnapshot, dimension: LimitDimension): boolean {
    switch (dimension.kind) {
      case "global":
        return true;
      case "profile":
        return snapshot.adapter === dimension.adapter && snapshot.profile === dimension.profile;
      case "group":
        return snapshot.groupId === dimension.groupId;
      case "provider":
        return snapshot.adapter === dimension.adapter;
      case "repo":
        return snapshot.repo === dimension.repo;
      default: {
        const unhandled: never = dimension;
        throw new Error(`Unhandled limit dimension: ${String(unhandled)}`);
      }
    }
  }
}
