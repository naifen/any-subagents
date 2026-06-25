import { mergeConfig } from "../config/load.js";
import { defaultConfig, type AppConfig } from "../config/schema.js";

export const minimalTestConfig = (overrides: Partial<AppConfig> = {}): AppConfig =>
  mergeConfig(defaultConfig(), {
    capacity_preemption_policy: "stop_starting",
    ...overrides
  });
