/** Parse a nullable JSON column, defaulting to `fallback` when null/empty. */
export const jsonColumn = <T>(value: string | null, fallback: T): T =>
  value != null && value.length > 0 ? (JSON.parse(value) as T) : fallback;
