import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { spawnSupervised, type RunningAttempt } from "../src/core/spawn-supervised.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("spawnSupervised", () => {
  test("captures stdout as utf8 strings and writes logs", async () => {
    const runtime = await createTestRuntimePaths();
    cleanups.push(() => rm(runtime.root, { recursive: true, force: true }));
    const logPath = path.join(runtime.logsDir, "spawn-utf8.log");
    await mkdir(path.dirname(logPath), { recursive: true });

    const chunks: string[] = [];
    const running = new Map<string, RunningAttempt>();
    const result = await spawnSupervised(running, {
      taskId: "task_utf8",
      attemptId: "att_utf8",
      command: process.execPath,
      args: ["-e", "process.stdout.write('emoji 🎉\\nsecond line\\n')"],
      cwd: runtime.root,
      logPath,
      captureStdout: (chunk) => {
        chunks.push(chunk);
      }
    });

    expect(result.exitCode).toBe(0);
    expect(chunks.join("")).toContain("emoji 🎉");
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("emoji 🎉");
    expect(log).toContain("second line");
  });

  test("marks attempts as timed out and terminates the child", async () => {
    const runtime = await createTestRuntimePaths();
    cleanups.push(() => rm(runtime.root, { recursive: true, force: true }));
    const logPath = path.join(runtime.logsDir, "spawn-timeout.log");
    await mkdir(path.dirname(logPath), { recursive: true });

    const running = new Map<string, RunningAttempt>();
    const result = await spawnSupervised(running, {
      taskId: "task_timeout",
      attemptId: "att_timeout",
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 10_000)"],
      cwd: runtime.root,
      logPath,
      timeoutMs: 50
    });

    expect(result.timedOut).toBe(true);
    expect(result.cancelled).toBe(false);
  });

  test("handles spawn failure when command is missing", async () => {
    const runtime = await createTestRuntimePaths();
    cleanups.push(() => rm(runtime.root, { recursive: true, force: true }));
    const logPath = path.join(runtime.logsDir, "spawn-enoent.log");
    await mkdir(path.dirname(logPath), { recursive: true });

    const running = new Map<string, RunningAttempt>();
    const result = await spawnSupervised(running, {
      taskId: "task_enoent",
      attemptId: "att_enoent",
      command: "/nonexistent/binary-2912ef",
      args: [],
      cwd: runtime.root,
      logPath
    });

    expect(result.exitCode).toBe(1);
    expect(result.cancelled).toBe(false);
    expect(result.timedOut).toBe(false);
    expect(running.has("task_enoent")).toBe(false);
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("spawn error:");
    expect(log).toContain("ENOENT");
  });

  test("captures trailing stdout before resolving", async () => {
    const runtime = await createTestRuntimePaths();
    cleanups.push(() => rm(runtime.root, { recursive: true, force: true }));
    const logPath = path.join(runtime.logsDir, "spawn-trailing.log");
    await mkdir(path.dirname(logPath), { recursive: true });

    const chunks: string[] = [];
    const running = new Map<string, RunningAttempt>();
    const result = await spawnSupervised(running, {
      taskId: "task_trailing",
      attemptId: "att_trailing",
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write('first\\n'); setTimeout(() => { process.stdout.write('last\\n'); }, 10);"
      ],
      cwd: runtime.root,
      logPath,
      captureStdout: (chunk) => {
        chunks.push(chunk);
      }
    });

    expect(result.exitCode).toBe(0);
    expect(chunks.join("")).toContain("last");
    const log = await readFile(logPath, "utf8");
    expect(log).toContain("last");
  });
});
