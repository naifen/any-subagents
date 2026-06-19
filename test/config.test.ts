import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadConfig, mergeConfig } from "../src/config/load.js";
import { defaultConfig } from "../src/config/schema.js";
import { globalConcurrency } from "../src/config/normalize.js";

let tempDir: string;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("config", () => {
  test("returns defaults when no config file exists", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "config-test-"));
    const config = await loadConfig(path.join(tempDir, "missing.toml"));
    expect(config.skill_paths).toEqual([]);
    expect(config.path_redaction).toBe(false);
  });

  test("loads TOML config from an explicit path", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "config-toml-"));
    const configPath = path.join(tempDir, "any-subagents.toml");
    await writeFile(
      configPath,
      `
skill_paths = ["/skills/demo"]
path_redaction = true
redactions = ["custom-secret"]

[concurrency]
global = 2
`
    );
    const config = await loadConfig(configPath);
    expect(config.skill_paths).toEqual(["/skills/demo"]);
    expect(config.path_redaction).toBe(true);
    expect(config.concurrency?.global).toBe(2);
  });

  test("mergeConfig overlays overrides onto defaults", () => {
    const merged = mergeConfig(defaultConfig(), { max_concurrency: 8 });
    expect(globalConcurrency(merged)).toBe(8);
    expect(merged.skill_paths).toEqual([]);
  });

  test("mergeConfig deeply merges nested concurrency fields", () => {
    const merged = mergeConfig(
      mergeConfig(defaultConfig(), {
        path_redaction: true,
        concurrency: { global: 2, group: 1 }
      }),
      {
        skill_paths: ["/skills/demo"],
        concurrency: { global: 3 }
      }
    );
    expect(merged.path_redaction).toBe(true);
    expect(merged.skill_paths).toEqual(["/skills/demo"]);
    expect(merged.concurrency?.global).toBe(3);
    expect(merged.concurrency?.group).toBe(1);
  });
});
