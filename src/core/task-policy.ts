import { createHash } from "node:crypto";
import type { AppConfig, ProfileConfig } from "../config/schema.js";
import type { TaskEnvelope } from "../schemas/index.js";
import type { StoredTask } from "../db/store.js";
import { TaskPolicyError } from "./errors.js";

export { TaskPolicyError };

export interface TaskPolicyEvent {
  type: string;
  severity: "debug" | "info" | "warning" | "error";
  message: string;
  data?: Record<string, unknown>;
}

export interface TaskInputFields {
  model?: string;
  reasoning_level?: TaskEnvelope["reasoning_level"];
  allow_fallback?: boolean;
}

export interface ResolvedTaskPolicy {
  effectiveModel?: string;
  effectiveReasoning?: TaskEnvelope["reasoning_level"];
  effectivePermissions?: Record<string, unknown>;
  effectiveSandbox?: Record<string, unknown>;
  networkPolicy?: string;
  packageInstallPolicy?: string;
  events: TaskPolicyEvent[];
}

export interface ResolvedTaskFields {
  effectiveModel?: string;
  effectiveReasoning?: TaskEnvelope["reasoning_level"];
  events: TaskPolicyEvent[];
}

export const resolveProfile = (config: AppConfig, adapter: string, profile: string): ProfileConfig => {
  const adapterProfiles = config.profiles?.[adapter];
  return adapterProfiles?.[profile] ?? {};
};

const asReasoningLevel = (value: string | undefined): TaskEnvelope["reasoning_level"] | undefined => {
  const levels: TaskEnvelope["reasoning_level"][] = ["minimal", "low", "medium", "high", "xhigh", "max"];
  return value && levels.includes(value as TaskEnvelope["reasoning_level"])
    ? (value as TaskEnvelope["reasoning_level"])
    : undefined;
};

const getAllowlistViolation = (
  requested: string | undefined,
  allowlist: string[] | undefined
): { requested: string; allowlist: string[] } | undefined => {
  if (requested && allowlist && allowlist.length > 0 && !allowlist.includes(requested)) {
    return { requested, allowlist };
  }
  return undefined;
};

const assertAllowlistMatchOrFallback = (
  field: TaskPolicyError["field"],
  requested: string,
  allowlist: string[],
  allowFallback: boolean | undefined
): void => {
  if (allowFallback !== true) {
    throw new TaskPolicyError(field, requested, allowlist);
  }
};

export const resolveTaskFields = (taskInput: TaskInputFields, profile: ProfileConfig): ResolvedTaskFields => {
  const events: TaskPolicyEvent[] = [];
  let effectiveModel = taskInput.model ?? profile.default_model;
  let effectiveReasoning = taskInput.reasoning_level ?? asReasoningLevel(profile.default_reasoning_level);

  const modelViolation = getAllowlistViolation(taskInput.model, profile.allowed_models);
  if (modelViolation) {
    const { requested, allowlist } = modelViolation;
    assertAllowlistMatchOrFallback("model", requested, allowlist, taskInput.allow_fallback);
    events.push({
      type: "task.model_fallback",
      severity: "warning",
      message: `Requested model ${requested} not in allowlist; using profile default`,
      data: {
        requested_model: requested,
        allowed_models: allowlist,
        fallback_model: profile.default_model
      }
    });
    effectiveModel = profile.default_model ?? effectiveModel;
  }

  const reasoningViolation = getAllowlistViolation(taskInput.reasoning_level, profile.allowed_reasoning_levels);
  if (reasoningViolation) {
    const { requested, allowlist } = reasoningViolation;
    assertAllowlistMatchOrFallback("reasoning_level", requested, allowlist, taskInput.allow_fallback);
    events.push({
      type: "task.reasoning_fallback",
      severity: "warning",
      message: `Requested reasoning level ${requested} not in allowlist`,
      data: {
        requested_reasoning_level: requested,
        allowed_reasoning_levels: allowlist,
        fallback_reasoning_level: profile.default_reasoning_level
      }
    });
    effectiveReasoning = asReasoningLevel(profile.default_reasoning_level) ?? effectiveReasoning;
  }

  return {
    ...(effectiveModel ? { effectiveModel } : {}),
    ...(effectiveReasoning ? { effectiveReasoning } : {}),
    events
  };
};

export const resolveProfilePolicy = (taskInput: TaskInputFields, profile: ProfileConfig): ResolvedTaskPolicy => {
  const resolved = resolveTaskFields(taskInput, profile);
  return {
    ...resolved,
    ...(profile.permissions ? { effectivePermissions: profile.permissions } : {}),
    ...(profile.sandbox ? { effectiveSandbox: profile.sandbox } : {}),
    ...(profile.network_policy ? { networkPolicy: profile.network_policy } : {}),
    ...(profile.package_install_policy ? { packageInstallPolicy: profile.package_install_policy } : {})
  };
};

export const resolveTaskProfilePolicy = (
  config: AppConfig,
  task: Pick<StoredTask, "adapter" | "profile" | "envelope">
): ResolvedTaskPolicy => {
  const taskInput: TaskInputFields = {};
  const model = task.envelope.requested_model ?? task.envelope.model;
  if (model !== undefined) taskInput.model = model;
  const reasoning = task.envelope.requested_reasoning_level ?? task.envelope.reasoning_level;
  if (reasoning !== undefined) taskInput.reasoning_level = reasoning;
  if (task.envelope.allow_fallback !== undefined) taskInput.allow_fallback = task.envelope.allow_fallback;
  return resolveProfilePolicy(taskInput, resolveProfile(config, task.adapter, task.profile));
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
};

export const taskFingerprint = (task: TaskEnvelope): string => {
  const { task_id: _taskId, group_id: _groupId, ...rest } = task;
  return createHash("sha256").update(canonicalJson(rest)).digest("hex");
};

export const findDuplicateTasks = (tasks: TaskEnvelope[]): string[] => {
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  for (const task of tasks) {
    const key = taskFingerprint(task);
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 2) duplicates.push(key);
  }
  return duplicates;
};
