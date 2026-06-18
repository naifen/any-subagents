import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionBrief, TaskEnvelope } from "../schemas/index.js";
import { publicSchemas } from "../schemas/index.js";
import { fakeAdapterScript } from "../adapters/fake-script.js";

export interface HarnessInput {
  harnessDir: string;
  envelope: TaskEnvelope;
  brief: SessionBrief;
  attemptId: string;
}

/**
 * Write the harness directory files that a subagent reads at startup.
 *
 * All writes are independent so they run in parallel.
 */
export const writeHarnessFiles = async (input: HarnessInput): Promise<void> => {
  await Promise.all([
    writeFile(path.join(input.harnessDir, "task.json"), `${JSON.stringify(input.envelope, null, 2)}\n`),
    writeFile(path.join(input.harnessDir, "brief.md"), renderBrief(input.brief)),
    writeFile(path.join(input.harnessDir, "instructions.md"), renderInstructions(input.envelope, input.attemptId)),
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

const renderInstructions = (task: TaskEnvelope, attemptId: string): string => `You are a subagent running under any-subagents.

Follow the task contract exactly. Write .any-subagents/result.tmp.json first, then atomically rename it to .any-subagents/result.json.

Identity:
- Session: ${task.session_id}
- Task Group: ${task.group_id}
- Task: ${task.task_id}
- Attempt: ${attemptId}
- Mode: ${task.mode}
- Adapter/Profile: ${task.adapter}/${task.profile}
`;
