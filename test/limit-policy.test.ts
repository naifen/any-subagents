import { afterEach, describe, expect, test } from "vitest";
import { LimitPolicy } from "../src/core/limit-policy.js";
import type { AppConfig } from "../src/config/schema.js";
import type { Session } from "../src/schemas/index.js";

class FakeCounts {
  private group = new Map<string, number>();
  private adapter = new Map<string, number>();
  private repo = new Map<string, number>();
  private profile = new Map<string, number>();
  private total = 0;

  setCounts(input: {
    global?: number;
    group?: Record<string, number>;
    adapter?: Record<string, number>;
    repo?: Record<string, number>;
    profile?: Record<string, number>;
  }): void {
    this.total = input.global ?? 0;
    this.group = new Map(Object.entries(input.group ?? {}));
    this.adapter = new Map(Object.entries(input.adapter ?? {}));
    this.repo = new Map(Object.entries(input.repo ?? {}));
    this.profile = new Map(Object.entries(input.profile ?? {}));
  }

  size(): number {
    return this.total;
  }

  countGroup(groupId: string): number {
    return this.group.get(groupId) ?? 0;
  }

  countAdapter(adapter: string): number {
    return this.adapter.get(adapter) ?? 0;
  }

  countRepo(repo: string): number {
    return this.repo.get(repo) ?? 0;
  }

  countProfile(adapter: string, profile: string): number {
    return this.profile.get(`${adapter}/${profile}`) ?? 0;
  }
}

const session: Session = {
  schema_version: "1",
  session_id: "sess_limit",
  repo: "/tmp/repo",
  base_ref: "HEAD",
  status: "open",
  brief: { goal: "", constraints: [], decisions: [], accepted_findings: [], rejected_paths: [], open_questions: [] },
  brief_revision: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};

const task = {
  task_id: "task_queued",
  session_id: session.session_id,
  group_id: "grp_1",
  adapter: "fake",
  profile: "default"
};

describe("LimitPolicy", () => {
  test("blocks start when profile concurrency is saturated", () => {
    const counts = new FakeCounts();
    counts.setCounts({ profile: { "fake/default": 1 } });
    const config: AppConfig = {
      schema_version: "1",
      skill_paths: [],
      skill_path_allowlist: [],
      redactions: [],
      path_redaction: false,
      skill_mount: "symlink",
      capacity_preemption_policy: "stop_starting",
      concurrency: { global: 4 },
      profiles: { fake: { default: { concurrency: 1 } } }
    };
    const policy = new LimitPolicy(config, counts, () => session);
    expect(policy.canStart(task)).toBe(false);
  });

  test("treats profile saturation as an eviction target for cancel_running", () => {
    const counts = new FakeCounts();
    counts.setCounts({ profile: { "fake/default": 1 }, global: 1 });
    const config: AppConfig = {
      schema_version: "1",
      skill_paths: [],
      skill_path_allowlist: [],
      redactions: [],
      path_redaction: false,
      skill_mount: "symlink",
      capacity_preemption_policy: "stop_starting",
      concurrency: { global: 4 },
      profiles: { fake: { default: { concurrency: 1 } } }
    };
    const policy = new LimitPolicy(config, counts, () => session);
    const snapshot = {
      taskId: "task_running",
      priority: 0,
      groupId: "grp_1",
      adapter: "fake",
      profile: "default",
      repo: session.repo
    };
    expect(policy.shouldEvictFor(task, snapshot)).toBe(true);
  });

  test("does not evict unrelated profile when a different profile is saturated", () => {
    const counts = new FakeCounts();
    counts.setCounts({ profile: { "fake/heavy": 1 } });
    const config: AppConfig = {
      schema_version: "1",
      skill_paths: [],
      skill_path_allowlist: [],
      redactions: [],
      path_redaction: false,
      skill_mount: "symlink",
      capacity_preemption_policy: "stop_starting",
      concurrency: { global: 4 },
      profiles: { fake: { heavy: { concurrency: 1 }, default: { concurrency: 1 } } }
    };
    const policy = new LimitPolicy(config, counts, () => session);
    const snapshot = {
      taskId: "task_running",
      priority: 0,
      groupId: "grp_1",
      adapter: "fake",
      profile: "heavy",
      repo: session.repo
    };
    expect(policy.shouldEvictFor({ ...task, profile: "default" }, snapshot)).toBe(false);
  });
});
