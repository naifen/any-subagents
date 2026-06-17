import { mkdir } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createControlPlane } from "../core/control-plane.js";
import { defaultRuntimePaths } from "../storage/paths.js";
import { createAnySubagentsMcpServer } from "./server.js";

const paths = defaultRuntimePaths();
await Promise.all([
  mkdir(paths.stateDir, { recursive: true }),
  mkdir(paths.logsDir, { recursive: true }),
  mkdir(paths.artifactsDir, { recursive: true }),
  mkdir(paths.worktreeRoot, { recursive: true }),
  mkdir(paths.runtimeDir, { recursive: true })
]);

const plane = createControlPlane({ paths });
const server = createAnySubagentsMcpServer({ plane });

process.on("SIGTERM", () => {
  void plane.close().finally(() => process.exit(0));
});

await server.connect(new StdioServerTransport());
