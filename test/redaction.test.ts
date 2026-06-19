import { describe, expect, test } from "vitest";
import { redactText } from "../src/core/redaction.js";

describe("redaction", () => {
  test("redacts common secret patterns", () => {
    const input = "token=super-secret-value and Bearer abc.def.ghi";
    const output = redactText(input);
    expect(output).not.toContain("super-secret-value");
    expect(output).toContain("[redacted]");
  });

  test("applies optional path redaction", () => {
    const input = "Wrote /Users/me/project/output.txt";
    const output = redactText(input, { pathRedaction: true, basePaths: ["/Users/me/project"] });
    expect(output).not.toContain("/Users/me/project");
    expect(output).toContain("[redacted");
  });

  test("supports custom regex patterns from config", () => {
    const output = redactText("project-key=abc123", { extraPatterns: ["project-key=[^\\s]+"] });
    expect(output).toBe("[redacted]");
  });
});
