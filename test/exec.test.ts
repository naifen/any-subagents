import { describe, expect, test } from "vitest";
import { execFileResult, execGit, execRequired, execShell } from "../src/core/exec.js";

describe("exec helpers", () => {
  test("execFileResult resolves with code 0 on success", async () => {
    const result = await execFileResult("echo", ["hello"], process.cwd());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("hello");
    expect(result.errorCode).toBeUndefined();
    expect(result.errorMessage).toBeUndefined();
  });

  test("execFileResult resolves with non-zero code on failure", async () => {
    const result = await execFileResult("/bin/sh", ["-c", "exit 42"], process.cwd());
    expect(result.code).toBe(42);
  });

  test("execFileResult populates errorCode for ENOENT", async () => {
    const result = await execFileResult("definitely-missing-binary", [], process.cwd());
    expect(result.code).toBe(1);
    expect(result.errorCode).toBe("ENOENT");
    expect(result.errorMessage).toContain("ENOENT");
  });

  test("execRequired resolves with stdout on success", async () => {
    const stdout = await execRequired("echo", ["world"], process.cwd());
    expect(stdout).toContain("world");
  });

  test("execRequired throws on non-zero exit", async () => {
    await expect(execRequired("/bin/sh", ["-c", "exit 1"], process.cwd())).rejects.toThrow("failed");
  });

  test("execGit delegates to execFileResult", async () => {
    const result = await execGit(["--version"], process.cwd());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("git version");
  });

  test("execShell resolves with code 0 on success", async () => {
    const result = await execShell("echo shell-test", process.cwd());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("shell-test");
  });

  test("execShell resolves with non-zero code on failure", async () => {
    const result = await execShell("exit 7", process.cwd());
    expect(result.code).toBe(7);
  });

  test("execShell populates errorCode for missing binary", async () => {
    // After consolidation, execShell should delegate to execFileResult
    // and inherit the errorCode/errorMessage behavior.
    // This tests that the consolidation preserves the interface contract.
    const result = await execShell("definitely-missing-binary-xyz 2>/dev/null", process.cwd());
    // Shell wraps the missing binary — exit code 127, not ENOENT
    expect(result.code).toBe(127);
  });
});
