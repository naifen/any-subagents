import { describe, expect, test } from "vitest";
import { buildEffectiveConfig } from "../src/config/effective-config.js";
import { normalizeConfig } from "../src/config/normalize.js";
import { defaultConfig, configSchema } from "../src/config/schema.js";
import {
  applySecurityPresetToProfile,
  expandSecurityPreset
} from "../src/config/security-presets.js";
import { resolveProfile } from "../src/core/task-policy.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";

describe("security presets", () => {
  test("strict preset expands to deny network and package install with strict sandbox", () => {
    expect(expandSecurityPreset("strict")).toEqual({
      network_policy: "deny",
      package_install_policy: "deny",
      permissions: { write: false, network: false },
      sandbox: { mode: "strict" }
    });
  });

  test("default preset expands without permissions overlay", () => {
    expect(expandSecurityPreset("default")).toEqual({
      network_policy: "restricted",
      package_install_policy: "ask",
      sandbox: { mode: "restricted" }
    });
  });

  test("permissive preset expands to allow network and package install", () => {
    expect(expandSecurityPreset("permissive")).toEqual({
      network_policy: "allow",
      package_install_policy: "allow",
      permissions: { write: true, network: true },
      sandbox: { mode: "workspace-write" }
    });
  });

  test("explicit profile network_policy overrides strict preset", () => {
    const merged = applySecurityPresetToProfile("strict", { network_policy: "allow" });
    expect(merged.network_policy).toBe("allow");
    expect(merged.package_install_policy).toBe("deny");
  });

  test("resolveProfile applies preset under explicit profile keys", () => {
    const config = normalizeConfig(
      configSchema.parse({
        security_preset: "strict",
        profiles: {
          fake: {
            default: { network_policy: "allow", concurrency: 2 }
          }
        }
      })
    );
    expect(resolveProfile(config, "fake", "default")).toMatchObject({
      network_policy: "allow",
      package_install_policy: "deny",
      concurrency: 2,
      sandbox: { mode: "strict" }
    });
  });

  test("unknown preset string fails config validation at load", () => {
    expect(() =>
      configSchema.parse({
        security_preset: "ultra-secure"
      })
    ).toThrow();
  });

  test("buildEffectiveConfig includes preset and preset_expansion", async () => {
    const paths = await createTestRuntimePaths();
    const config = normalizeConfig(configSchema.parse({ security_preset: "strict" }));
    const effective = buildEffectiveConfig(config, paths, {
      fake: { available: true },
      codex: { available: false, reason: "test" }
    });
    expect(effective.security).toMatchObject({
      preset: "strict",
      preset_expansion: expandSecurityPreset("strict"),
      stores_provider_secrets: false
    });
  });

  test("resolveProfile applies preset when profile is not configured", () => {
    const config = normalizeConfig(defaultConfig());
    expect(resolveProfile(config, "fake", "default").network_policy).toBe("restricted");
  });
});
