import type { AppConfig } from "./schema.js";
import type { ProfileConfig } from "./profile-schema.js";
import { applySecurityPresetToProfile } from "./security-presets.js";

export type EffectiveProfileProjection = Partial<ProfileConfig> & {
  concurrency: number;
  timeout_ms: number;
};

export const resolveProfile = (
  config: AppConfig,
  adapter: string,
  profile: string,
  explicitProfile?: ProfileConfig
): ProfileConfig =>
  applySecurityPresetToProfile(
    config.security_preset ?? "default",
    explicitProfile ?? config.profiles?.[adapter]?.[profile] ?? {}
  );

export const projectEffectiveProfile = (
  resolved: ProfileConfig,
  globalLimit: number
): EffectiveProfileProjection => ({
  concurrency: resolved.concurrency ?? globalLimit,
  timeout_ms: resolved.timeout_ms ?? 30_000,
  ...(resolved.allowed_models ? { allowed_models: resolved.allowed_models } : {}),
  ...(resolved.allowed_reasoning_levels ? { allowed_reasoning_levels: resolved.allowed_reasoning_levels } : {}),
  ...(resolved.default_model ? { default_model: resolved.default_model } : {}),
  ...(resolved.default_reasoning_level ? { default_reasoning_level: resolved.default_reasoning_level } : {}),
  ...(resolved.network_policy ? { network_policy: resolved.network_policy } : {}),
  ...(resolved.package_install_policy ? { package_install_policy: resolved.package_install_policy } : {}),
  ...(resolved.sandbox ? { sandbox: resolved.sandbox } : {}),
  ...(resolved.permissions ? { permissions: resolved.permissions } : {})
});
