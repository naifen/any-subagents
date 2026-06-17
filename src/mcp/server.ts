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

  // ─── Tools ─────────────────────────────────────────────────────
  // MCP SDK v1.29.0 natively supports Zod v4 schemas via AnySchema.
  // Each tool uses registerTool with typed inputSchema and returns
  // CallToolResult format.

  server.registerTool(
    "list_adapters",
    { title: "list_adapters", description: "List configured subagent adapters.", inputSchema: z.object({}).strict() },
    async () => jsonResult(plane.listAdapters())
  );

  server.registerTool(
    "create_session",
    {
      title: "create_session",
      description: "Create a session for a repository and base ref.",
      inputSchema: z
        .object({
          repo: z.string(),
          base_ref: z.string(),
          brief: z.record(z.string(), z.unknown()).optional(),
          metadata: z.record(z.string(), z.unknown()).optional()
        })
        .strict()
    },
    async ({ repo, base_ref, brief, metadata }) =>
      jsonResult(await plane.createSession(definedEntries({ repo, base_ref, brief, metadata }) as { repo: string; base_ref: string; brief?: Record<string, unknown>; metadata?: Record<string, unknown> }))
  );

  server.registerTool(
    "submit_task_group",
    {
      title: "submit_task_group",
      description: "Submit a task group for durable scheduling.",
      inputSchema: z
        .object({
          session_id: z.string(),
          title: z.string(),
          expected_brief_revision: z.number().int().nonnegative(),
          ignore_revision_conflict: z.boolean().optional(),
          tasks: z.array(z.record(z.string(), z.unknown()))
        })
        .strict()
    },
    async (input) =>
      jsonResult(await plane.submitTaskGroup(input as Parameters<ControlPlane["submitTaskGroup"]>[0]))
  );

  server.registerTool(
    "query_tasks",
    {
      title: "query_tasks",
      description: "Query compact task status summaries.",
      inputSchema: z.object({ session_id: z.string().optional(), group_id: z.string().optional() }).strict()
    },
    async ({ session_id, group_id }) => {
      const filter: { session_id?: string; group_id?: string } = {};
      if (session_id !== undefined) filter.session_id = session_id;
      if (group_id !== undefined) filter.group_id = group_id;
      return jsonResult(await plane.queryTasks(filter));
    }
  );

  server.registerTool(
    "get_task_result",
    {
      title: "get_task_result",
      description: "Read a task result envelope and attempt status.",
      inputSchema: z.object({ task_id: z.string(), attempt_id: z.string().optional() }).strict()
    },
    async ({ task_id, attempt_id }) =>
      jsonResult(await plane.getTaskResult(definedEntries({ task_id, attempt_id }) as { task_id: string; attempt_id?: string }))
  );

  server.registerTool(
    "get_task_logs",
    {
      title: "get_task_logs",
      description: "Read a preview of task attempt logs.",
      inputSchema: z.object({ task_id: z.string(), attempt_id: z.string().optional(), max_bytes: z.number().int().positive().optional() }).strict()
    },
    async ({ task_id, attempt_id, max_bytes }) =>
      jsonResult(await plane.getTaskLogs(definedEntries({ task_id, attempt_id, max_bytes }) as { task_id: string; attempt_id?: string; max_bytes?: number }))
  );

  server.registerTool(
    "list_artifacts",
    {
      title: "list_artifacts",
      description: "List artifact records without raw local paths.",
      inputSchema: z
        .object({
          session_id: z.string().optional(),
          group_id: z.string().optional(),
          task_id: z.string().optional(),
          attempt_id: z.string().optional()
        })
        .strict()
    },
    async ({ session_id, group_id, task_id, attempt_id }) => {
      const filter: { session_id?: string; group_id?: string; task_id?: string; attempt_id?: string } = {};
      if (session_id !== undefined) filter.session_id = session_id;
      if (group_id !== undefined) filter.group_id = group_id;
      if (task_id !== undefined) filter.task_id = task_id;
      if (attempt_id !== undefined) filter.attempt_id = attempt_id;
      return jsonResult(await plane.listArtifacts(filter));
    }
  );

  server.registerTool(
    "get_artifact",
    {
      title: "get_artifact",
      description: "Read an artifact by ID or resource URI.",
      inputSchema: z.object({ artifact_id: z.string().optional(), resource_uri: z.string().optional() }).strict()
    },
    async ({ artifact_id, resource_uri }) => {
      const filter: { artifact_id?: string; resource_uri?: string } = {};
      if (artifact_id !== undefined) filter.artifact_id = artifact_id;
      if (resource_uri !== undefined) filter.resource_uri = resource_uri;
      return jsonResult(await plane.getArtifact(filter));
    }
  );

  server.registerTool(
    "update_session_brief",
    {
      title: "update_session_brief",
      description: "Update the orchestrator-maintained session brief with optimistic concurrency.",
      inputSchema: z
        .object({
          session_id: z.string(),
          expected_brief_revision: z.number().int().nonnegative(),
          brief: z.record(z.string(), z.unknown())
        })
        .strict()
    },
    async (input) => jsonResult(await plane.updateSessionBrief(input))
  );

  server.registerTool(
    "get_session_digest",
    {
      title: "get_session_digest",
      description: "Read a compact session digest.",
      inputSchema: z.object({ session_id: z.string() }).strict()
    },
    async (input) => jsonResult(await plane.getSessionDigest(input))
  );

  server.registerTool(
    "cancel_tasks",
    {
      title: "cancel_tasks",
      description: "Cancel tasks, task groups, or sessions idempotently.",
      inputSchema: z.object({ task_ids: z.array(z.string()).optional(), group_id: z.string().optional(), session_id: z.string().optional() }).strict()
    },
    async ({ task_ids, group_id, session_id }) =>
      jsonResult(await plane.cancelTasks(definedEntries({ task_ids, group_id, session_id }) as Parameters<ControlPlane["cancelTasks"]>[0]))
  );

  server.registerTool(
    "merge_tasks",
    {
      title: "merge_tasks",
      description: "Create an integration worktree for selected attempts.",
      inputSchema: z.object({ session_id: z.string(), attempt_ids: z.array(z.string()) }).strict()
    },
    async (input) => {
      const merge = await plane.mergeTasks(input);
      const { integration_worktree_path: _path, ...publicMerge } = merge;
      return jsonResult({
        ...publicMerge,
        integration_worktree_uri: `any-subagents://sessions/${merge.session_id}/integration-worktrees/latest`
      });
    }
  );

  server.registerTool(
    "get_effective_config",
    { title: "get_effective_config", description: "Read redacted effective configuration.", inputSchema: z.object({}).strict() },
    async () => jsonResult(await plane.getEffectiveConfig())
  );

  server.registerTool(
    "doctor",
    { title: "doctor", description: "Run local setup diagnostics without model calls.", inputSchema: z.object({}).strict() },
    async () => jsonResult(await plane.doctor())
  );

  // ─── Resources ─────────────────────────────────────────────────

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

/**
 * Wrap a result object into the MCP CallToolResult format.
 */
const jsonResult = (data: unknown): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: data as Record<string, unknown>
});
