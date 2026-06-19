export interface AdapterCapabilities {
  supports_model_selection: boolean;
  supports_native_skills: boolean;
  supports_skill_paths: boolean;
  supports_reasoning_levels: boolean;
}

export interface AdapterDefinition {
  name: string;
  capabilities: AdapterCapabilities;
  defaultProfiles: Record<string, Record<string, never>>;
}

export const adapterRegistry: AdapterDefinition[] = [
  {
    name: "fake",
    capabilities: {
      supports_model_selection: false,
      supports_native_skills: false,
      supports_skill_paths: false,
      supports_reasoning_levels: false
    },
    defaultProfiles: { default: {} }
  },
  {
    name: "codex",
    capabilities: {
      supports_model_selection: true,
      supports_native_skills: true,
      supports_skill_paths: true,
      supports_reasoning_levels: true
    },
    defaultProfiles: { default: {} }
  }
];

export const knownAdapters = ["fake", "codex"] as const;
export type KnownAdapter = (typeof knownAdapters)[number];

export const isKnownAdapter = (adapter: string): adapter is KnownAdapter =>
  (knownAdapters as readonly string[]).includes(adapter);

export const adapterDefinitions = (): Map<string, AdapterDefinition> =>
  new Map(adapterRegistry.map((adapter) => [adapter.name, adapter]));

export const defaultProfileMap = (): Record<string, Record<string, Record<string, never>>> =>
  Object.fromEntries(adapterRegistry.map((adapter) => [adapter.name, adapter.defaultProfiles]));
