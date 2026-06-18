import { execFileResult } from "../core/exec.js";

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
  const result = await execFileResult(config.command, versionArgs, process.cwd());
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
