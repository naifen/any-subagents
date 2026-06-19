import { Command } from "commander";
import type { ControlPlane } from "../core/control-plane.js";
import { definedEntries } from "../core/defined.js";
import { smokeCodexAdapter } from "../adapters/codex.js";
import { CODEX_COMMAND } from "../adapters/codex-events.js";

export interface CliOptions {
  plane: ControlPlane;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export const createCli = ({ plane, stdout = (text) => process.stdout.write(text), stderr = (text) => process.stderr.write(text) }: CliOptions): Command => {
  const program = new Command();
  program
    .name("any-subagents")
    .description("Local control plane for process-backed subagents")
    .version("0.1.0")
    .configureOutput({
      writeOut: stdout,
      writeErr: stderr
    });

  program
    .command("daemon")
    .description("Daemon administration")
    .command("status")
    .description("Show daemon status")
    .option("--json", "write JSON")
    .action((options: { json?: boolean }) => {
      const payload = { status: "ok", adapters: plane.listAdapters().adapters };
      writePayload(payload, options.json === true, stdout);
    });

  const session = program.command("session").description("Session commands");
  session
    .command("create")
    .requiredOption("--repo <path>", "repository path")
    .requiredOption("--base-ref <ref>", "base git ref")
    .option("--goal <text>", "session brief goal", "")
    .option("--json", "write JSON")
    .action(async (options: { repo: string; baseRef: string; goal: string; json?: boolean }) => {
      const created = await plane.createSession({
        repo: options.repo,
        base_ref: options.baseRef,
        brief: { goal: options.goal }
      });
      writePayload(created, options.json === true, stdout);
    });

  const taskGroup = program.command("task-group").description("Task group commands");
  taskGroup
    .command("submit")
    .requiredOption("--json-input <json>", "task group submission JSON")
    .option("--json", "write JSON")
    .action(async (options: { jsonInput: string; json?: boolean }) => {
      const submitted = await plane.submitTaskGroup(JSON.parse(options.jsonInput) as Parameters<ControlPlane["submitTaskGroup"]>[0]);
      writePayload(submitted, options.json === true, stdout);
    });

  const task = program.command("task").description("Task commands");
  task
    .command("query")
    .option("--session-id <id>", "session ID")
    .option("--group-id <id>", "task group ID")
    .option("--json", "write JSON")
    .action(async (options: { sessionId?: string; groupId?: string; json?: boolean }) => {
      const queried = await plane.queryTasks(definedEntries({ session_id: options.sessionId, group_id: options.groupId }));
      writePayload(queried, options.json === true, stdout);
    });

  task
    .command("result")
    .requiredOption("--task-id <id>", "task ID")
    .option("--attempt-id <id>", "attempt ID")
    .option("--json", "write JSON")
    .action(async (options: { taskId: string; attemptId?: string; json?: boolean }) => {
      const result = await plane.getTaskResult(definedEntries({ task_id: options.taskId, attempt_id: options.attemptId }) as {
        task_id: string;
        attempt_id?: string;
      });
      writePayload(result, options.json === true, stdout);
    });

  task
    .command("logs")
    .requiredOption("--task-id <id>", "task ID")
    .option("--attempt-id <id>", "attempt ID")
    .option("--json", "write JSON")
    .action(async (options: { taskId: string; attemptId?: string; json?: boolean }) => {
      const logs = await plane.getTaskLogs(definedEntries({ task_id: options.taskId, attempt_id: options.attemptId }) as {
        task_id: string;
        attempt_id?: string;
      });
      writePayload(logs, options.json === true, stdout);
    });

  const artifacts = program.command("artifacts").description("Artifact commands");
  artifacts
    .command("list")
    .option("--session-id <id>", "session ID")
    .option("--group-id <id>", "task group ID")
    .option("--task-id <id>", "task ID")
    .option("--attempt-id <id>", "attempt ID")
    .option("--json", "write JSON")
    .action(async (options: { sessionId?: string; groupId?: string; taskId?: string; attemptId?: string; json?: boolean }) => {
      const listed = await plane.listArtifacts(definedEntries({
        session_id: options.sessionId,
        group_id: options.groupId,
        task_id: options.taskId,
        attempt_id: options.attemptId
      }));
      writePayload(listed, options.json === true, stdout);
    });

  program
    .command("cancel")
    .option("--task-id <id...>", "task ID")
    .option("--group-id <id>", "task group ID")
    .option("--session-id <id>", "session ID")
    .option("--json", "write JSON")
    .action(async (options: { taskId?: string[]; groupId?: string; sessionId?: string; json?: boolean }) => {
      const cancelled = await plane.cancelTasks(definedEntries({
        task_ids: options.taskId,
        group_id: options.groupId,
        session_id: options.sessionId
      }) as Parameters<ControlPlane["cancelTasks"]>[0]);
      writePayload(cancelled, options.json === true, stdout);
    });

  program
    .command("adapters")
    .description("List adapters")
    .option("--json", "write JSON")
    .action((options: { json?: boolean }) => {
      writePayload(plane.listAdapters(), options.json === true, stdout);
    });

  program
    .command("adapter")
    .description("Adapter commands")
    .command("smoke")
    .description("Run adapter smoke checks")
    .argument("<adapter>", "adapter name")
    .option("--command <command>", "adapter command")
    .option("--json", "write JSON")
    .action(async (adapter: string, options: { command?: string; json?: boolean }) => {
      if (adapter !== "codex") {
        throw new Error(`Unsupported smoke adapter: ${adapter}`);
      }
      writePayload(await smokeCodexAdapter({ command: options.command ?? CODEX_COMMAND }), options.json === true, stdout);
    });

  program
    .command("effective-config")
    .description("Show resolved local configuration")
    .option("--json", "write JSON")
    .action(async (options: { json?: boolean }) => {
      writePayload(await plane.getEffectiveConfig(), options.json === true, stdout);
    });

  program
    .command("doctor")
    .description("Run local setup diagnostics without model calls")
    .option("--json", "write JSON")
    .action(async (options: { json?: boolean }) => {
      writePayload(await plane.doctor(), options.json === true, stdout);
    });

  return program;
};

const writePayload = (payload: unknown, asJson: boolean, stdout: (text: string) => void): void => {
  if (asJson) {
    stdout(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  stdout(`${humanize(payload)}\n`);
};

const humanize = (payload: unknown): string => {
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload, null, 2);
};
