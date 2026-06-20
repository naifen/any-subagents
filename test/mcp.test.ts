import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, test } from "vitest";
import { createTestControlPlane } from "../src/test-support/control-plane.js";
import { createAnySubagentsMcpServer } from "../src/mcp/server.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";
import { createTempGitRepo } from "../src/test-support/git.js";

const planes: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(planes.splice(0).map((plane) => plane.close()));
});

describe("MCP server", () => {
  test("exposes adapter tools and schema resources without raw local paths", async () => {
    const plane = createTestControlPlane(await createTestRuntimePaths(), { globalConcurrency: 1 });
    planes.push(plane);
    const server = createAnySubagentsMcpServer({ plane });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = createLinkedTransports();

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["list_adapters", "create_session", "submit_task_group", "query_tasks", "get_task_result"])
    );

    const adapters = await client.callTool({ name: "list_adapters", arguments: {} });
    expect(adapters.structuredContent).toMatchObject({
      adapters: expect.arrayContaining([expect.objectContaining({ name: "fake" })])
    });

    const schema = await client.readResource({ uri: "any-subagents://schemas/result_envelope" });
    expect(schema.contents[0]?.uri).toBe("any-subagents://schemas/result_envelope");
    const schemaContent = schema.contents[0];
    expect(schemaContent && "text" in schemaContent ? schemaContent.text : "").toContain("task_id");
    expect(JSON.stringify(adapters.structuredContent)).not.toContain("/Users/");

    await Promise.all([client.close(), server.close()]);
  });

  test("get_task_result omits local attempt paths even with internal-audience plane", async () => {
    const repo = await createTempGitRepo();
    const paths = await createTestRuntimePaths();
    const plane = createTestControlPlane(paths, { globalConcurrency: 1 });
    planes.push(plane);
    const server = createAnySubagentsMcpServer({ plane });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = createLinkedTransports();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const session = await plane.createSession({ repo, base_ref: "HEAD", brief: { goal: "MCP path hiding." } });
    const group = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Path hiding",
      expected_brief_revision: session.brief_revision,
      tasks: [{
        mode: "research",
        goal: "Complete without leaking paths.",
        adapter: "fake",
        profile: "default",
        success_criteria: ["Done."]
      }]
    });
    await plane.waitForTaskGroup(group.group_id, 5_000);
    const tasks = await plane.queryTasks({ group_id: group.group_id });
    const taskId = tasks.tasks[0]!.task_id;

    const mcpResult = await client.callTool({ name: "get_task_result", arguments: { task_id: taskId } });
    const attempt = (mcpResult.structuredContent as { attempt: Record<string, unknown> }).attempt;
    expect(attempt).not.toHaveProperty("worktree_path");
    expect(attempt).not.toHaveProperty("log_path");
    expect(attempt).not.toHaveProperty("result_path");

    const cliResult = await plane.getTaskResult({ task_id: taskId });
    expect(cliResult.attempt.worktree_path).toBeDefined();
    expect(cliResult.attempt.log_path).toBeDefined();
    expect(cliResult.attempt.result_path).toBeDefined();

    await Promise.all([client.close(), server.close()]);
  });

  test("list_artifacts omits local artifact paths even with internal-audience plane", async () => {
    const repo = await createTempGitRepo();
    const paths = await createTestRuntimePaths();
    const plane = createTestControlPlane(paths, { globalConcurrency: 1 });
    planes.push(plane);
    const server = createAnySubagentsMcpServer({ plane });
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = createLinkedTransports();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const session = await plane.createSession({ repo, base_ref: "HEAD", brief: { goal: "MCP artifact path hiding." } });
    const group = await plane.submitTaskGroup({
      session_id: session.session_id,
      title: "Artifact path hiding",
      expected_brief_revision: session.brief_revision,
      tasks: [{
        mode: "research",
        goal: "Complete without leaking artifact paths.",
        adapter: "fake",
        profile: "default",
        success_criteria: ["Done."]
      }]
    });
    await plane.waitForTaskGroup(group.group_id, 5_000);
    const tasks = await plane.queryTasks({ group_id: group.group_id });
    const taskId = tasks.tasks[0]!.task_id;

    const mcpArtifacts = await client.callTool({ name: "list_artifacts", arguments: { task_id: taskId } });
    const artifacts = (mcpArtifacts.structuredContent as { artifacts: Array<Record<string, unknown>> }).artifacts;
    expect(artifacts.length).toBeGreaterThan(0);
    for (const artifact of artifacts) {
      expect(artifact).not.toHaveProperty("path");
    }

    const cliArtifacts = await plane.listArtifacts({ task_id: taskId });
    expect(cliArtifacts.artifacts.some((artifact) => artifact.path !== undefined)).toBe(true);

    await Promise.all([client.close(), server.close()]);
  });
});

function createLinkedTransports(): [Transport, Transport] {
  const left = new MemoryTransport();
  const right = new MemoryTransport();
  left.peer = right;
  right.peer = left;
  return [left, right];
}

class MemoryTransport implements Transport {
  peer?: MemoryTransport;
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    queueMicrotask(() => this.peer?.onmessage?.(message));
  }

  async close(): Promise<void> {
    this.onclose?.();
  }
}
