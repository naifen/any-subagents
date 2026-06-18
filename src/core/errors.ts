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
