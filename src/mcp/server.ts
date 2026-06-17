import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ControlPlane } from "../core/control-plane.js";
import { definedEntries } from "../core/defined.js";
import { publicSchemas } from "../schemas/index.js";

export interface AnySubagentsMcpServerOptions {
  plane: ControlPlane;
}

export const createAnySubagentsMcpServer = ({ plane }: AnySubagentsMcpServerOptions): McpServer => {
  const server = new McpServer({
    name: "any-subagents",
    version: "0.1.0"
  });

  registerTool(server, "list_adapters", "List configured subagent adapters.", z.object({}).strict(), async () => plane.listAdapters());

  registerTool(
    server,
    "create_session",
    "Create a session for a repository and base ref.",
    z
      .object({
        repo: z.string(),
        base_ref: z.string(),
        brief: z.record(z.string(), z.unknown()).optional(),
        metadata: z.record(z.string(), z.unknown()).optional()
      })
      .strict(),
    (input) => plane.createSession(definedEntries(input) as unknown as Parameters<ControlPlane["createSession"]>[0])
  );

  registerTool(
    server,
    "submit_task_group",
    "Submit a task group for durable scheduling.",
    z
      .object({
        session_id: z.string(),
        title: z.string(),
        expected_brief_revision: z.number().int().nonnegative(),
        ignore_revision_conflict: z.boolean().optional(),
        tasks: z.array(z.record(z.string(), z.unknown()))
      })
      .strict(),
    (input) => plane.submitTaskGroup(input as Parameters<ControlPlane["submitTaskGroup"]>[0])
  );

  registerTool(
    server,
    "query_tasks",
    "Query compact task status summaries.",
    z.object({ session_id: z.string().optional(), group_id: z.string().optional() }).strict(),
    (input) => plane.queryTasks(definedEntries(input) as { session_id?: string; group_id?: string })
  );

  registerTool(
    server,
    "get_task_result",
    "Read a task result envelope and attempt status.",
    z.object({ task_id: z.string(), attempt_id: z.string().optional() }).strict(),
    (input) => plane.getTaskResult(definedEntries(input) as { task_id: string; attempt_id?: string })
  );

  registerTool(
    server,
    "get_task_logs",
    "Read a preview of task attempt logs.",
    z.object({ task_id: z.string(), attempt_id: z.string().optional(), max_bytes: z.number().int().positive().optional() }).strict(),
    (input) => plane.getTaskLogs(definedEntries(input) as { task_id: string; attempt_id?: string; max_bytes?: number })
  );

  registerTool(
    server,
    "list_artifacts",
    "List artifact records without raw local paths.",
    z
      .object({
        session_id: z.string().optional(),
        group_id: z.string().optional(),
        task_id: z.string().optional(),
        attempt_id: z.string().optional()
      })
      .strict(),
    (input) => plane.listArtifacts(definedEntries(input) as { session_id?: string; group_id?: string; task_id?: string; attempt_id?: string })
  );

  registerTool(
    server,
    "get_artifact",
    "Read an artifact by ID or resource URI.",
    z.object({ artifact_id: z.string().optional(), resource_uri: z.string().optional() }).strict(),
    (input) => plane.getArtifact(definedEntries(input) as Parameters<ControlPlane["getArtifact"]>[0])
  );

  registerTool(
    server,
    "update_session_brief",
    "Update the orchestrator-maintained session brief with optimistic concurrency.",
    z
      .object({
        session_id: z.string(),
        expected_brief_revision: z.number().int().nonnegative(),
        brief: z.record(z.string(), z.unknown())
      })
      .strict(),
    (input) => plane.updateSessionBrief(input)
  );

  registerTool(
    server,
    "get_session_digest",
    "Read a compact session digest.",
    z.object({ session_id: z.string() }).strict(),
    (input) => plane.getSessionDigest(input)
  );

  registerTool(
    server,
    "cancel_tasks",
    "Cancel tasks, task groups, or sessions idempotently.",
    z.object({ task_ids: z.array(z.string()).optional(), group_id: z.string().optional(), session_id: z.string().optional() }).strict(),
    (input) => plane.cancelTasks(definedEntries(input) as Parameters<ControlPlane["cancelTasks"]>[0])
  );

  registerTool(
    server,
    "merge_tasks",
    "Create an integration worktree for selected attempts.",
    z.object({ session_id: z.string(), attempt_ids: z.array(z.string()) }).strict(),
    async (input) => {
      const merge = await plane.mergeTasks(input);
      const { integration_worktree_path: _path, ...publicMerge } = merge;
      return {
        ...publicMerge,
        integration_worktree_uri: `any-subagents://sessions/${merge.session_id}/integration-worktrees/latest`
      };
    }
  );

  registerTool(server, "get_effective_config", "Read redacted effective configuration.", z.object({}).strict(), async () =>
    plane.getEffectiveConfig()
  );

  registerTool(server, "doctor", "Run local setup diagnostics without model calls.", z.object({}).strict(), async () => plane.doctor());

  for (const [name, schema] of Object.entries(publicSchemas)) {
    const uri = `any-subagents://schemas/${name}`;
    server.registerResource(
      `schema_${name}`,
      uri,
      {
        title: `${name} JSON Schema`,
        description: `Public JSON Schema for ${name}.`,
        mimeType: "application/schema+json"
      },
      async () => ({
        contents: [
          {
            uri,
            mimeType: "application/schema+json",
            text: JSON.stringify(schema, null, 2)
          }
        ]
      })
    );
  }

  return server;
};

// registerTool casts McpServer through unknown because the MCP SDK bundles
// Zod v3 types internally while this project uses Zod v4. The runtime schemas
// are structurally compatible; the cast works around the nominal type mismatch.
const registerTool = <Input extends z.ZodType>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Input,
  handler: (input: z.infer<Input>) => Promise<unknown> | unknown
): void => {
  const toolServer = server as unknown as {
    registerTool: (
      name: string,
      config: { title: string; description: string; inputSchema: Input },
      cb: (input: unknown) => Promise<{ content: Array<{ type: "text"; text: string }>; structuredContent: Record<string, unknown> }>
    ) => void;
  };
  toolServer.registerTool(
    name,
    {
      title: name,
      description,
      inputSchema
    },
    async (input) => {
      const structuredContent = (await handler(input as z.infer<Input>)) as Record<string, unknown>;
      return {
        content: [{ type: "text" as const, text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent
      };
    }
  );
};
