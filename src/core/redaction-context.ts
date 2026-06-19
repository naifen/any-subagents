import type { AppConfig } from "../config/schema.js";
import type { RuntimePaths } from "../storage/paths.js";
import type { RedactionOptions } from "./redaction.js";

export const redactionOptionsFromConfig = (config: AppConfig, paths?: RuntimePaths): RedactionOptions => ({
  extraPatterns: config.redactions,
  pathRedaction: config.path_redaction,
  ...(paths
    ? {
        basePaths: [paths.root, paths.stateDir, paths.logsDir, paths.artifactsDir, paths.worktreeRoot, paths.runtimeDir]
      }
    : {})
});
