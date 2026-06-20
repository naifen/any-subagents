import { configSchema, type AppConfig } from "./schema.js";

const defaultGlobalConcurrency = 4;
const defaultCapacityPreemptionPolicy = "stop_starting" as const;

/** Canonical global concurrency after normalization. */
export const globalConcurrency = (config: AppConfig): number =>
  config.concurrency?.global ?? defaultGlobalConcurrency;

/**
 * Normalize loaded config to a single concurrency model and drop deprecated aliases.
 * `max_concurrency` is folded into `concurrency.global`.
 * `budget_exhaustion_policy` is folded into `capacity_preemption_policy`.
 *
 * The canonical default for `capacity_preemption_policy` is applied here rather than
 * in the schema so the deprecated alias is not masked by a schema-level default.
 */
export const normalizeConfig = (config: AppConfig): AppConfig => {
  const legacyGlobal = config.max_concurrency;
  const global = config.concurrency?.global ?? legacyGlobal ?? defaultGlobalConcurrency;
  const { max_concurrency: _legacy, budget_exhaustion_policy, ...rest } = config;
  const capacityPreemptionPolicy =
    rest.capacity_preemption_policy ?? budget_exhaustion_policy ?? defaultCapacityPreemptionPolicy;
  const securityPreset = rest.security_preset ?? "default";
  return configSchema.parse({
    ...rest,
    security_preset: securityPreset,
    capacity_preemption_policy: capacityPreemptionPolicy,
    concurrency: { ...config.concurrency, global }
  });
};
