import * as z from "zod";

export const profileSchema = z
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

export type ProfileConfig = z.infer<typeof profileSchema>;
