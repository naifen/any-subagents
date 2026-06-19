import { createWriteStream } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";

export interface RunningAttempt {
  child: ChildProcess;
  attempt_id: string;
  cancelled: boolean;
  timedOut: boolean;
}

export interface SpawnSupervisedInput {
  taskId: string;
  attemptId: string;
  command: string;
  args: string[];
  cwd: string;
  logPath: string;
  timeoutMs?: number;
  extraEnv?: Record<string, string>;
  captureStdout?: (chunk: string) => void;
}

export interface SpawnSupervisedResult {
  cancelled: boolean;
  timedOut: boolean;
  exitCode: number | null;
}

export const spawnSupervised = async (
  running: Map<string, RunningAttempt>,
  input: SpawnSupervisedInput
): Promise<SpawnSupervisedResult> => {
  const logStream = createWriteStream(input.logPath, { flags: "a" });
  const child: ChildProcess = spawn(input.command, input.args, {
    cwd: input.cwd,
    env: {
      ...process.env,
      ...input.extraEnv,
      ANY_SUBAGENTS_ATTEMPT_ID: input.attemptId
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const captureStdout = input.captureStdout;
  if (captureStdout) {
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      logStream.write(chunk);
      captureStdout(chunk);
    });
  } else {
    child.stdout?.pipe(logStream, { end: false });
  }
  child.stderr?.pipe(logStream, { end: false });

  const attempt: RunningAttempt = { child, attempt_id: input.attemptId, cancelled: false, timedOut: false };
  running.set(input.taskId, attempt);

  const timer =
    input.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          attempt.timedOut = true;
          child.kill("SIGTERM");
        }, input.timeoutMs);

  const exitCode = await new Promise<number | null>((resolve) => {
    let settled = false;
    const settle = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(code);
    };

    child.on("error", (err: NodeJS.ErrnoException) => {
      logStream.write(`spawn error: ${err.message}\n`);
      running.delete(input.taskId);
      settle(1);
    });
    child.on("close", (code) => settle(code));
  });
  await new Promise<void>((resolve) => logStream.end(resolve));
  return { cancelled: attempt.cancelled, timedOut: attempt.timedOut, exitCode };
};
