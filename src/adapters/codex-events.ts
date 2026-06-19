import { z } from "zod";

export const CODEX_COMMAND = "codex";

// Codex `exec --json` is an external, evolving surface. These schemas validate
// only the fields we consume and tolerate unmodeled ones, so a new field never
// silently discards a whole event.
export const codexUsageSchema = z.object({
  input_tokens: z.number(),
  cached_input_tokens: z.number().optional(),
  output_tokens: z.number(),
  reasoning_output_tokens: z.number().optional()
});

export const codexFileUpdateChangeSchema = z.object({
  path: z.string().min(1),
  kind: z.string().min(1)
});

export const codexThreadItemSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  item_type: z.string().optional(),
  text: z.string().optional(),
  changes: z.array(z.unknown()).optional(),
  status: z.string().optional()
});

export const codexItemCompletedEventSchema = z.object({
  type: z.literal("item.completed"),
  item: codexThreadItemSchema
});

export const codexTurnCompletedEventSchema = z.object({
  type: z.literal("turn.completed"),
  usage: codexUsageSchema
});

export const codexThreadEventSchema = z.discriminatedUnion("type", [
  codexItemCompletedEventSchema,
  codexTurnCompletedEventSchema
]);

export type CodexUsage = z.infer<typeof codexUsageSchema>;
export type CodexThreadItem = z.infer<typeof codexThreadItemSchema>;
export type CodexThreadEvent = z.infer<typeof codexThreadEventSchema>;

const stripCr = (line: string): string => line.replace(/\r$/, "");

export const parseCodexJsonlLine = (line: string): CodexThreadEvent | undefined => {
  const trimmed = stripCr(line);
  if (trimmed.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const result = codexThreadEventSchema.safeParse(parsed);
  return result.success ? result.data : undefined;
};

export const parseCodexFileChange = (raw: unknown): z.infer<typeof codexFileUpdateChangeSchema> | undefined => {
  const result = codexFileUpdateChangeSchema.safeParse(raw);
  return result.success ? result.data : undefined;
};

export const codexItemType = (item: CodexThreadItem): string | undefined => item.type ?? item.item_type;

export const isCodexAgentMessageItem = (item: CodexThreadItem): boolean => {
  const type = codexItemType(item);
  return type === "agent_message" || type === "assistant_message";
};

export const isCodexFileChangeItem = (item: CodexThreadItem): boolean =>
  codexItemType(item) === "file_change" && Array.isArray(item.changes);

export const appendCodexJsonlLines = (buffer: string, chunk: string): { buffer: string; lines: string[] } => {
  const combined = buffer + chunk;
  const parts = combined.split("\n");
  const nextBuffer = parts.pop() ?? "";
  const lines = parts.filter((line) => stripCr(line).trim().length > 0);
  return { buffer: nextBuffer, lines };
};

export const flushCodexJsonlBuffer = (buffer: string): string[] => {
  const trimmed = stripCr(buffer).trim();
  return trimmed.length > 0 ? [trimmed] : [];
};
