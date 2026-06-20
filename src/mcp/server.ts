import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { ControlPlane } from "../core/control-plane.js";
import { forAudience, toPublicMergeResult } from "../core/audience.js";
import { publicSchemas, sessionBriefSchema, type SessionBrief } from "../schemas/index.js";
import {
  mcpCancelTasksSchema,
  mcpCreateSessionSchema,
  mcpGetMetricsSchema,
  mcpSubmitTaskGroupSchema,
  mcpUpdateSessionBriefSchema,
  toCreateSessionInput,
  toSubmitTaskGroupInput
} from "../schemas/mcp-tools.js";

export interface AnySubagentsMcpServerOptions {
  plane: ControlPlane;
}

export const createAnySubagentsMcpServer = ({ plane }: AnySubagentsMcpServerOptions): McpServer => {
  const server = new McpServer({
    name: "any-subagents",
    version: "0.1.0"
  });

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
      inputSchema: mcpCreateSessionSchema
    },
    async (input) => jsonResult(await plane.createSession(toCreateSessionInput(input)))
  );

  server.registerTool(
    "submit_task_group",
    {
      title: "submit_task_group",
      description: "Submit a task group for durable scheduling.",
      inputSchema: mcpSubmitTaskGroupSchema
    },
    async (input) => jsonResult(await plane.submitTaskGroup(toSubmitTaskGroupInput(input)))
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
    async ({ task_id, attempt_id }) => {
      const input: { task_id: string; attempt_id?: string } = { task_id };
      if (attempt_id !== undefined) input.attempt_id = attempt_id;
      const result = await plane.getTaskResult(input);
      return jsonResult({ ...result, attempt: forAudience.attempt(result.attempt, "public") });
    }
  );

  server.registerTool(
    "get_task_logs",
    {
      title: "get_task_logs",
      description: "Read a preview of task attempt logs.",
      inputSchema: z.object({ task_id: z.string(), attempt_id: z.string().optional(), max_bytes: z.number().int().positive().optional() }).strict()
    },
    async ({ task_id, attempt_id, max_bytes }) => {
      const input: { task_id: string; attempt_id?: string; max_bytes?: number } = { task_id };
      if (attempt_id !== undefined) input.attempt_id = attempt_id;
      if (max_bytes !== undefined) input.max_bytes = max_bytes;
      return jsonResult(await plane.getTaskLogs(input));
    }
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
      const { artifacts } = await plane.listArtifacts(filter);
      return jsonResult({ artifacts: artifacts.map((artifact) => forAudience.artifact(artifact, "public")) });
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
      const input: { artifact_id?: string; resource_uri?: string } = {};
      if (artifact_id !== undefined) input.artifact_id = artifact_id;
      if (resource_uri !== undefined) input.resource_uri = resource_uri;
      return jsonResult(forAudience.artifact(await plane.getArtifact(input), "public"));
    }
  );

  server.registerTool(
    "update_session_brief",
    {
      title: "update_session_brief",
      description: "Update the orchestrator-maintained session brief with optimistic concurrency.",
      inputSchema: mcpUpdateSessionBriefSchema
    },
    async (input) =>
      jsonResult(
        await plane.updateSessionBrief({
          session_id: input.session_id,
          expected_brief_revision: input.expected_brief_revision,
          brief: sessionBriefSchema.partial().parse(input.brief) as Partial<SessionBrief>
        })
      )
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
      inputSchema: mcpCancelTasksSchema
    },
    async ({ task_ids, group_id, session_id }) => {
      const input: { task_ids?: string[]; group_id?: string; session_id?: string } = {};
      if (task_ids !== undefined) input.task_ids = task_ids;
      if (group_id !== undefined) input.group_id = group_id;
      if (session_id !== undefined) input.session_id = session_id;
      return jsonResult(await plane.cancelTasks(input));
    }
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
      return jsonResult(toPublicMergeResult(merge));
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

  server.registerTool(
    "get_metrics",
    {
      title: "get_metrics",
      description: "Read local-only metrics stored in SQLite.",
      inputSchema: mcpGetMetricsSchema
    },
    async ({ name, session_id, task_id, limit }) => {
      const input: { name?: string; session_id?: string; task_id?: string; limit?: number } = {};
      if (name !== undefined) input.name = name;
      if (session_id !== undefined) input.session_id = session_id;
      if (task_id !== undefined) input.task_id = task_id;
      if (limit !== undefined) input.limit = limit;
      return jsonResult(await plane.getMetrics(input));
    }
  );

  server.registerTool(
    "export_session",
    {
      title: "export_session",
      description: "Export a session bundle to a local directory.",
      inputSchema: z.object({ session_id: z.string(), output_dir: z.string() }).strict()
    },
    async (input) => jsonResult(await plane.exportSession(input))
  );

  server.registerResource(
    "session_digest",
    "any-subagents://sessions/{session_id}/digest",
    {
      title: "Session digest",
      description: "Compact session digest view.",
      mimeType: "application/json"
    },
    async (uri) => {
      const sessionId = uri.pathname.split("/")[2];
      if (!sessionId) throw new Error("session_id required");
      const digest = await plane.getSessionDigest({ session_id: sessionId });
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(digest, null, 2) }]
      };
    }
  );

  server.registerResource(
    "task_result",
    "any-subagents://tasks/{task_id}/result",
    {
      title: "Task result",
      description: "Public task result without local paths.",
      mimeType: "application/json"
    },
    async (uri) => {
      const taskId = uri.pathname.split("/")[2];
      if (!taskId) throw new Error("task_id required");
      const result = await plane.getTaskResult({ task_id: taskId });
      const publicResult = { ...result, attempt: forAudience.attempt(result.attempt, "public") };
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(publicResult, null, 2) }]
      };
    }
  );

  server.registerResource(
    "artifact_by_uri",
    "any-subagents://artifacts/{artifact_id}",
    {
      title: "Artifact",
      description: "Artifact metadata without local path.",
      mimeType: "application/json"
    },
    async (uri) => {
      const artifactId = uri.pathname.split("/")[2];
      if (!artifactId) throw new Error("artifact_id required");
      const artifact = forAudience.artifact(await plane.getArtifact({ artifact_id: artifactId }), "public");
      return {
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(artifact, null, 2) }]
      };
    }
  );

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

const jsonResult = (data: unknown): {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
} => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: data as Record<string, unknown>
});
