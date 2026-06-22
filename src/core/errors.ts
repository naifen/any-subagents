/**
 * Typed error for resources that are not found.
 * Used for 404 detection without brittle string matching.
 */
export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

/** Typed error for task model/reasoning allowlist violations at submission or runtime. */
export class TaskPolicyError extends Error {
  readonly code = "TASK_POLICY" as const;
  readonly field: "model" | "reasoning_level";
  readonly requested: string;
  readonly allowlist: string[];

  constructor(field: "model" | "reasoning_level", requested: string, allowlist: string[], message?: string) {
    super(
      message ??
        `Requested ${field} "${requested}" is not in profile allowlist [${allowlist.join(", ")}]; set allow_fallback: true to use profile default`
    );
    this.name = "TaskPolicyError";
    this.field = field;
    this.requested = requested;
    this.allowlist = allowlist;
  }
}
