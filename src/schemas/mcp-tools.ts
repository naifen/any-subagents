import * as z from "zod";
import { definedEntries } from "../util/defined.js";
import {
  createSessionSchema,
  parseCreateSessionInput,
  parseSubmitTaskGroupInput,
  submitTaskGroupSchema,
  type CreateSessionInput,
  type SubmitTaskGroupInput
} from "./contracts.js";
import { sessionBriefSchema } from "./primitives.js";
import type { SessionBrief } from "./index.js";

export const mcpSubmitTaskGroupSchema = submitTaskGroupSchema;
export const mcpCreateSessionSchema = createSessionSchema;

export const mcpUpdateSessionBriefSchema = z
  .object({
    session_id: z.string().min(1),
    expected_brief_revision: z.number().int().nonnegative(),
    brief: sessionBriefSchema.partial()
  })
  .strict();

export const mcpCancelTasksSchema = z
  .object({
    task_ids: z.array(z.string().min(1)).optional(),
    group_id: z.string().min(1).optional(),
    session_id: z.string().min(1).optional()
  })
  .strict();

export const mcpGetMetricsSchema = z
  .object({
    name: z.string().min(1).optional(),
    session_id: z.string().min(1).optional(),
    task_id: z.string().min(1).optional(),
    limit: z.number().int().positive().optional()
  })
  .strict();

export type McpSubmitTaskGroupInput = z.infer<typeof mcpSubmitTaskGroupSchema>;
export type McpCreateSessionInput = z.infer<typeof mcpCreateSessionSchema>;

export const toCreateSessionInput = (input: McpCreateSessionInput): CreateSessionInput => {
  const session = parseCreateSessionInput(input);
  if (input.brief !== undefined) {
    session.brief = sessionBriefSchema.partial().parse(input.brief) as Partial<SessionBrief>;
  }
  return session;
};

export const toSubmitTaskGroupInput = (input: McpSubmitTaskGroupInput): SubmitTaskGroupInput => {
  const parsed = parseSubmitTaskGroupInput(input);
  return {
    ...parsed,
    tasks: parsed.tasks.map((task) => definedEntries(task) as SubmitTaskGroupInput["tasks"][number])
  };
};
