import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionBrief, TaskEnvelope } from "../schemas/index.js";
import { publicSchemas } from "../schemas/index.js";
import { fakeAdapterScript } from "../adapters/fake-script.js";
import { redactText } from "./redaction.js";
import { redactionOptionsFromConfig } from "./redaction-context.js";
import type { RuntimePaths } from "../storage/paths.js";
import type { AppConfig } from "../config/schema.js";
import { defaultConfig } from "../config/schema.js";

export interface HarnessInput {
  harnessDir: string;
  envelope: TaskEnvelope;
  brief: SessionBrief;
  attemptId: string;
  verificationCommands?: TaskEnvelope["verification_commands"];
  mountedSkills?: string[];
  config?: AppConfig;
  paths?: RuntimePaths;
}

/**
 * Write the harness directory files that a subagent reads at startup.
 *
 * All writes are independent so they run in parallel.
 */
export const writeHarnessFiles = async (input: HarnessInput): Promise<void> => {
  const redactionOptions = redactionOptionsFromConfig(input.config ?? defaultConfig(), input.paths);
  await mkdir(input.harnessDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(input.harnessDir, "task.json"), `${JSON.stringify(input.envelope, null, 2)}\n`),
    writeFile(path.join(input.harnessDir, "brief.md"), redactText(renderBrief(input.brief), redactionOptions)),
    writeFile(
      path.join(input.harnessDir, "instructions.md"),
      redactText(renderInstructions(input), redactionOptions)
    ),
    writeFile(
      path.join(input.harnessDir, "result.schema.json"),
      `${JSON.stringify(publicSchemas.result_envelope, null, 2)}\n`
    ),
    mkdir(path.join(input.harnessDir, "artifacts"), { recursive: true }),
    writeFile(path.join(input.harnessDir, "fake-adapter.mjs"), fakeAdapterScript)
  ]);
};

const renderBrief = (brief: SessionBrief): string => `# Session Brief

Goal: ${brief.goal}

Constraints:
${brief.constraints.map((item) => `- ${item}`).join("\n")}

Decisions:
${brief.decisions.map((item) => `- ${item}`).join("\n")}

Accepted Findings:
${brief.accepted_findings.map((item) => `- ${item}`).join("\n")}

Rejected Paths:
${brief.rejected_paths.map((item) => `- ${item}`).join("\n")}

Open Questions:
${brief.open_questions.map((item) => `- ${item}`).join("\n")}
`;

const renderInstructions = (input: HarnessInput): string => {
  const task = input.envelope;
  const verificationLines =
    input.verificationCommands && input.verificationCommands.length > 0
      ? `\nVerification commands (prioritise these over exploratory work):\n${input.verificationCommands
          .map((command) => `- ${typeof command === "string" ? command : command.command}`)
          .join("\n")}\n`
      : "";
  const skillLines =
    input.mountedSkills && input.mountedSkills.length > 0
      ? `\nMounted skill paths (read-only):\n${input.mountedSkills.map((entry) => `- ${entry}`).join("\n")}\n`
      : "";

  return `You are a subagent running under any-subagents.

Follow the task contract exactly. Write .any-subagents/result.tmp.json first, then atomically rename it to .any-subagents/result.json.

Do not spawn subagents, delegate to other agents, or call any-subagents tools recursively.

Identity:
- Session: ${task.session_id}
- Task Group: ${task.group_id}
- Task: ${task.task_id}
- Attempt: ${input.attemptId}
- Mode: ${task.mode}
- Adapter/Profile: ${task.adapter}/${task.profile}
${verificationLines}${skillLines}`;
};
