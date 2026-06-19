import { describe, expect, test } from "vitest";
import {
  appendCodexJsonlLines,
  codexThreadEventSchema,
  flushCodexJsonlBuffer,
  parseCodexJsonlLine
} from "../src/adapters/codex-events.js";

describe("parseCodexJsonlLine", () => {
  test("parses item.completed events", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: "Hello." }
    });
    expect(parseCodexJsonlLine(line)).toEqual({
      type: "item.completed",
      item: { id: "item_1", type: "agent_message", text: "Hello." }
    });
  });

  test("parses turn.completed events", () => {
    const line = JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 10, output_tokens: 5 }
    });
    expect(parseCodexJsonlLine(line)).toEqual({
      type: "turn.completed",
      usage: { input_tokens: 10, output_tokens: 5 }
    });
  });

  test("rejects null item without throwing", () => {
    expect(parseCodexJsonlLine(JSON.stringify({ type: "item.completed", item: null }))).toBeUndefined();
  });

  test("rejects agent messages with non-string text", () => {
    const line = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: 123 }
    });
    expect(parseCodexJsonlLine(line)).toBeUndefined();
  });

  test("rejects turn.completed with non-object usage", () => {
    expect(parseCodexJsonlLine(JSON.stringify({ type: "turn.completed", usage: "high" }))).toBeUndefined();
  });

  test("ignores unknown event types", () => {
    expect(parseCodexJsonlLine(JSON.stringify({ type: "thread.started" }))).toBeUndefined();
  });

  test("ignores malformed JSON", () => {
    expect(parseCodexJsonlLine("{not json")).toBeUndefined();
  });

  test("strips trailing carriage return from CRLF lines", () => {
    const line = `${JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } })}\r`;
    expect(parseCodexJsonlLine(line)?.type).toBe("turn.completed");
  });
});

describe("appendCodexJsonlLines", () => {
  test("buffers partial lines across chunks", () => {
    const line = JSON.stringify({ type: "thread.started" });
    const first = appendCodexJsonlLines("", line.slice(0, 10));
    expect(first.lines).toEqual([]);
    expect(first.buffer).toBe(line.slice(0, 10));

    const second = appendCodexJsonlLines(first.buffer, `${line.slice(10)}\n`);
    expect(second.lines).toEqual([line]);
    expect(second.buffer).toBe("");
  });

  test("emits complete lines and retains trailing partial line", () => {
    const complete = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } });
    const partial = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Hi" } });
    const chunk = `${complete}\n${partial.slice(0, 8)}`;
    const parsed = appendCodexJsonlLines("", chunk);
    expect(parsed.lines).toEqual([complete]);
    expect(parsed.buffer).toBe(partial.slice(0, 8));
  });

  test("preserves multi-byte UTF-8 characters split across chunks", () => {
    const payload = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Done with emoji 🎉" }
    });
    const full = `${payload}\n`;
    const mid = 17;
    let buffer = "";
    const first = appendCodexJsonlLines(buffer, full.slice(0, mid));
    buffer = first.buffer;
    const second = appendCodexJsonlLines(buffer, full.slice(mid));
    expect([...first.lines, ...second.lines]).toEqual([payload]);
  });

  test("skips empty lines", () => {
    const line = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
    const parsed = appendCodexJsonlLines("", `\n\n${line}\n\n`);
    expect(parsed.lines).toEqual([line]);
  });
});

describe("flushCodexJsonlBuffer", () => {
  test("returns remaining buffered line", () => {
    const line = JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
    expect(flushCodexJsonlBuffer(line)).toEqual([line]);
  });

  test("returns empty array for whitespace-only buffer", () => {
    expect(flushCodexJsonlBuffer("  \n  ")).toEqual([]);
  });
});

describe("codexThreadEventSchema round-trip", () => {
  test("validates known event shapes", () => {
    const events = [
      { type: "item.completed", item: { type: "agent_message", text: "ok" } },
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 2 } }
    ] as const;
    for (const event of events) {
      expect(codexThreadEventSchema.safeParse(event).success).toBe(true);
    }
  });
});
