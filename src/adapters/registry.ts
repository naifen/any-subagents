import type { Adapter } from "./types.js";
import { CodexAdapter } from "./codex-adapter.js";
import { FakeAdapter } from "./fake-adapter.js";

export interface AdapterCapabilities {
  supports_model_selection: boolean;
  supports_native_skills: boolean;
  supports_skill_paths: boolean;
  supports_reasoning_levels: boolean;
}

type AdapterEntry = {
  capabilities: AdapterCapabilities;
  defaultProfiles: Record<string, Record<string, never>>;
  create: () => Adapter;
};

const adapterEntries = {
  fake: {
    capabilities: {
      supports_model_selection: false,
      supports_native_skills: false,
      supports_skill_paths: false,
      supports_reasoning_levels: false
    },
    defaultProfiles: { default: {} },
    create: () => new FakeAdapter()
  },
  codex: {
    capabilities: {
      supports_model_selection: true,
      supports_native_skills: true,
      supports_skill_paths: true,
      supports_reasoning_levels: true
    },
    defaultProfiles: { default: {} },
    create: () => new CodexAdapter()
  }
} satisfies Record<string, AdapterEntry>;

export type KnownAdapter = keyof typeof adapterEntries;
export const knownAdapters = Object.keys(adapterEntries) as KnownAdapter[];

export const isKnownAdapter = (adapter: string): adapter is KnownAdapter =>
  (knownAdapters as readonly string[]).includes(adapter);

export interface AdapterDefinition {
  name: KnownAdapter;
  capabilities: AdapterCapabilities;
  defaultProfiles: Record<string, Record<string, never>>;
}

export const adapterRegistry: AdapterDefinition[] = knownAdapters.map((name) => ({
  name,
  capabilities: adapterEntries[name].capabilities,
  defaultProfiles: adapterEntries[name].defaultProfiles
}));

export const adapterDefinitions = (): Map<KnownAdapter, AdapterDefinition> =>
  new Map(adapterRegistry.map((adapter) => [adapter.name, adapter]));

/** Returns a new adapter instance. Implementations must be stateless. */
export const getAdapter = (name: KnownAdapter): Adapter => adapterEntries[name].create();
