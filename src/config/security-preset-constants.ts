export const securityPresets = ["strict", "default", "permissive"] as const;
export type SecurityPreset = (typeof securityPresets)[number];
