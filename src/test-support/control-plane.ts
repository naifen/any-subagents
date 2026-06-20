import { mergeConfig } from "../config/load.js";
import { defaultConfig, type AppConfig } from "../config/schema.js";
import { createControlPlane, type ControlPlane } from "../core/control-plane.js";
import type { ResultAudience } from "../core/audience.js";
import type { RuntimePaths } from "../storage/paths.js";

export const createTestControlPlane = (
  paths: RuntimePaths,
  options: { globalConcurrency?: number; config?: Partial<AppConfig>; audience?: ResultAudience } = {}
): ControlPlane => {
  const config = mergeConfig(defaultConfig(), {
    ...(options.globalConcurrency != null ? { concurrency: { global: options.globalConcurrency } } : {}),
    ...options.config
  });
  return createControlPlane({
    paths,
    config,
    ...(options.audience ? { audience: options.audience } : {})
  });
};
