import type { ProfileConfig } from "./schema.js";

export type SecurityPreset = "strict" | "default" | "permissive";

export const securityPresetSchema = ["strict", "default", "permissive"] as const;

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

export const mergeProfilePreset = (preset: Partial<ProfileConfig>, explicit: ProfileConfig): ProfileConfig => {
  const { sandbox: explicitSandbox, permissions: explicitPermissions, ...explicitRest } = explicit;
  const { sandbox: presetSandbox, permissions: presetPermissions, ...presetRest } = preset;
  return {
    ...presetRest,
    ...explicitRest,
    ...(presetSandbox || explicitSandbox ? { sandbox: { ...presetSandbox, ...explicitSandbox } } : {}),
    ...(presetPermissions || explicitPermissions
      ? { permissions: { ...presetPermissions, ...explicitPermissions } }
      : {})
  };
};

export const applySecurityPresetToProfile = (
  preset: SecurityPreset,
  explicit: ProfileConfig
): ProfileConfig => mergeProfilePreset(expandSecurityPreset(preset), explicit);
