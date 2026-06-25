import type { RuntimePaths } from "../storage/paths.js";
import { schemaVersion, type EffectiveConfig } from "../schemas/index.js";
import type { AppConfig } from "./schema.js";
import type { ProfileConfig } from "./profile-schema.js";
import { globalConcurrency } from "./normalize.js";
import { expandSecurityPreset } from "./security-presets.js";
import { projectEffectiveProfile, resolveProfile } from "./profile-resolution.js";
import { adapterCapabilities, adapterDefaultProfiles, knownAdapters } from "../adapters/registry.js";
import type { AdapterHealthSnapshot } from "../adapters/types.js";
import type { KnownAdapter } from "../adapters/registry.js";

export const buildEffectiveConfig = (
  config: AppConfig,
  paths: RuntimePaths,
  adapterHealth: Record<KnownAdapter, AdapterHealthSnapshot>
): EffectiveConfig => {
  const globalLimit = globalConcurrency(config);
  const defaultProfiles = Object.fromEntries(knownAdapters.map((name) => [name, adapterDefaultProfiles(name)]));
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
            projectEffectiveProfile(resolveProfile(config, adapter, profileName, profileConfig), globalLimit)
          ])
        )
      ];
    })
  );

  const adapters = Object.fromEntries(
    knownAdapters.map((name) => {
      const health = adapterHealth[name];
      const capabilities = adapterCapabilities(name);
      return [
        name,
        {
          available: health.available,
          ...(health.available && health.version ? { version: health.version } : {}),
          ...(!health.available && health.reason ? { reason: health.reason } : {}),
          supports_native_skills: capabilities.supports_native_skills,
          supports_skill_paths: capabilities.supports_skill_paths
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
      preset: config.security_preset ?? "default",
      preset_expansion: expandSecurityPreset(config.security_preset ?? "default"),
      stores_provider_secrets: false,
      path_redaction: config.path_redaction
    },
    skill_paths: config.skill_paths,
    redactions: config.redactions
  };
};
