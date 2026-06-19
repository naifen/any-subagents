import { execFileResult } from "../core/exec.js";
import { schemaVersion, type ResultEnvelope, type SessionBrief, type TaskEnvelope } from "../schemas/index.js";
import {
  isCodexAgentMessageItem,
  isCodexFileChangeItem,
  parseCodexFileChange,
  parseCodexJsonlLine,
  type CodexThreadEvent,
  type CodexUsage
} from "./codex-events.js";

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

export interface BuildCodexArgsInput {
  worktreePath: string;
  model?: string;
  reasoning_level?: string;
  prompt: string;
}

export interface SynthesizeResultInput {
  taskId: string;
  attemptId: string;
  mode: TaskEnvelope["mode"];
  exitCode: number | null;
  jsonlLines: string[];
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

const noAgentMessagesSummary = "Codex completed without agent messages.";

const mapReasoningLevel = (level: string): string => {
  // Codex `model_reasoning_effort` accepts minimal, low, medium, high, and xhigh.
  if (level === "max") return "xhigh";
  return level;
};

export const buildCodexArgs = (input: BuildCodexArgsInput): string[] => {
  const args = ["exec"];
  if (input.model) {
    args.push("-m", input.model);
  }
  if (input.reasoning_level) {
    args.push("-c", `model_reasoning_effort=${mapReasoningLevel(input.reasoning_level)}`);
  }
  args.push(
    "--full-auto",
    "-C",
    input.worktreePath,
    "--skip-git-repo-check",
    "--json",
    "--ephemeral",
    input.prompt
  );
  return args;
};

const renderSection = (title: string, items: string[]): string | undefined => {
  if (items.length === 0) return undefined;
  return `${title}:\n${items.map((item) => `- ${item}`).join("\n")}`;
};

export const renderCodexPrompt = (envelope: TaskEnvelope, brief: SessionBrief): string => {
  const sections = [
    `Goal: ${envelope.goal}`,
    renderSection("Success criteria", envelope.success_criteria),
    envelope.constraints ? renderSection("Task constraints", envelope.constraints) : undefined,
    envelope.scope
      ? [
          renderSection("Scope paths", envelope.scope.paths),
          envelope.scope.notes ? `Scope notes: ${envelope.scope.notes}` : undefined
        ]
          .filter(Boolean)
          .join("\n\n")
      : undefined,
    brief.goal ? `Session goal: ${brief.goal}` : undefined,
    renderSection("Session constraints", brief.constraints),
    renderSection("Decisions", brief.decisions),
    renderSection("Accepted findings", brief.accepted_findings),
    renderSection("Rejected paths", brief.rejected_paths),
    renderSection("Open questions", brief.open_questions)
  ].filter(Boolean);

  return sections.join("\n\n");
};

const collectAgentMessages = (events: CodexThreadEvent[]): string[] => {
  const messages: string[] = [];
  for (const event of events) {
    if (event.type !== "item.completed") continue;
    const item = event.item;
    if (isCodexAgentMessageItem(item) && typeof item.text === "string" && item.text.trim().length > 0) {
      messages.push(item.text);
    }
  }
  return messages;
};

const collectFileChanges = (events: CodexThreadEvent[]): Array<{ path: string; summary: string }> => {
  const changes: Array<{ path: string; summary: string }> = [];
  for (const event of events) {
    if (event.type !== "item.completed") continue;
    const item = event.item;
    if (!isCodexFileChangeItem(item)) continue;
    for (const raw of item.changes ?? []) {
      const change = parseCodexFileChange(raw);
      if (change) {
        changes.push({ path: change.path, summary: change.kind });
      }
    }
  }
  return changes;
};

const latestUsage = (events: CodexThreadEvent[]): CodexUsage | undefined => {
  let usage: CodexUsage | undefined;
  for (const event of events) {
    if (event.type === "turn.completed") {
      usage = event.usage;
    }
  }
  return usage;
};

export const synthesizeResult = (input: SynthesizeResultInput): ResultEnvelope => {
  const events = input.jsonlLines.map(parseCodexJsonlLine).filter((event): event is CodexThreadEvent => event !== undefined);
  const agentMessages = collectAgentMessages(events);
  const fileChanges = collectFileChanges(events);
  const succeeded = input.exitCode === 0;
  const lastAgentMessage = agentMessages.at(-1);
  const exitFailure = `Codex exited with code ${input.exitCode ?? "unknown"}.`;
  const summary = succeeded
    ? (lastAgentMessage ?? noAgentMessagesSummary)
    : lastAgentMessage
      ? `${exitFailure} Last agent message: ${lastAgentMessage}`
      : exitFailure;

  const usage = latestUsage(events);
  const base: ResultEnvelope = {
    schema_version: schemaVersion,
    task_id: input.taskId,
    attempt_id: input.attemptId,
    // Codex v1 never emits blocked; statusFromResult handles it if a future adapter does.
    status: succeeded ? "completed" : "failed",
    summary,
    verification: [],
    artifacts: [],
    risks: [],
    proposed_brief_updates: [],
    ...(usage ? { usage } : {})
  };

  if (input.mode === "write" && fileChanges.length > 0) {
    return {
      ...base,
      changes: fileChanges,
      changed_files: fileChanges.map((change) => change.path)
    };
  }

  const findings =
    agentMessages.length > 0
      ? agentMessages.map((text) => ({ summary: text }))
      : [{ summary: succeeded ? noAgentMessagesSummary : summary }];

  return { ...base, findings };
};
