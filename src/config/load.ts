import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { normalizeConfig } from "./normalize.js";
import { configSchema, type AppConfig } from "./schema.js";

const configPaths = (): string[] => [
  path.join(homedir(), ".config", "any-subagents", "config.toml"),
  path.join(process.cwd(), "any-subagents.toml")
];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Deep-merge raw config objects: nested objects (concurrency, export, profiles)
 * merge recursively; scalars and arrays from `overrides` replace the base.
 * Operates on raw (pre-schema) values so schema defaults never clobber an
 * earlier layer's explicit values.
 */
const deepMerge = (base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const existing = result[key];
    result[key] = isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }
  return result;
};

export const loadConfig = async (explicitPath?: string): Promise<AppConfig> => {
  const candidates = explicitPath ? [explicitPath] : configPaths();
  let merged: Record<string, unknown> = {};
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf8");
      const parsed = parseToml(raw) as Record<string, unknown>;
      merged = deepMerge(merged, parsed);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw error;
    }
  }
  return normalizeConfig(configSchema.parse(merged));
};

export const mergeConfig = (base: AppConfig, overrides: Partial<AppConfig>): AppConfig =>
  normalizeConfig(
    configSchema.parse(deepMerge(base as Record<string, unknown>, overrides as Record<string, unknown>))
  );
