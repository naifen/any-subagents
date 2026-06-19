import type { RuntimePaths } from "../storage/paths.js";
import { schemaVersion, type EffectiveConfig } from "../schemas/index.js";
import type { AppConfig, ProfileConfig } from "./schema.js";
import { globalConcurrency } from "./normalize.js";
import { adapterRegistry } from "../adapters/registry.js";
import type { AdapterHealthSnapshot } from "../adapters/types.js";
import type { KnownAdapter } from "../adapters/registry.js";

export const buildEffectiveConfig = (
  config: AppConfig,
  paths: RuntimePaths,
  adapterHealth: Record<KnownAdapter, AdapterHealthSnapshot>
): EffectiveConfig => {
  const globalLimit = globalConcurrency(config);
  const defaultProfiles = Object.fromEntries(adapterRegistry.map((adapter) => [adapter.name, adapter.defaultProfiles]));
  const configuredProfiles = config.profiles ?? {};
  const adapterNames = new Set([...Object.keys(defaultProfiles), ...Object.keys(configuredProfiles)]);
  const profiles = Object.fromEntries(
    [...adapterNames].map((adapter) => {
      const adapterProfiles: Record<string, ProfileConfig> = {
        ...(defaultProfiles[adapter] as Record<string, ProfileConfig> | undefined),
        ...configuredProfiles[adapter]
      };
      return [
        adapter,
        Object.fromEntries(
          Object.entries(adapterProfiles).map(([profileName, profileConfig]) => [
            profileName,
            {
              concurrency: profileConfig.concurrency ?? globalLimit,
              timeout_ms: profileConfig.timeout_ms ?? 30_000,
              ...(profileConfig.allowed_models ? { allowed_models: profileConfig.allowed_models } : {}),
              ...(profileConfig.default_model ? { default_model: profileConfig.default_model } : {})
            }
          ])
        )
      ];
    })
  );

  const adapters = Object.fromEntries(
    adapterRegistry.map((adapter) => {
      const health = adapterHealth[adapter.name];
      return [
        adapter.name,
        {
          available: health.available,
          ...(health.available && health.version ? { version: health.version } : {}),
          ...(!health.available && health.reason ? { reason: health.reason } : {}),
          supports_native_skills: adapter.capabilities.supports_native_skills,
          supports_skill_paths: adapter.capabilities.supports_skill_paths
        }
      ];
    })
  );

  return {
    schema_version: schemaVersion,
    storage: {
      state_dir: paths.stateDir,
      db_path: paths.dbPath,
      logs_dir: paths.logsDir,
      artifacts_dir: paths.artifactsDir,
      worktree_root: paths.worktreeRoot,
      runtime_dir: paths.runtimeDir
    },
    profiles,
    adapters,
    security: {
      preset: "default",
      stores_provider_secrets: false,
      path_redaction: config.path_redaction
    },
    skill_paths: config.skill_paths,
    redactions: config.redactions
  };
};
