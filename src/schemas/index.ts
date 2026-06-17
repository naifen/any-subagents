import * as z from "zod";

export const schemaVersion = "1";

const metadataSchema = z.record(z.string(), z.unknown());

const isoTimestampSchema = z.iso.datetime({ offset: true });

const prefixedId = (prefix: string): z.ZodString =>
  z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9_-]+$`), `Expected ${prefix}_ prefixed ID`);

export const sessionIdSchema = prefixedId("sess");
export const taskGroupIdSchema = prefixedId("grp");
export const taskIdSchema = prefixedId("task");
export const attemptIdSchema = prefixedId("att");
export const artifactIdSchema = prefixedId("art");
export const eventIdSchema = prefixedId("evt");

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

export const sessionSchema = z
  .object({
    schema_version: z.literal(schemaVersion),
    session_id: sessionIdSchema,
    repo: z.string().min(1),
    base_ref: z.string().min(1),
    status: z.enum(["open", "closing", "closed", "cancelled"]),
    brief: sessionBriefSchema,
    brief_revision: z.number().int().nonnegative().default(0),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
    budgets: metadataSchema.optional(),
    priority: z.number().int().optional(),
    metadata: metadataSchema.optional()
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

export const taskEnvelopeSchema = z
  .object({
    schema_version: z.literal(schemaVersion),
    task_id: taskIdSchema,
    session_id: sessionIdSchema,
    group_id: taskGroupIdSchema,
    mode: taskModeSchema,
    goal: z.string().min(1),
    adapter: z.string().min(1),
    profile: z.string().min(1),
    success_criteria: z.array(z.string().min(1)).min(1),
    scope: taskScopeSchema.optional(),
    base_ref: z.string().min(1).optional(),
    model: z.string().min(1).optional(),
    reasoning_level: reasoningLevelSchema.optional(),
    reasoning_options: metadataSchema.optional(),
    allow_fallback: z.boolean().optional(),
    permissions: metadataSchema.optional(),
    sandbox: metadataSchema.optional(),
    constraints: z.array(z.string()).optional(),
    expected_output: z.string().optional(),
    verification_commands: z.array(z.union([z.string().min(1), verificationCommandSchema])).optional(),
    budgets: metadataSchema.optional(),
    timeout_ms: z.number().int().positive().optional(),
    priority: z.number().int().optional(),
    metadata: metadataSchema.optional()
  })
  .strict()
  .superRefine((task, context) => {
    if (task.mode === "write" && !task.scope) {
      context.addIssue({
        code: "custom",
        path: ["scope"],
        message: "Write tasks require explicit scope"
      });
    }
  });

export const taskGroupSchema = z
  .object({
    schema_version: z.literal(schemaVersion),
    group_id: taskGroupIdSchema,
    session_id: sessionIdSchema,
    title: z.string().min(1),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled", "mixed"]),
    tasks: z.array(taskEnvelopeSchema),
    expected_brief_revision: z.number().int().nonnegative(),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
    phase: z.string().optional(),
    budgets: metadataSchema.optional(),
    budget_exhaustion_policy: z.enum(["stop_starting", "cancel_running"]).optional(),
    priority: z.number().int().optional(),
    metadata: metadataSchema.optional()
  })
  .strict();

export const taskAttemptSchema = z
  .object({
    schema_version: z.literal(schemaVersion),
    attempt_id: attemptIdSchema,
    attempt_number: z.number().int().positive(),
    task_id: taskIdSchema,
    status: z.enum([
      "queued",
      "running",
      "completed",
      "blocked",
      "failed",
      "timed_out",
      "cancelled",
      "interrupted",
      "failed_contract",
      "completed_with_failed_verification"
    ]),
    created_at: isoTimestampSchema,
    updated_at: isoTimestampSchema,
    worktree_ref: z.string().optional(),
    started_at: isoTimestampSchema.optional(),
    finished_at: isoTimestampSchema.optional(),
    requested_model: z.string().optional(),
    effective_model: z.string().optional(),
    requested_reasoning_level: reasoningLevelSchema.optional(),
    effective_reasoning_level: reasoningLevelSchema.optional(),
    requested_reasoning_options: metadataSchema.optional(),
    effective_reasoning_options: metadataSchema.optional(),
    requested_permissions: metadataSchema.optional(),
    effective_permissions: metadataSchema.optional(),
    requested_sandbox: metadataSchema.optional(),
    effective_sandbox: metadataSchema.optional(),
    usage: metadataSchema.optional(),
    metadata: metadataSchema.optional()
  })
  .strict();

export const verificationResultSchema = z
  .object({
    command: z.string().min(1),
    status: z.enum(["passed", "failed", "skipped"]),
    exit_code: z.number().int().optional(),
    output: z.string().optional()
  })
  .strict();

export const resultArtifactReferenceSchema = z
  .object({
    type: z.string().min(1),
    path: z.string().min(1).optional(),
    artifact_id: artifactIdSchema.optional(),
    mime_type: z.string().min(1).optional(),
    summary: z.string().min(1)
  })
  .strict();

export const resultEnvelopeSchema = z
  .object({
    schema_version: z.literal(schemaVersion),
    task_id: taskIdSchema,
    attempt_id: attemptIdSchema,
    status: z.enum(["completed", "blocked", "failed"]),
    summary: z.string().min(1),
    verification: z.array(verificationResultSchema),
    artifacts: z.array(resultArtifactReferenceSchema),
    risks: z.array(z.string()),
    proposed_brief_updates: z.array(z.string()),
    findings: z.array(z.object({ summary: z.string().min(1), evidence: z.string().optional() }).strict()).optional(),
    changes: z.array(z.object({ path: z.string().min(1), summary: z.string().min(1) }).strict()).optional(),
    changed_files: z.array(z.string().min(1)).optional(),
    follow_up_tasks: z.array(z.string()).optional(),
    notes: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    usage: metadataSchema.optional(),
    metadata: metadataSchema.optional()
  })
  .strict()
  .superRefine((result, context) => {
    const hasFindings = result.findings !== undefined && result.findings.length > 0;
    const hasChanges = result.changes !== undefined && result.changes.length > 0;
    if (!hasFindings && !hasChanges) {
      context.addIssue({
        code: "custom",
        message: "Result envelopes require at least one finding or change",
        path: ["findings"]
      });
    }
  });

export const artifactSchema = z
  .object({
    schema_version: z.literal(schemaVersion),
    artifact_id: artifactIdSchema,
    scope: z
      .object({
        session_id: sessionIdSchema.optional(),
        group_id: taskGroupIdSchema.optional(),
        task_id: taskIdSchema.optional(),
        attempt_id: attemptIdSchema.optional()
      })
      .strict(),
    type: z.enum(["text", "code", "diff", "log", "evidence", "benchmark", "coverage", "screenshot", "recording", "file"]),
    mime_type: z.string().min(1),
    summary: z.string().min(1),
    created_at: isoTimestampSchema,
    resource_uri: z.string().min(1).optional(),
    size_bytes: z.number().int().nonnegative().optional(),
    hash: z.string().optional(),
    preview: z.string().optional(),
    metadata: metadataSchema.optional()
  })
  .strict();

export const eventSchema = z
  .object({
    schema_version: z.literal(schemaVersion),
    event_id: eventIdSchema,
    type: z.string().min(1),
    created_at: isoTimestampSchema,
    session_id: sessionIdSchema.optional(),
    group_id: taskGroupIdSchema.optional(),
    task_id: taskIdSchema.optional(),
    attempt_id: attemptIdSchema.optional(),
    artifact_id: artifactIdSchema.optional(),
    severity: z.enum(["debug", "info", "warning", "error"]).optional(),
    message: z.string().optional(),
    data: metadataSchema.optional(),
    metadata: metadataSchema.optional()
  })
  .strict();

export const effectiveConfigSchema = z
  .object({
    schema_version: z.literal(schemaVersion),
    storage: metadataSchema,
    profiles: metadataSchema,
    adapters: metadataSchema,
    security: metadataSchema,
    skill_paths: z.array(z.string()),
    redactions: z.array(z.string()).default([])
  })
  .strict();

export const publicSchemaDefinitions = {
  session: sessionSchema,
  task_group: taskGroupSchema,
  task_envelope: taskEnvelopeSchema,
  task_attempt: taskAttemptSchema,
  result_envelope: resultEnvelopeSchema,
  artifact: artifactSchema,
  event: eventSchema,
  effective_config: effectiveConfigSchema
} as const;

export const publicSchemas = Object.fromEntries(
  Object.entries(publicSchemaDefinitions).map(([name, schema]) => [name, z.toJSONSchema(schema)])
) as Record<keyof typeof publicSchemaDefinitions, unknown>;

export type SessionBrief = z.infer<typeof sessionBriefSchema>;
export type Session = z.infer<typeof sessionSchema>;
export type TaskEnvelope = z.infer<typeof taskEnvelopeSchema>;
export type TaskGroup = z.infer<typeof taskGroupSchema>;
export type TaskAttempt = z.infer<typeof taskAttemptSchema>;
export type ResultEnvelope = z.infer<typeof resultEnvelopeSchema>;
export type Artifact = z.infer<typeof artifactSchema>;
export type Event = z.infer<typeof eventSchema>;
export type EffectiveConfig = z.infer<typeof effectiveConfigSchema>;
