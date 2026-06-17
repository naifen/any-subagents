import { execFile } from "node:child_process";

export interface CodexAdapterConfig {
  command: string;
  versionArgs?: string[];
  allowedModels?: string[];
  allowedReasoningLevels?: string[];
}

export interface CodexHealth {
  adapter: "codex";
  available: boolean;
  command: string;
  version?: string;
  reason?: string;
  supports_model_selection: true;
  supports_reasoning_level: true;
  allowed_models: string[];
  allowed_reasoning_levels: string[];
}

export interface CodexSmokeResult {
  adapter: "codex";
  status: "skipped" | "ready";
  model_call_performed: false;
  health: CodexHealth;
}

export const checkCodexAdapterHealth = async (config: CodexAdapterConfig): Promise<CodexHealth> => {
  const versionArgs = config.versionArgs ?? ["--version"];
  const result = await execFileResult(config.command, versionArgs);
  const base = {
    adapter: "codex" as const,
    command: config.command,
    supports_model_selection: true as const,
    supports_reasoning_level: true as const,
    allowed_models: config.allowedModels ?? [],
    allowed_reasoning_levels: config.allowedReasoningLevels ?? ["minimal", "low", "medium", "high", "xhigh", "max"]
  };

  if (result.code !== 0) {
    return {
      ...base,
      available: false,
      reason: result.errorCode === "ENOENT" ? "command not found" : result.stderr || result.errorMessage || "command failed"
    };
  }

  return {
    ...base,
    available: true,
    version: (result.stdout || result.stderr).trim()
  };
};

export const smokeCodexAdapter = async (config: CodexAdapterConfig): Promise<CodexSmokeResult> => {
  const health = await checkCodexAdapterHealth(config);
  return {
    adapter: "codex",
    status: health.available ? "ready" : "skipped",
    model_call_performed: false,
    health
  };
};

const execFileResult = async (
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number; errorCode?: string; errorMessage?: string }> =>
  new Promise((resolve) => {
    execFile(command, args, (error, stdout, stderr) => {
      if (error) {
        const maybeNodeError = error as NodeJS.ErrnoException & { code?: string | number };
        resolve({
          stdout,
          stderr,
          code: typeof maybeNodeError.code === "number" ? maybeNodeError.code : 1,
          errorMessage: maybeNodeError.message,
          ...(typeof maybeNodeError.code === "string" ? { errorCode: maybeNodeError.code } : {})
        });
        return;
      }
      resolve({ stdout, stderr, code: 0 });
    });
  });
