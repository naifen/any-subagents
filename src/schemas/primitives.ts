import * as z from "zod";

export const taskModeSchema = z.enum(["research", "plan", "diagnose", "write", "review", "verify"]);
export const reasoningLevelSchema = z.enum(["minimal", "low", "medium", "high", "xhigh", "max"]);

export const sessionBriefSchema = z
  .object({
    goal: z.string().default(""),
    constraints: z.array(z.string()).default([]),
    decisions: z.array(z.string()).default([]),
    accepted_findings: z.array(z.string()).default([]),
    rejected_paths: z.array(z.string()).default([]),
    open_questions: z.array(z.string()).default([])
  })
  .strict();

export const taskScopeSchema = z
  .object({
    paths: z.array(z.string().min(1)).min(1),
    notes: z.string().optional()
  })
  .strict();

export const verificationCommandSchema = z
  .object({
    command: z.string().min(1),
    timeout_ms: z.number().int().positive().optional()
  })
  .strict();
