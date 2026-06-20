import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBootstrappedControlPlane } from "../core/bootstrap.js";
import { createAnySubagentsMcpServer } from "./server.js";

const plane = await createBootstrappedControlPlane(undefined, { audience: "public" });
const server = createAnySubagentsMcpServer({ plane });

process.on("SIGTERM", () => {
  void plane.close().finally(() => process.exit(0));
});

const transport = new StdioServerTransport();
await server.connect(transport);
