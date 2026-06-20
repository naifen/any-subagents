import type { AppConfig, ProfileConfig } from "./schema.js";
import { applySecurityPresetToProfile } from "./security-presets.js";

export const resolveProfile = (config: AppConfig, adapter: string, profile: string): ProfileConfig =>
  applySecurityPresetToProfile(config.security_preset ?? "default", config.profiles?.[adapter]?.[profile] ?? {});
