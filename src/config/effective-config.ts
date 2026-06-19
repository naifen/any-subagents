import type { RuntimePaths } from "../storage/paths.js";
import { schemaVersion, type EffectiveConfig } from "../schemas/index.js";
import type { AppConfig, ProfileConfig } from "./schema.js";
import { globalConcurrency } from "./normalize.js";
import { adapterDefinitions, defaultProfileMap } from "../adapters/registry.js";
import type { CodexHealth } from "../adapters/codex.js";

const codexUnavailableMessage = "Codex CLI not available";

export const buildEffectiveConfig = (
  config: AppConfig,
  paths: RuntimePaths,
  codexHealth: CodexHealth
): EffectiveConfig => {
  const globalLimit = globalConcurrency(config);
  const defaultProfiles = defaultProfileMap();
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
    [...adapterDefinitions().values()].map((adapter) => {
      if (adapter.name === "codex") {
        return [
          adapter.name,
          {
            available: codexHealth.available,
            ...(codexHealth.available
              ? { version: codexHealth.version }
              : { reason: codexHealth.reason ?? codexUnavailableMessage }),
            supports_native_skills: adapter.capabilities.supports_native_skills,
            supports_skill_paths: adapter.capabilities.supports_skill_paths
          }
        ];
      }
      return [
        adapter.name,
        {
          available: true,
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
