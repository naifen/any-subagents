import * as z from "zod";

const limitSchema = z
  .object({
    global: z.number().int().positive().optional(),
    provider: z.record(z.string(), z.number().int().positive()).optional(),
    repo: z.record(z.string(), z.number().int().positive()).optional(),
    group: z.number().int().positive().optional()
  })
  .strict();

const profileSchema = z
  .object({
    concurrency: z.number().int().positive().optional(),
    timeout_ms: z.number().int().positive().optional(),
    allowed_models: z.array(z.string()).optional(),
    allowed_reasoning_levels: z.array(z.string()).optional(),
    default_model: z.string().optional(),
    default_reasoning_level: z.string().optional(),
    network_policy: z.enum(["allow", "deny", "restricted"]).optional(),
    package_install_policy: z.enum(["allow", "deny", "ask"]).optional(),
    sandbox: z.record(z.string(), z.unknown()).optional(),
    permissions: z.record(z.string(), z.unknown()).optional()
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
export type ProfileConfig = z.infer<typeof profileSchema>;

export const defaultConfig = (): AppConfig => configSchema.parse({});
