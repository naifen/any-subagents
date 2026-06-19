import * as z from "zod";
import {
  reasoningLevelSchema,
  sessionBriefSchema,
  taskModeSchema,
  taskScopeSchema,
  verificationCommandSchema
} from "./primitives.js";

export const submitTaskInputSchema = z
  .object({
    mode: taskModeSchema,
    goal: z.string().min(1),
    adapter: z.string().min(1),
    profile: z.string().min(1),
    success_criteria: z.array(z.string().min(1)).min(1),
    scope: taskScopeSchema.optional(),
    constraints: z.array(z.string()).optional(),
    verification_commands: z.array(z.union([z.string().min(1), verificationCommandSchema])).optional(),
    timeout_ms: z.number().int().positive().optional(),
    priority: z.number().int().optional(),
    model: z.string().min(1).optional(),
    reasoning_level: reasoningLevelSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export const submitTaskGroupSchema = z
  .object({
    session_id: z.string().min(1),
    title: z.string().min(1),
    expected_brief_revision: z.number().int().nonnegative(),
    ignore_revision_conflict: z.boolean().optional(),
    priority: z.number().int().optional(),
    tasks: z.array(submitTaskInputSchema).min(1)
  })
  .strict();

export const createSessionSchema = z
  .object({
    repo: z.string().min(1),
    base_ref: z.string().min(1),
    brief: sessionBriefSchema.partial().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    priority: z.number().int().optional()
  })
  .strict();

export type SubmitTaskGroupInput = z.infer<typeof submitTaskGroupSchema>;
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const parseSubmitTaskGroupInput = (input: unknown): SubmitTaskGroupInput => submitTaskGroupSchema.parse(input);
export const parseCreateSessionInput = (input: unknown): CreateSessionInput => createSessionSchema.parse(input);
