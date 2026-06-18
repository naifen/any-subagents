import { execFile, type ExecFileException } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Process exit code, or 1 if the process failed to start. */
  code: number;
  /** Node errno string (e.g. "ENOENT") when the binary could not be found. */
  errorCode?: string;
  /** Full error message from the Node runtime. */
  errorMessage?: string;
}

/**
 * Run a command via child_process.execFile and always resolve (never reject).
 * The caller inspects `.code` to determine success.
 */
export const execFileResult = async (
  command: string,
  args: string[],
  cwd: string
): Promise<ExecResult> =>
  new Promise((resolve) => {
    execFile(command, args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        const exc = error as ExecFileException;
        // ExecFileException.code is string | number | undefined.
        // - number → process exit code
        // - string → Node errno (e.g. "ENOENT")
        // - undefined → unknown failure; fall back to 1
        const code = typeof exc.code === "number" ? exc.code : 1;
        resolve({
          stdout,
          stderr,
          code,
          ...(typeof exc.code === "string" ? { errorCode: exc.code } : {}),
          errorMessage: exc.message
        });
        return;
      }
      resolve({ stdout, stderr, code: 0 });
    });
  });

/**
 * Run a command and throw if it exits non-zero.
 */
export const execRequired = async (command: string, args: string[], cwd: string): Promise<string> => {
  const result = await execFileResult(command, args, cwd);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
};

/**
 * Run a git command and return the result.
 */
export const execGit = async (args: string[], cwd: string): Promise<ExecResult> =>
  execFileResult("git", args, cwd);

/**
 * Run a shell command via /bin/sh and return the result.
 */
export const execShell = async (command: string, cwd: string): Promise<ExecResult> =>
  execFileResult("/bin/sh", ["-c", command], cwd);
