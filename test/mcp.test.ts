import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { afterEach, describe, expect, test } from "vitest";
import { createControlPlane } from "../src/core/control-plane.js";
import { createAnySubagentsMcpServer } from "../src/mcp/server.js";
import { createTestRuntimePaths } from "../src/test-support/runtime.js";

const planes: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(planes.splice(0).map((plane) => plane.close()));
});

describe("MCP server", () => {
  test("exposes adapter tools and schema resources without raw local paths", async () => {
    const plane = createControlPlane({ paths: await createTestRuntimePaths(), maxConcurrency: 1 });
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
