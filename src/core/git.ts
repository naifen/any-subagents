import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

export const assertGitRepo = async (repo: string): Promise<void> => {
  await execRequired("git", ["rev-parse", "--show-toplevel"], repo);
};

export const assertGitRef = async (repo: string, ref: string): Promise<void> => {
  await execRequired("git", ["rev-parse", "--verify", ref], repo);
};

export const excludeHarness = async (worktreePath: string): Promise<void> => {
  const gitPath = path.join(worktreePath, ".git");
  let gitDir = gitPath;
  if (!existsSync(path.join(gitPath, "info"))) {
    const gitFile = await readFile(gitPath, "utf8");
    const match = /^gitdir: (.+)$/m.exec(gitFile.trim());
    if (match?.[1]) {
      gitDir = path.resolve(worktreePath, match[1]);
    }
  }
  const excludePath = path.join(gitDir, "info", "exclude");
  await mkdir(path.dirname(excludePath), { recursive: true });
  const existing = existsSync(excludePath) ? await readFile(excludePath, "utf8") : "";
  if (!existing.includes(".any-subagents/")) {
    await writeFile(excludePath, `${existing}${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}.any-subagents/\n`);
  }
};

export const createPatch = async (worktreePath: string): Promise<string> => {
  const tracked = await execGit(["diff", "--binary", "--", "."], worktreePath);
  const untracked = await execGit(["ls-files", "--others", "--exclude-standard"], worktreePath);
  const chunks = [tracked.stdout];
  for (const file of untracked.stdout.split("\n").filter((entry) => entry.length > 0 && !entry.startsWith(".any-subagents/"))) {
    const diff = await execGit(["diff", "--no-index", "--", "/dev/null", file], worktreePath);
    chunks.push(diff.stdout);
  }
  return chunks.join("\n");
};

export const parsePorcelainChangedFiles = (output: string): string[] =>
  output
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((file) => file.replace(/^"|"$/g, ""));

export const execRequired = async (command: string, args: string[], cwd: string): Promise<string> => {
  const result = await execFileResult(command, args, cwd);
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
};

export const execGit = async (args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> =>
  execFileResult("git", args, cwd);

export const execShell = async (command: string, cwd: string): Promise<{ stdout: string; stderr: string; code: number }> =>
  new Promise((resolve) => {
    execFile("/bin/sh", ["-c", command], { cwd }, (error, stdout, stderr) => {
      const code =
        typeof (error as { code?: unknown } | null)?.code === "number" ? ((error as { code: number }).code as number) : error ? 1 : 0;
      resolve({ stdout, stderr, code });
    });
  });

export const execFileResult = async (
  command: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; code: number }> =>
  new Promise((resolve) => {
    execFile(command, args, { cwd }, (error, stdout, stderr) => {
      const code =
        typeof (error as { code?: unknown } | null)?.code === "number" ? ((error as { code: number }).code as number) : error ? 1 : 0;
      resolve({ stdout, stderr, code });
    });
  });
