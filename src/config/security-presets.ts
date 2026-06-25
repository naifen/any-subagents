import type { ProfileConfig } from "./profile-schema.js";
import { type SecurityPreset } from "./security-preset-constants.js";

export type { SecurityPreset } from "./security-preset-constants.js";

export const expandSecurityPreset = (preset: SecurityPreset): Partial<ProfileConfig> => {
  switch (preset) {
    case "strict":
      return {
        network_policy: "deny",
        package_install_policy: "deny",
        permissions: { write: false, network: false },
        sandbox: { mode: "strict" }
      };
    case "default":
      return {
        network_policy: "restricted",
        package_install_policy: "ask",
        sandbox: { mode: "restricted" }
      };
    case "permissive":
      return {
        network_policy: "allow",
        package_install_policy: "allow",
        permissions: { write: true, network: true },
        sandbox: { mode: "workspace-write" }
      };
    default: {
      const _exhaustive: never = preset;
      return _exhaustive;
    }
  }
};

const mergeProfilePreset = (preset: Partial<ProfileConfig>, explicit: ProfileConfig): ProfileConfig => {
  const { sandbox: explicitSandbox, permissions: explicitPermissions, ...explicitRest } = explicit;
  const { sandbox: presetSandbox, permissions: presetPermissions, ...presetRest } = preset;
  // ponytail: use strict undefined checks rather than truthy checks to handle empty objects safely
  return {
    ...presetRest,
    ...explicitRest,
    ...(presetSandbox !== undefined || explicitSandbox !== undefined
      ? { sandbox: { ...presetSandbox, ...explicitSandbox } }
      : {}),
    ...(presetPermissions !== undefined || explicitPermissions !== undefined
      ? { permissions: { ...presetPermissions, ...explicitPermissions } }
      : {})
  };
};

export const applySecurityPresetToProfile = (
  preset: SecurityPreset,
  explicit: ProfileConfig
): ProfileConfig => mergeProfilePreset(expandSecurityPreset(preset), explicit);
