import * as z from "zod";

import { profileSchema } from "./profile-schema.js";
import { securityPresets } from "./security-preset-constants.js";

export { profileSchema, type ProfileConfig } from "./profile-schema.js";

const limitSchema = z
  .object({
    global: z.number().int().positive().optional(),
    provider: z.record(z.string(), z.number().int().positive()).optional(),
    repo: z.record(z.string(), z.number().int().positive()).optional(),
    group: z.number().int().positive().optional()
  })
  .strict();

export const configSchema = z
  .object({
    schema_version: z.literal("1").default("1"),
    concurrency: limitSchema.optional(),
    max_concurrency: z.number().int().positive().optional(),
    capacity_preemption_policy: z.enum(["stop_starting", "cancel_running"]).optional(),
    /** @deprecated Alias for `capacity_preemption_policy`; folded in by `normalizeConfig`. */
    budget_exhaustion_policy: z.enum(["stop_starting", "cancel_running"]).optional(),
    skill_paths: z.array(z.string()).default([]),
    skill_mount: z.enum(["symlink", "copy"]).default("symlink"),
    skill_path_allowlist: z.array(z.string()).default([]),
    redactions: z.array(z.string()).default([]),
    path_redaction: z.boolean().default(false),
    security_preset: z.enum(securityPresets).default("default"),
    profiles: z.record(z.string(), z.record(z.string(), profileSchema)).optional(),
    export: z
      .object({
        include_logs: z.boolean().default(true),
        include_artifacts: z.boolean().default(true),
        include_markdown: z.boolean().default(true)
      })
      .strict()
      .optional()
  })
  .strict();

export type AppConfig = z.infer<typeof configSchema>;

export const defaultConfig = (): AppConfig => configSchema.parse({});
